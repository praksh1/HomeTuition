import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  teacherLeaveTable,
  db,
  recurringDaysTable,
  recurringEnrollmentsTable,
  recurringSessionsTable,
  teacherPlansTable,
  usersTable,
  type RecurringSession,
} from "@workspace/db";
import { attachUserIfPresent, requireAuth } from "../middlewares/requireAuth";
import { chargeForMonthly } from "../lib/payments";
import { mayBuyTeacherPlan } from "../lib/teachingAccess";
import { flagContent } from "../lib/moderation";
import { notify, notifyMany } from "../lib/notify";
import {
  MIN_SESSIONS_PER_CYCLE,
  MAKEUP_DEADLINE_HOURS,
  MAX_ABUSES_PER_CYCLE,
  MAX_DAILY_MINUTES,
  MAX_MAKEUPS_PER_CYCLE,
  MAX_STUDENTS,
  PLATFORM_SHARE,
  TEACHER_TIER_PRICE,
  TIME_CHANGE_NOTICE_HOURS,
  SUSPENSION_DAYS,
  abuseStanding,
  canChangeTime,
  canEnrol,
  isAllowedDuration,
  makeupFallsWithinCycle,
  quoteJoin,
} from "../lib/monthly";
import {
  formatStartMinute,
  instantOfLocalTime,
  isValidStartMinute,
  localDayKey,
} from "../lib/monthlySchedule";
import {
  activePlanFor,
  classById,
  currentPlanFor,
  classForPlan,
  countEnrolled,
  countRegularDays,
  countRemainingDays,
  abusesIn,
  addMakeup,
  changeDailyTime,
  cycleOf,
  enrolInMaterialisedDays,
  enrolmentFor,
  generateCycle,
  enforceStanding,
  ensureCycleGenerated,
  ledgerFor,
  makeupsIn,
  materialiseDueDays,
  missedDaysIn,
  nextClassDay,
  settleDueDays,
  settleFinishedCycles,
  todaysClassDay,
} from "../lib/monthlyStore";

const router: IRouter = Router();

/** Reads an :id path parameter, or null when it is not a number. */
function idParam(req: Request): number | null {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw ?? "", 10);
  return Number.isNaN(id) ? null : id;
}

/**
 * Everything a caller needs to know about a monthly class, in one shape.
 *
 * Deliberately no dates as strings and no month names: instants and a time of day, converted
 * for display in the app where the reader's calendar preference lives. A server that formatted
 * "24 Bhadra" here would be a server that had an opinion about somebody's calendar, and that
 * opinion would end up next to a price.
 */
/**
 * Brings a class up to date before anybody is told anything about it.
 *
 * Two jobs, both lazy: turn the class-days that are nearly due into real classes, and write
 * down what became of the ones now in the past. Neither can wait for a scheduler, because
 * there isn't one — and both have to have happened before a price is quoted, since the price
 * is a count of the classes still to come.
 *
 * Failures are swallowed on purpose. This runs on the read path, and a class nobody can look
 * at is worse than a class whose ledger is a few minutes stale; the next read tries again.
 */
async function bringUpToDate(klass: RecurringSession, log?: Request["log"]): Promise<void> {
  try {
    const [plan] = await db.select().from(teacherPlansTable).where(eq(teacherPlansTable.id, klass.planId));
    if (!plan) return;
    const now = Date.now();
    const cycle = await cycleOf(plan, now);

    // Order matters. Judging what became of yesterday has to happen before counting black
    // marks, and a month cannot be closed before the classes in it have been judged.
    await settleDueDays(klass, now);
    if (cycle) {
      await ensureCycleGenerated(klass, cycle.index, cycle.start);
      await materialiseDueDays(klass, now);

      const standing = await enforceStanding(klass, plan, cycle.index, now);

      if (standing.warnAt !== null) {
        /*
         * The warning the owner asked to be strong.
         *
         * Sent once per new black mark, not on every read: `warnedAtAbuses` remembers, and a
         * warning that arrives ten times a day is one nobody reads — which would defeat the
         * whole point of insisting on it.
         */
        notify(klass.teacherId, {
          kind: "session_cancelled",
          at: new Date(now).toISOString(),
          topic:
            `WARNING: ${standing.warnAt} of your classes were missed this month with no make-up ` +
            `arranged. At ${MAX_ABUSES_PER_CYCLE}, your monthly class is suspended for ` +
            `${SUSPENSION_DAYS} days and your students are refunded. You can still arrange a ` +
            `make-up for each missed class within ${MAKEUP_DEADLINE_HOURS} hours of it.`,
        });
      }

      if (standing.justSuspended) {
        notify(klass.teacherId, {
          kind: "session_cancelled",
          at: new Date(now).toISOString(),
          topic:
            `Your monthly class has been suspended for ${SUSPENSION_DAYS} days, and your ` +
            `students have been refunded for the rest of the month.`,
        });
      }

      const settled = await settleFinishedCycles(klass, plan, cycle.index, now);
      for (const month of settled) {
        if (month.refunded > 0) {
          log?.warn(
            { recurringId: klass.id, ...month },
            "a monthly class fell short and refunds are owed",
          );
        }
      }
    }
  } catch (err) {
    log?.warn({ err, recurringId: klass.id }, "could not bring a monthly class up to date");
  }
}

