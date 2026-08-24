import { desc, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  recurringEnrollmentsTable,
  recurringSessionsTable,
  teacherPlansTable,
  usersTable,
  type RecurringSession,
} from "@workspace/db";
import { attachUserIfPresent, requireAuth } from "../middlewares/requireAuth";
import { chargeForMonthly } from "../lib/payments";
import { notify, notifyMany } from "../lib/notify";
import {
  MAX_DAILY_MINUTES,
  MAX_STUDENTS,
  PLATFORM_SHARE,
  TEACHER_TIER_PRICE,
  TIME_CHANGE_NOTICE_HOURS,
  abuseStanding,
  canChangeTime,
  canEnrol,
  isAllowedDuration,
  quoteJoin,
} from "../lib/monthly";
import { formatStartMinute, isValidStartMinute } from "../lib/monthlySchedule";
import {
  activePlanFor,
  classById,
  classForPlan,
  countEnrolled,
  countRegularDays,
  countRemainingDays,
  changeDailyTime,
  cycleOf,
  enrolInMaterialisedDays,
  enrolmentFor,
  generateCycle,
  ledgerFor,
  materialiseDueDays,
  nextClassDay,
  settleDueDays,
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
    await settleDueDays(klass);
    await materialiseDueDays(klass);
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
    enrolment: mine
      ? {
          cycleIndex: mine.cycleIndex,
          amountPaid: mine.amountPaid,
          sessionsPaidFor: mine.sessionsPaidFor,
          sessionsPlanned: mine.sessionsPlanned,
          status: mine.status,
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
  const plan = await activePlanFor(user.userId);
  if (!plan) {
    res.json({ plan: null, class: null, tierPrice: TEACHER_TIER_PRICE });
    return;
  }

  const klass = await classForPlan(plan.id);
  if (klass) await bringUpToDate(klass, req.log);
  const cycle = await cycleOf(plan);
  const ledger = klass && cycle ? await ledgerFor(klass.id, cycle.index) : null;
  const standing = ledger ? abuseStanding(ledger.missed) : null;

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
    tierPrice: TEACHER_TIER_PRICE,
    platformShare: PLATFORM_SHARE,
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

  const plan = await activePlanFor(user.userId);
  if (!plan) {
    res.status(402).json({ error: "You need the monthly plan before you can create a monthly class." });
    return;
  }
  if (plan.status === "suspended") {
    res.status(403).json({ error: plan.suspendedReason ?? "This plan is suspended." });
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