async function describeClass(klass: Awaited<ReturnType<typeof classById>>, viewerId: number | null) {
  if (!klass) return null;
  const [plan] = await db.select().from(teacherPlansTable).where(eq(teacherPlansTable.id, klass.planId));
  if (!plan) return null;

  const now = Date.now();
  const cycle = await cycleOf(plan, now);
  const [teacher] = await db
    .select({ id: usersTable.id, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, klass.teacherId));

  const cycleIndex = cycle?.index ?? 0;
  const planned = cycle ? await countRegularDays(klass.id, cycleIndex) : 0;
  const remaining = cycle ? await countRemainingDays(klass.id, cycleIndex, now) : 0;
  const enrolled = cycle ? await countEnrolled(klass.id, cycleIndex) : 0;
  const ledger = cycle ? await ledgerFor(klass.id, cycleIndex) : null;

  const mine = viewerId !== null && cycle ? await enrolmentFor(klass.id, viewerId, cycleIndex) : null;
  const isTeacher = viewerId !== null && viewerId === klass.teacherId;
  // Looked up for everyone and handed only to people in the class — see `today` below.
  const today = viewerId !== null ? await todaysClassDay(klass.id) : null;

  return {
    id: klass.id,
    teacherId: klass.teacherId,
    teacherName: teacher?.name ?? "",
    subject: klass.subject,
    topic: klass.topic,
    /** Minutes past midnight in `timeZone` — the app decides how to render it. */
    startMinute: klass.startMinute,
    startTime: formatStartMinute(klass.startMinute),
    durationMinutes: klass.durationMinutes,
    timeZone: klass.timeZone,
    monthlyPrice: klass.monthlyPrice,
    maxStudents: klass.maxStudents,
    status: klass.status,
    enrolled,
    seatsLeft: Math.max(0, klass.maxStudents - enrolled),
    cycle: cycle
      ? {
          index: cycle.index,
          startsAt: new Date(cycle.start).toISOString(),
          endsAt: new Date(cycle.end).toISOString(),
        }
      : null,
    sessionsPlanned: planned,
    sessionsRemaining: remaining,
    ledger,
    /** What this viewer would pay to join right now; null once they hold a place. */
    quote: mine ? null : quoteJoin(klass.monthlyPrice, remaining, planned),
    /**
     * Today's class, so the monthly card can be the way in.
     *
     * Only for somebody who is actually in the class — the teacher, or a student holding a
     * place. A link handed to a browser would be a door with no lock in front of it, and the
     * door itself is `membership.ts`, which would refuse them anyway; offering it would just
     * be a button that fails.
     */
    today: today && (isTeacher || mine)
      ? {
          sessionId: today.sessionId,
          startsAt: today.scheduledFor.toISOString(),
          status: today.status,
        }
      : null,
    enrolment: mine
      ? {
          cycleIndex: mine.cycleIndex,
          amountPaid: mine.amountPaid,
          sessionsPaidFor: mine.sessionsPaidFor,
          sessionsPlanned: mine.sessionsPlanned,
          status: mine.status,
          /**
           * What is guaranteed, next to what was bought.
           *
           * A student was told "you paid NPR 1,933 for 29 classes" while the teacher owed a
           * floor of 25. Two numbers for one arrangement, and the gap is exactly where a
           * refund argument starts: a student who receives 26 has "lost three" while the
           * teacher owes nothing. Saying both, in one sentence, is the whole fix — see
           * `deliveryVerdict` in lib/monthly.ts for the rule this is quoting.
           */
          guaranteed: Math.min(MIN_SESSIONS_PER_CYCLE, mine.sessionsPaidFor),
          guaranteeFloor: MIN_SESSIONS_PER_CYCLE,
        }
      : null,
  };
}

/**
 * Buys the monthly tier.
 *
 * Atomic, and for the same reason ordinary booking is: the charge happens inside the
 * transaction, so there is no state in which a teacher has been billed and has no plan, or
 * holds a plan nobody was charged for.
 *
 * The clock does **not** start here. The owner was explicit that the thirty-day cycle begins
 * when the teacher creates their recurring class, so `cycleAnchor` stays null until then — see
 * `cycleOf`, which also holds the rule for a plan that is bought and never used.
 */
router.post("/monthly/plan", requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  if (user.role !== "teacher") {
    res.status(403).json({ error: "Only teachers can buy the monthly plan." });
    return;
  }

  const existing = await activePlanFor(user.userId);
  if (existing) {
    // Not an error. A teacher tapping a stale button should end up informed, not scolded.
    res.json({ plan: existing, alreadyHad: true });
    return;
  }

  const { paymentMethod } = req.body as { paymentMethod?: string };
  const price = TEACHER_TIER_PRICE;

  try {
    const result = await db.transaction(async (tx) => {
      const charge = await chargeForMonthly({
        purpose: "teacher-plan",
        referenceId: user.userId,
        userId: user.userId,
        amount: price,
        method: paymentMethod ?? "unknown",
        log: req.log,
      });
      // Nothing is written yet, so returning here leaves no plan behind for a declined payment.
      if (!charge.ok) return { kind: "declined" as const, message: charge.message };

      const [plan] = await tx
        .insert(teacherPlansTable)
        .values({
          teacherId: user.userId,
          price,
          // The whole of the tier fee is Sikshya's — it is what the teacher pays to run a
          // monthly class, not a share of anything. The students' fees are what get split.
          platformShare: price,
          status: "active",
        })
        .returning();
      return { kind: "ok" as const, plan };
    });

    if (result.kind === "declined") {
      res.status(402).json({ error: result.message ?? "That payment could not be completed." });
      return;
    }
    res.status(201).json({ plan: result.plan });
  } catch (err) {
    // The partial unique index is what actually stops two plans existing; a race that gets past
    // the read above lands here rather than creating one.
    const again = await activePlanFor(user.userId);
    if (again) {
      res.json({ plan: again, alreadyHad: true });
      return;
    }
    req.log?.error({ err }, "could not create a monthly plan");
    res.status(500).json({ error: "Could not set up the monthly plan. Please try again." });
  }
});

/** The teacher's own plan, their class, and how they are standing this cycle. */
router.get("/monthly/plan", requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  // Whatever state it is in. A suspended teacher was being shown no plan at all, as though they
  // had never bought one — hiding the suspension, its reason and the date it lifts at exactly
  // the moment those are the only things worth reading.
  const plan = await currentPlanFor(user.userId);
  if (!plan) {
    res.json({ plan: null, class: null, tierPrice: TEACHER_TIER_PRICE });
    return;
  }

  const klass = await classForPlan(plan.id);
  if (klass) await bringUpToDate(klass, req.log);

  // Re-read: the sweep above may have suspended them, and telling a suspended teacher they are
  // fine because the row was read a moment earlier is exactly the sort of stale answer this
  // project has had to fix before.
  const fresh = (await currentPlanFor(user.userId)) ?? plan;
  const cycle = await cycleOf(fresh);
  const ledger = klass && cycle ? await ledgerFor(klass.id, cycle.index) : null;

  /*
   * Counted, not read off the ledger's "missed".
   *
   * A missed class is not yet a black mark — the teacher has forty-eight hours to arrange a
   * make-up, and one arranged clears it. Showing the raw missed count as their standing would
   * tell a teacher who has made up every class that they are about to be suspended.
   */
  const abuses = klass && cycle ? await abusesIn(klass.id, cycle.index) : 0;
  const standing = klass && cycle ? abuseStanding(abuses) : null;
  const makeupsUsed = klass && cycle ? await makeupsIn(klass.id, cycle.index) : 0;

  res.json({
    plan: {
      id: plan.id,
      price: plan.price,
      purchasedAt: plan.purchasedAt,
      cycleAnchor: plan.cycleAnchor,
      status: plan.status,
      suspendedUntil: plan.suspendedUntil,
      suspendedReason: plan.suspendedReason,
    },
    cycle: cycle
      ? {
          index: cycle.index,
          startsAt: new Date(cycle.start).toISOString(),
          endsAt: new Date(cycle.end).toISOString(),
        }
      : null,
    class: klass ? await describeClass(klass, user.userId) : null,
    ledger,
    standing,
    makeups: { used: makeupsUsed, allowed: MAX_MAKEUPS_PER_CYCLE, left: Math.max(0, MAX_MAKEUPS_PER_CYCLE - makeupsUsed) },
    makeupDeadlineHours: MAKEUP_DEADLINE_HOURS,
    suspensionDays: SUSPENSION_DAYS,
    tierPrice: TEACHER_TIER_PRICE,
    platformShare: PLATFORM_SHARE,
  });
});

/**
 * The classes this teacher missed, and which of them still need making up.
 *
 * Separate from the plan view because it is a list a teacher acts on rather than a number they
 * read, and because it has to say *per class* how long is left — the forty-eight hours run from
 * each miss, not from the month.
 */
router.get("/monthly/classes/:id/missed", requireAuth, async (req: Request, res: Response) => {
  const id = idParam(req);
  if (id === null) {
    res.status(400).json({ error: "Invalid class id" });
    return;
  }
  const user = req.user!;
  const klass = await classById(id);
  if (!klass) {
    res.status(404).json({ error: "Class not found" });
    return;
  }
  if (klass.teacherId !== user.userId) {
    res.status(403).json({ error: "Only the teacher can see this." });
    return;
  }
  await bringUpToDate(klass, req.log);

  const [plan] = await db.select().from(teacherPlansTable).where(eq(teacherPlansTable.id, klass.planId));
  const cycle = plan ? await cycleOf(plan) : null;
  if (!cycle) {
    res.json({ missed: [], makeups: { used: 0, allowed: MAX_MAKEUPS_PER_CYCLE, left: MAX_MAKEUPS_PER_CYCLE } });
    return;
  }

  const now = Date.now();
  // Asked of the same code that judges them, so what a teacher is shown and what they are
  // judged on cannot drift apart.
  const rows = await missedDaysIn(klass.id, cycle.index, now);

  const used = await makeupsIn(klass.id, cycle.index);
  res.json({
    missed: rows.map((row) => ({
      id: row.id,
      wasAt: row.scheduledFor.toISOString(),
      missedAt: row.missedAt ? row.missedAt.toISOString() : null,
      madeUpAt: row.madeUpAt ? row.madeUpAt.toISOString() : null,
      countsAgainstYou: row.countsAgainstYou,
      deadline: row.deadline ? row.deadline.toISOString() : null,
      hoursLeft: row.deadline === null ? null : Math.max(0, Math.round((row.deadline.getTime() - now) / 3_600_000)),
    })),
    makeups: { used, allowed: MAX_MAKEUPS_PER_CYCLE, left: Math.max(0, MAX_MAKEUPS_PER_CYCLE - used) },
    makeupDeadlineHours: MAKEUP_DEADLINE_HOURS,
  });
});

/**
 * The days a teacher has said they are away, and marking new ones.
 *
 * Marking leave changes nothing about what a teacher owes: the daily classes inside it are not
 * cancelled and missing them still counts. Running a class for only part of a month is a
 * separate, larger question — the price, the delivery floor and the suspension count all assume
 * a class runs every day — and it is parked pending the owner's decisions. See
 * `.agents/backlog/monthly-partial-months-and-dropping.md`.
 *
 * What this does do is stop a make-up landing on a day the teacher will miss, and tell them
 * honestly how many classes fall inside the dates they just booked.
 */
router.get("/monthly/leave", requireAuth, async (req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(teacherLeaveTable)
    .where(eq(teacherLeaveTable.teacherId, req.user!.userId))
    .orderBy(desc(teacherLeaveTable.startsAt));
  res.json({
    leave: rows.map((row) => ({
      id: row.id,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      reason: row.reason,
    })),
  });
});

router.post("/monthly/leave", requireAuth, async (req: Request, res: Response) => {
  const { startsAt, endsAt, reason } = req.body as { startsAt?: string; endsAt?: string; reason?: string };
  const from = startsAt ? new Date(startsAt) : null;
  const to = endsAt ? new Date(endsAt) : null;
  if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    res.status(400).json({ error: "Pick the first and last day you will be away." });
    return;
  }
  if (to.getTime() < from.getTime()) {
    res.status(400).json({ error: "The last day cannot be before the first." });
    return;
  }
  // A year is far beyond any trip and well within a mistake — a decade of leave booked by a
  // slipped digit would quietly refuse every make-up from now on.
  if (to.getTime() - from.getTime() > 365 * 24 * 60 * 60 * 1000) {
    res.status(400).json({ error: "That is longer than a year. Check the dates." });
    return;
  }

  const [row] = await db
    .insert(teacherLeaveTable)
    .values({
      teacherId: req.user!.userId,
      startsAt: from,
      endsAt: to,
      reason: typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 200) : null,
    })
    .returning();

  /**
   * How many classes fall inside it, said plainly.
   *
   * A teacher booking a fortnight away is about to miss fourteen classes, and the app knows it.
   * Telling them now is the difference between a decision and a surprise — and it is *only*
   * telling: nothing is cancelled and nothing is excused.
   */
  const plan = await currentPlanFor(req.user!.userId);
  const klass = plan ? await classForPlan(plan.id) : null;
  let classesInside = 0;
  if (klass) {
    const [n] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(recurringDaysTable)
      .where(
        and(
          eq(recurringDaysTable.recurringId, klass.id),
          sql`status = 'planned'`,
          gte(recurringDaysTable.scheduledFor, from),
          lte(recurringDaysTable.scheduledFor, to),
        ),
      );
    classesInside = n?.n ?? 0;
  }

  res.status(201).json({
    leave: { id: row!.id, startsAt: from.toISOString(), endsAt: to.toISOString(), reason: row!.reason },
    classesInside,
    note:
      classesInside > 0
        ? `${classesInside} of your classes fall in those dates. They are still yours to hold — marking leave does not cancel them or excuse missing them. It only stops a make-up being put on a day you are away.`
        : "No classes fall in those dates.",
  });
});

router.delete("/monthly/leave/:leaveId", requireAuth, async (req: Request, res: Response) => {
  const leaveId = parseInt(String(req.params.leaveId), 10);
  if (!Number.isFinite(leaveId)) { res.status(400).json({ error: "Invalid leave id" }); return; }
  const [gone] = await db
    .delete(teacherLeaveTable)
    .where(and(eq(teacherLeaveTable.id, leaveId), eq(teacherLeaveTable.teacherId, req.user!.userId)))
    .returning({ id: teacherLeaveTable.id });
  if (!gone) { res.status(404).json({ error: "That leave was not found." }); return; }
  res.json({ ok: true });
});

/** Puts a make-up class on the calendar for one that was missed. */
router.post("/monthly/classes/:id/makeups", requireAuth, async (req: Request, res: Response) => {
  const id = idParam(req);
  if (id === null) {
    res.status(400).json({ error: "Invalid class id" });
    return;
  }
  const user = req.user!;
  const klass = await classById(id);
  if (!klass) {
    res.status(404).json({ error: "Class not found" });
    return;
  }
  if (klass.teacherId !== user.userId) {
    res.status(403).json({ error: "Only the teacher can arrange a make-up." });
    return;
  }

  const { missedDayId, at, localDate, startMinute } = req.body as {
    missedDayId?: number;
    /** Backwards-compatible instant used by older clients and the API suite. */
    at?: string;
    /** The day the teacher chose, on the class's own local calendar. */
    localDate?: string;
    /** The time the teacher chose, as minutes after midnight in the class's time zone. */
    startMinute?: number;
  };
  const dayId = Number(missedDayId);
  if (!Number.isInteger(dayId)) {
    res.status(400).json({ error: "Say which missed class this is making up." });
    return;
  }

  const access = await mayBuyTeacherPlan(user.userId);
  if (!access.allowed) {
    res.status(access.status).json({ error: access.message, code: access.code });
    return;
  }

  let when: Date | null = null;
  if (localDate !== undefined || startMinute !== undefined) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate ?? "");
    if (match && isValidStartMinute(startMinute ?? -1)) {
      const [, year, month, day] = match;
      when = new Date(
        instantOfLocalTime(Number(year), Number(month), Number(day), startMinute!, klass.timeZone),
      );
      // `Date.UTC` normalises an impossible date such as 31 February. Refuse that instead of
      // silently moving a teacher's make-up into the following month.
      if (localDayKey(when.getTime(), klass.timeZone) !== localDate) when = null;
    }
  } else if (at) {
    when = new Date(at);
  }
  if (!when || Number.isNaN(when.getTime())) {
    res.status(400).json({ error: "Pick a date and time for the make-up class." });
    return;
  }
  const now = Date.now();
  if (when.getTime() <= now) {
    res.status(400).json({ error: "A make-up class has to be in the future." });
    return;
  }

  const [plan] = await db.select().from(teacherPlansTable).where(eq(teacherPlansTable.id, klass.planId));
  if (!plan || plan.status !== "active") {
    res.status(403).json({ error: plan?.suspendedReason ?? "This plan is not running." });
    return;
  }
  const cycle = await cycleOf(plan, now);
  if (!cycle) {
    res.status(409).json({ error: "That class has not started its first month yet." });
    return;
  }
  if (!makeupFallsWithinCycle(when, cycle.start, cycle.end)) {
    res.status(409).json({
      error: "A make-up must be held before this monthly cycle ends. Pick another date and time.",
    });
    return;
  }

  const made = await addMakeup(klass, dayId, when, cycle.index);
  if (!made.ok) {
    res.status(409).json({ error: made.reason });
    return;
  }

  // Everybody in the month is told, the same way they are told a class moved. A make-up
  // nobody hears about is a class the teacher holds alone.
  const students = await db
    .select({ studentId: recurringEnrollmentsTable.studentId })
    .from(recurringEnrollmentsTable)
    .where(
      and(
        eq(recurringEnrollmentsTable.recurringId, klass.id),
        eq(recurringEnrollmentsTable.cycleIndex, cycle.index),
        eq(recurringEnrollmentsTable.status, "active"),
      ),
    );
  if (students.length > 0) {
    notifyMany(
      students.map((x) => x.studentId),
      {
        kind: "session_rescheduled",
        at: new Date().toISOString(),
        fromUserId: user.userId,
        topic: `Make-up class: ${klass.subject} — ${klass.topic}`,
        newDate: when.toISOString(),
      },
    );
  }

  const used = await makeupsIn(klass.id, cycle.index);
  res.status(201).json({
    makeup: { id: made.id, at: when.toISOString(), forMissedDayId: dayId },
    makeups: { used, allowed: MAX_MAKEUPS_PER_CYCLE, left: Math.max(0, MAX_MAKEUPS_PER_CYCLE - used) },
    studentsTold: students.length,
  });
});

/**
 * Creates the recurring class, and starts the plan's clock.
 *
 * One class per plan. The cycle's class-days are written here rather than lazily, because the
 * number of them is the denominator every price in the cycle is divided by — a student joining
 * two minutes later must be quoted against a real count of real classes, not against an
 * assumption that a cycle holds thirty.
 */
router.post("/monthly/classes", requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  if (user.role !== "teacher") {
    res.status(403).json({ error: "Only teachers can create a monthly class." });
    return;
  }

  const identity = await mayBuyTeacherPlan(user.userId);
  if (!identity.allowed) {
    res.status(identity.status).json({ error: identity.message, code: identity.code });
    return;
  }

  // Read whatever they have, so a suspended teacher is told they are suspended rather than
  // told to buy a plan they already own.
  const plan = await currentPlanFor(user.userId);
  if (!plan) {
    res.status(402).json({ error: "You need the monthly plan before you can create a monthly class." });
    return;
  }
  if (plan.status !== "active") {
    res.status(403).json({ error: plan.suspendedReason ?? "This plan is not running at the moment." });
    return;
  }

  const existing = await classForPlan(plan.id);
  if (existing) {
    res.status(409).json({
      error: "You already have a monthly class. The plan runs one class, so change that one instead.",
      class: await describeClass(existing, user.userId),
    });
    return;
  }

  const body = req.body as {
    subject?: string;
    topic?: string;
    startMinute?: number;
    durationMinutes?: number;
    monthlyPrice?: number;
    maxStudents?: number;
    timeZone?: string;
  };

  const subject = (body.subject ?? "").trim();
  const topic = (body.topic ?? "").trim();
  if (!subject || !topic) {
    res.status(400).json({ error: "A monthly class needs a subject and a topic." });
    return;
  }
  if (!isValidStartMinute(body.startMinute ?? -1)) {
    res.status(400).json({ error: "Pick a time of day for the class." });
    return;
  }
  const duration = body.durationMinutes ?? 60;
  const allowed = isAllowedDuration(duration);
  if (!allowed.ok) {
    res.status(400).json({ error: allowed.reason });
    return;
  }
  const monthlyPrice = Math.trunc(body.monthlyPrice ?? 0);
  if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) {
    res.status(400).json({ error: "The monthly fee must be a whole number of rupees, or zero." });
    return;
  }
  const maxStudents = Math.trunc(body.maxStudents ?? MAX_STUDENTS);
  if (maxStudents < 1 || maxStudents > MAX_STUDENTS) {
    res.status(400).json({ error: `A monthly class takes between 1 and ${MAX_STUDENTS} students.` });
    return;
  }

  const startedAt = new Date();

  try {
    const created = await db.transaction(async (tx) => {
      const [klass] = await tx
        .insert(recurringSessionsTable)
        .values({
          planId: plan.id,
          teacherId: user.userId,
          subject,
          topic,
          startMinute: body.startMinute!,
          durationMinutes: duration,
          timeZone: (body.timeZone ?? "Asia/Kathmandu").trim() || "Asia/Kathmandu",
          monthlyPrice,
          maxStudents,
          status: "active",
        })
        .returning();

      // The clock starts now, not at purchase. Written in the same transaction as the class so
      // a plan can never end up anchored to a class that failed to be created.
      await tx
        .update(teacherPlansTable)
        .set({ cycleAnchor: startedAt })
        .where(eq(teacherPlansTable.id, plan.id));

      await generateCycle(klass!, 0, startedAt.getTime(), tx);
      return klass!;
    });

    await flagContent({ userId: user.userId, surface: "monthly_class_title", subjectId: created.id, text: `${subject} ${topic}` });

    res.status(201).json({ class: await describeClass(created, user.userId) });
  } catch (err) {
    req.log?.error({ err }, "could not create a monthly class");
    res.status(500).json({ error: "Could not create the class. Please try again." });
  }
});

/**
 * Every monthly class on offer.
 *
 * `attachUserIfPresent` rather than `requireAuth`: the list is public, but it reads differently
 * when it knows you — a student who already holds a place must not be quoted a price for it.
 * Shipped once without this and the quote came back for a student who had already paid, which
 * is the same shape as the Subscribe button that never turned green: a route deciding what is
 * true about *you* from something that was never about you.
 */
router.get("/monthly/classes", attachUserIfPresent, async (req: Request, res: Response) => {
  const classes = await db
    .select()
    .from(recurringSessionsTable)
    .where(eq(recurringSessionsTable.status, "active"))
    .orderBy(desc(recurringSessionsTable.id));

  const viewerId = req.user?.userId ?? null;
  await Promise.all(classes.map((k) => bringUpToDate(k, req.log)));
  const described = await Promise.all(classes.map((k) => describeClass(k, viewerId)));
  res.json({ classes: described.filter(Boolean) });
});

/** One monthly class, including what this caller would pay to join it — see the list above. */
router.get("/monthly/classes/:id", attachUserIfPresent, async (req: Request, res: Response) => {
  const id = idParam(req);
  if (id === null) {
    res.status(400).json({ error: "Invalid class id" });
    return;
  }
  const found = await classById(id);
  if (!found) {
    res.status(404).json({ error: "Class not found" });
    return;
  }
  await bringUpToDate(found, req.log);

  const described = await describeClass(found, req.user?.userId ?? null);
  if (!described) {
    res.status(404).json({ error: "Class not found" });
    return;
  }
  res.json({ class: described });
});

/**
 * Takes a place in a monthly class, for what is left of the teacher's current cycle.
 *
 * One transaction that either commits a paid place or writes nothing — the same rule as
 * ordinary booking, and for the same reason: there must be no state between "not enrolled" and
 * "enrolled and paid".
 *
 * The quote is recomputed **inside** the transaction. The one the student was shown came from
 * a read that may be minutes old, and a class held in between would mean charging for a class
 * that has already happened.
 */
router.post("/monthly/classes/:id/join", requireAuth, async (req: Request, res: Response) => {
  const id = idParam(req);
  if (id === null) {
    res.status(400).json({ error: "Invalid class id" });
    return;
  }
  const user = req.user!;
  const { paymentMethod } = req.body as { paymentMethod?: string };

  const klass = await classById(id);
  if (!klass || klass.status !== "active") {
    res.status(404).json({ error: "That monthly class is not running." });
    return;
  }
  if (klass.teacherId === user.userId) {
    res.status(400).json({ error: "You cannot join your own class." });
    return;
  }

  const [plan] = await db.select().from(teacherPlansTable).where(eq(teacherPlansTable.id, klass.planId));
  if (!plan || plan.status !== "active") {
    res.status(409).json({ error: "That teacher's monthly plan is not running at the moment." });
    return;
  }

  const now = Date.now();
  const cycle = await cycleOf(plan, now);
  if (!cycle) {
    res.status(409).json({ error: "That class has not started its first month yet." });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const held = await enrolmentFor(klass.id, user.userId, cycle.index, tx);
      if (held && held.status === "active") return { kind: "already" as const, enrolment: held };

      const enrolled = await countEnrolled(klass.id, cycle.index, tx);
      const room = canEnrol(enrolled);
      if (!room.ok || enrolled >= klass.maxStudents) {
        return { kind: "full" as const, reason: room.ok ? "This class is full." : room.reason };
      }

      // Recomputed here, under the transaction, rather than trusting the read the student saw.
      const planned = await countRegularDays(klass.id, cycle.index, tx);
      const remaining = await countRemainingDays(klass.id, cycle.index, now, tx);
      const quote = quoteJoin(klass.monthlyPrice, remaining, planned);

      if (quote.startsNextCycle) return { kind: "no-classes-left" as const };

      let reference: string | null = null;
      if (quote.amount > 0) {
        const charge = await chargeForMonthly({
          purpose: "student-place",
          referenceId: klass.id,
          userId: user.userId,
          amount: quote.amount,
          method: paymentMethod ?? "unknown",
          log: req.log,
        });
        if (!charge.ok) return { kind: "declined" as const, message: charge.message };
        reference = charge.reference ?? null;
      }

      const [enrolment] = await tx
        .insert(recurringEnrollmentsTable)
        .values({
          recurringId: klass.id,
          studentId: user.userId,
          cycleIndex: cycle.index,
          amountPaid: quote.amount,
          platformShare: quote.platformShare,
          teacherShare: quote.teacherShare,
          sessionsPaidFor: quote.sessionsRemaining,
          sessionsPlanned: quote.sessionsPlanned,
          status: "active",
        })
        .returning();

      return { kind: "ok" as const, enrolment: enrolment!, quote, reference };
    });

    switch (result.kind) {
      case "already":
        res.json({ enrolment: result.enrolment, alreadyHad: true });
        return;
      case "full":
        res.status(409).json({ error: result.reason });
        return;
      case "no-classes-left":
        res.status(409).json({
          error: "There are no classes left this month. You can join when the next month starts.",
          startsNextCycle: true,
          nextCycleStartsAt: new Date(cycle.end).toISOString(),
        });
        return;
      case "declined":
        res.status(402).json({ error: result.message ?? "That payment could not be completed." });
        return;
      default:
        break;
    }

    /*
     * Into the classes of theirs that already exist.
     *
     * Tomorrow's class may already have been materialised, with enrolments for whoever was
     * enrolled at the time. Without this the student holds a place in the month and is refused
     * at the door of the very next class — which is exactly the shape of the bug this project
     * had when the socket and the room route disagreed about membership.
     *
     * Outside the transaction and tolerant of failure: they have paid and hold their place, and
     * the sweep that runs on every read will put them into anything this missed.
     */
    try {
      await enrolInMaterialisedDays(klass.id, cycle.index, user.userId, now);
    } catch (err) {
      req.log?.warn({ err, klass: klass.id, student: user.userId }, "could not add a new monthly student to the classes already created");
    }

    // The same switch a teacher gets ordinary bookings on. Somebody paying them is somebody
    // paying them, whether it was for one class or for a month of them.
    notify(klass.teacherId, {
      kind: "session_booked",
      at: new Date().toISOString(),
      fromUserId: user.userId,
      topic: `${klass.subject} — ${klass.topic}`,
      amount: result.quote.amount,
    });

    res.status(201).json({ enrolment: result.enrolment, quote: result.quote });
  } catch (err) {
    // recurring_enrollments_once_idx is what actually stops a double charge; a race that gets
    // past the read above lands here, and the student is told they already hold a place.
    const again = await enrolmentFor(klass.id, user.userId, cycle.index);
    if (again) {
      res.json({ enrolment: again, alreadyHad: true });
      return;
    }
    req.log?.error({ err }, "could not join a monthly class");
    res.status(500).json({ error: "Could not join the class. Please try again." });
  }
});

/**
 * Moves the daily time.
 *
 * The owner's rule is eighteen hours' notice before the next class, and it is judged against
 * that class rather than against the clock in the abstract — a teacher with no class until
 * Friday can change Friday's time on Wednesday.
 */
router.patch("/monthly/classes/:id/time", requireAuth, async (req: Request, res: Response) => {
  const id = idParam(req);
  if (id === null) {
    res.status(400).json({ error: "Invalid class id" });
    return;
  }
  const user = req.user!;
  const klass = await classById(id);
  if (!klass) {
    res.status(404).json({ error: "Class not found" });
    return;
  }
  if (klass.teacherId !== user.userId) {
    res.status(403).json({ error: "Only the teacher can change this class." });
    return;
  }

  const { startMinute } = req.body as { startMinute?: number };
  if (!isValidStartMinute(startMinute ?? -1)) {
    res.status(400).json({ error: "Pick a time of day for the class." });
    return;
  }
  if (startMinute === klass.startMinute) {
    res.json({ class: await describeClass(klass, user.userId), unchanged: true });
    return;
  }

  const next = await nextClassDay(klass.id);
  const verdict = canChangeTime(next ? next.scheduledFor : null);
  if (!verdict.ok) {
    res.status(409).json({ error: verdict.reason, noticeHours: TIME_CHANGE_NOTICE_HOURS });
    return;
  }

  const [plan] = await db.select().from(teacherPlansTable).where(eq(teacherPlansTable.id, klass.planId));
  const cycle = plan ? await cycleOf(plan) : null;
  if (!plan || !cycle) {
    res.status(409).json({ error: "That class has not started its first month yet." });
    return;
  }
  const anchorMs = plan.cycleAnchor ? plan.cycleAnchor.getTime() : cycle.start;

  const was = klass.startMinute;
  let change;
  try {
    change = await changeDailyTime(klass, anchorMs, startMinute!);
  } catch (err) {
    req.log?.error({ err, klass: klass.id }, "could not move a monthly class's daily time");
    res.status(500).json({ error: "Could not move the class. Nothing was changed — please try again." });
    return;
  }

  /*
   * Told, not left to notice.
   *
   * Everybody holding a place is sent the same notification an ordinary rescheduled class
   * sends, with where it was and where it is now. A student who does not hear about this turns
   * up to an empty room, which is the single most damaging thing a class can do to somebody
   * who paid for it.
   */
  if (change.studentIds.length > 0) {
    notifyMany(change.studentIds, {
      kind: "session_rescheduled",
      at: new Date().toISOString(),
      fromUserId: user.userId,
      topic: `${klass.subject} — ${klass.topic}`,
      previousDate: formatStartMinute(was),
      newDate: formatStartMinute(startMinute!),
    });
  }

  const updated = await classById(klass.id);
  res.json({
    class: await describeClass(updated, user.userId),
    moved: change.moved,
    classesMoved: change.classesMoved,
    studentsTold: change.studentIds.length,
    previousStartTime: formatStartMinute(was),
    startTime: formatStartMinute(startMinute!),
    nextClassAt: change.nextAt ? change.nextAt.toISOString() : null,
    noticeHours: TIME_CHANGE_NOTICE_HOURS,
    maxDailyMinutes: MAX_DAILY_MINUTES,
  });
});

export default router;
