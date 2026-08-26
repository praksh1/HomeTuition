import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import {
  db,
  recurringDaysTable,
  recurringEnrollmentsTable,
  recurringSessionsTable,
  refundsTable,
  sessionEnrollmentsTable,
  sessionsTable,
  teacherPlansTable,
  usersTable,
  type RecurringSession,
  type TeacherPlan,
  teacherLeaveTable,
} from "@workspace/db";
import {
  CYCLE_DAYS,
  MAKEUP_DEADLINE_HOURS,
  SUSPENSION_DAYS,
  abuseStanding,
  canAddMakeup,
  cycleAt,
  cycleEnd,
  planCycleAnchor,
  refundClawback,
  shortfallRefund,
  stoppedEarlyRefund,
  suspensionEnds,
  type Clawback,
} from "./monthly";
import { classInstants, instantOfLocalTime, localDayKey } from "./monthlySchedule";

/** Anything that can run a query — the database, or a transaction on it. */
type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The teacher's live plan, or null if they have not bought the tier. */
export async function activePlanFor(teacherId: number, conn: Db = db): Promise<TeacherPlan | null> {
  const [plan] = await conn
    .select()
    .from(teacherPlansTable)
    .where(and(eq(teacherPlansTable.teacherId, teacherId), eq(teacherPlansTable.status, "active")));
  return plan ?? null;
}

/**
 * The teacher's plan whatever state it is in — including suspended.
 *
 * `activePlanFor` deliberately answers "may they act?", and every route that lets a teacher do
 * something asks that one. But a suspended teacher opening their app was shown *no plan at
 * all*, as though they had never bought it: the suspension, the reason and the date it lifts
 * all vanished at the moment they most needed reading. Screens that report state ask this one.
 */
export async function currentPlanFor(teacherId: number, conn: Db = db): Promise<TeacherPlan | null> {
  const [plan] = await conn
    .select()
    .from(teacherPlansTable)
    .where(eq(teacherPlansTable.teacherId, teacherId))
    .orderBy(desc(teacherPlansTable.id))
    .limit(1);
  return plan ?? null;
}

/** The recurring class a plan runs, or null before the teacher has created it. */
export async function classForPlan(planId: number, conn: Db = db): Promise<RecurringSession | null> {
  // Not filtered by status: suspending a plan ends its class, and a teacher still has to be
  // able to see the class that was taken away from them and what happened in it.
  const [found] = await conn
    .select()
    .from(recurringSessionsTable)
    .where(eq(recurringSessionsTable.planId, planId))
    .orderBy(desc(recurringSessionsTable.id))
    .limit(1);
  return found ?? null;
}

export async function classById(id: number, conn: Db = db): Promise<RecurringSession | null> {
  const [found] = await conn.select().from(recurringSessionsTable).where(eq(recurringSessionsTable.id, id));
  return found ?? null;
}

/**
 * Works out which cycle a plan is in right now, starting its clock if it is time to.
 *
 * The anchor is normally set the moment the teacher creates their recurring class. A plan that
 * was paid for and never used would otherwise sit anchorless forever, having bought nothing, so
 * `planCycleAnchor` starts the clock anyway after `PLAN_AUTOSTART_DAYS` — and this is where that
 * decision is written down, once, rather than being recomputed differently by each caller.
 *
 * Returns null only while the plan is inside its grace period with no class created yet.
 */
export async function cycleOf(
  plan: TeacherPlan,
  now: number = Date.now(),
  conn: Db = db,
): Promise<{ index: number; start: number; end: number } | null> {
  let anchorMs = plan.cycleAnchor ? plan.cycleAnchor.getTime() : null;

  if (anchorMs === null) {
    const started = planCycleAnchor(plan.purchasedAt, null, now);
    if (started === null) return null;
    anchorMs = started;
    // Persist it, so the autostart happens once rather than being re-decided on every read.
    await conn
      .update(teacherPlansTable)
      .set({ cycleAnchor: new Date(anchorMs) })
      .where(and(eq(teacherPlansTable.id, plan.id), sql`cycle_anchor is null`));
  }

  return cycleAt(anchorMs, now);
}

/**
 * Writes the class-days for one cycle.
 *
 * Idempotent by construction rather than by checking first: `recurring_days_slot_idx` makes a
 * (class, instant, kind) unique, and `onConflictDoNothing` leans on it. That matters because
 * this runs from a request handler — a teacher double-tapping "create", two requests racing, a
 * redeploy mid-run — and a doubled ledger is a doubled refund.
 *
 * Returns how many class-days the cycle ended up holding, which is the denominator every rate
 * in the cycle is divided by. It is counted, never assumed to be thirty.
 */
export async function generateCycle(
  klass: RecurringSession,
  cycleIndex: number,
  cycleStartMs: number,
  conn: Db = db,
): Promise<number> {
  const endMs = cycleEnd(cycleStartMs);
  if (endMs === null) return 0;

  const instants = classInstants(cycleStartMs, endMs, klass.startMinute, klass.timeZone);
  if (instants.length === 0) return 0;

  await conn
    .insert(recurringDaysTable)
    .values(
      instants.map((at) => ({
        recurringId: klass.id,
        cycleIndex,
        kind: "regular" as const,
        scheduledFor: new Date(at),
        status: "planned" as const,
      })),
    )
    .onConflictDoNothing();

  return countRegularDays(klass.id, cycleIndex, conn);
}

/** How many ordinary class-days a cycle holds. Make-ups are excluded: see the join route. */
export async function countRegularDays(
  recurringId: number,
  cycleIndex: number,
  conn: Db = db,
): Promise<number> {
  const [row] = await conn
    .select({ n: count() })
    .from(recurringDaysTable)
    .where(
      and(
        eq(recurringDaysTable.recurringId, recurringId),
        eq(recurringDaysTable.cycleIndex, cycleIndex),
        eq(recurringDaysTable.kind, "regular"),
      ),
    );
  return row?.n ?? 0;
}

/** How many ordinary class-days of a cycle are still ahead of `now`. */
export async function countRemainingDays(
  recurringId: number,
  cycleIndex: number,
  now: number = Date.now(),
  conn: Db = db,
): Promise<number> {
  const [row] = await conn
    .select({ n: count() })
    .from(recurringDaysTable)
    .where(
      and(
        eq(recurringDaysTable.recurringId, recurringId),
        eq(recurringDaysTable.cycleIndex, cycleIndex),
        eq(recurringDaysTable.kind, "regular"),
        inArray(recurringDaysTable.status, ["planned"]),
        gt(recurringDaysTable.scheduledFor, new Date(now)),
      ),
    );
  return row?.n ?? 0;
}

export interface CycleLedger {
  planned: number;
  held: number;
  missed: number;
  cancelled: number;
  makeups: number;
  total: number;
}

/**
 * What actually became of a cycle's class-days.
 *
 * This is the ledger the delivery floor, the make-up allowance and the abuse count are all read
 * from — one grouped query rather than four counts, so the numbers can never be from different
 * moments and disagree with each other.
 */
export async function ledgerFor(
  recurringId: number,
  cycleIndex: number,
  conn: Db = db,
): Promise<CycleLedger> {
  const rows = await conn
    .select({ status: recurringDaysTable.status, kind: recurringDaysTable.kind, n: count() })
    .from(recurringDaysTable)
    .where(
      and(eq(recurringDaysTable.recurringId, recurringId), eq(recurringDaysTable.cycleIndex, cycleIndex)),
    )
    .groupBy(recurringDaysTable.status, recurringDaysTable.kind);

  const ledger: CycleLedger = { planned: 0, held: 0, missed: 0, cancelled: 0, makeups: 0, total: 0 };
  for (const row of rows) {
    const n = Number(row.n);
    ledger.total += n;
    if (row.kind === "makeup") ledger.makeups += n;
    if (row.status === "planned") ledger.planned += n;
    else if (row.status === "held") ledger.held += n;
    else if (row.status === "missed") ledger.missed += n;
    else if (row.status === "cancelled") ledger.cancelled += n;
  }
  return ledger;
}

/** How many students hold a place in a cycle. */
export async function countEnrolled(
  recurringId: number,
  cycleIndex: number,
  conn: Db = db,
): Promise<number> {
  const [row] = await conn
    .select({ n: count() })
    .from(recurringEnrollmentsTable)
    .where(
      and(
        eq(recurringEnrollmentsTable.recurringId, recurringId),
        eq(recurringEnrollmentsTable.cycleIndex, cycleIndex),
        eq(recurringEnrollmentsTable.status, "active"),
      ),
    );
  return row?.n ?? 0;
}

/** A student's place in a given cycle, if they hold one. */
export async function enrolmentFor(
  recurringId: number,
  studentId: number,
  cycleIndex: number,
  conn: Db = db,
) {
  const [found] = await conn
    .select()
    .from(recurringEnrollmentsTable)
    .where(
      and(
        eq(recurringEnrollmentsTable.recurringId, recurringId),
        eq(recurringEnrollmentsTable.studentId, studentId),
        eq(recurringEnrollmentsTable.cycleIndex, cycleIndex),
      ),
    );
  return found ?? null;
}

/** The next class-day still to come, for the eighteen-hour notice rule. */
export async function nextClassDay(recurringId: number, now: number = Date.now(), conn: Db = db) {
  const [found] = await conn
    .select()
    .from(recurringDaysTable)
    .where(
      and(
        eq(recurringDaysTable.recurringId, recurringId),
        eq(recurringDaysTable.status, "planned"),
        gt(recurringDaysTable.scheduledFor, new Date(now)),
      ),
    )
    .orderBy(asc(recurringDaysTable.scheduledFor))
    .limit(1);
  return found ?? null;
}

/**
 * Today's class, or the next one — with the id of the real class behind it.
 *
 * The owner's ask: *"'Monthly Class' should automatically have a link to the 'Daily Session'
 * for that day — a student or a teacher need not go to the Sessions Tab to attend."* They were
 * right that it should be one tap, and the pieces were already there: `materialiseDueDays`
 * turns each class-day into an ordinary `sessions` row, so the class has a real id, a real
 * room and a real door. Nothing linked to it.
 *
 * Looks back as well as forward. A class that started twenty minutes ago is the class somebody
 * opening the app right now wants; `nextClassDay` deliberately only looks ahead, because it
 * answers a different question — when is the next one *due* — and using it here would send a
 * student who is running late to tomorrow.
 */
export async function todaysClassDay(
  recurringId: number,
  now: number = Date.now(),
  conn: Db = db,
) {
  /**
   * How far back to still count a class as "today's".
   *
   * Three hours covers a long class plus a late start, and stops short of yesterday's — which
   * would be worse than showing nothing, because a link to a finished room looks like a link
   * to a live one.
   */
  const lookBackMs = 3 * 60 * 60 * 1000;
  const [found] = await conn
    .select()
    .from(recurringDaysTable)
    .where(
      and(
        eq(recurringDaysTable.recurringId, recurringId),
        gt(recurringDaysTable.scheduledFor, new Date(now - lookBackMs)),
      ),
    )
    .orderBy(asc(recurringDaysTable.scheduledFor))
    .limit(1);
  return found ?? null;
}

/** The cycle length in days, re-exported so route code has one place to read it from. */
export { CYCLE_DAYS };


/**
 * How far ahead a class-day is turned into a real class.
 *
 * A day, so a student opening the app in the evening sees tomorrow's class sitting in their
 * list where every other class of theirs sits. Further ahead would fill the list with a month
 * of identical rows; much less and the class would appear only minutes before it starts, which
 * reads as the app having forgotten about it.
 */
export const MATERIALISE_AHEAD_MS = 24 * 60 * 60 * 1000;

/**
 * How long after a class should have finished before it is judged.
 *
 * A teacher who starts twenty minutes late is still teaching. Judged from the scheduled finish
 * plus an hour, for the same reason `sessions.startedAt` exists at all: staleness measured
 * against the slot rather than against what happened ejects a class that is running.
 */
const SETTLE_GRACE_MS = 60 * 60 * 1000;

/**
 * Turns the class-days that are nearly due into real classes.
 *
 * A monthly class-day becomes an ordinary `sessions` row, and every student holding a place
 * that month is enrolled in it and marked paid. That is deliberate and is the whole reason the
 * monthly tier needs so little new machinery: once the row exists, the class *is* an ordinary
 * class. The video room, the whiteboard, the chat and — most importantly — `membership.ts` all
 * work on it untouched, so there is no second answer to "may this user be in this class?".
 *
 * Runs as a lazy sweep off reads rather than from a scheduler, because this project has no
 * scheduler and inventing one to create a row a day would be a lot of moving parts to get
 * wrong. It is safe to call from anywhere and safe to call at the same time as itself: each
 * class-day is locked and re-checked before its class is created.
 *
 * Returns the ids of the class-days it materialised.
 */
export async function materialiseDueDays(
  klass: RecurringSession,
  now: number = Date.now(),
): Promise<number[]> {
  const due = await db
    .select({ id: recurringDaysTable.id })
    .from(recurringDaysTable)
    .where(
      and(
        eq(recurringDaysTable.recurringId, klass.id),
        eq(recurringDaysTable.status, "planned"),
        isNull(recurringDaysTable.sessionId),
        lt(recurringDaysTable.scheduledFor, new Date(now + MATERIALISE_AHEAD_MS)),
        // And not one that is already over. Settling normally takes past days out of "planned"
        // before this runs, but the two must not depend on each other's order: without a floor
        // here, a settle that failed would have this create a class for every day of a month
        // that finished weeks ago.
        gt(
          recurringDaysTable.scheduledFor,
          new Date(now - klass.durationMinutes * 60_000 - SETTLE_GRACE_MS),
        ),
      ),
    )
    .orderBy(asc(recurringDaysTable.scheduledFor));

  if (due.length === 0) return [];

  const [teacher] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, klass.teacherId));

  const made: number[] = [];
  for (const day of due) {
    const createdId = await db.transaction(async (tx) => {
      // Re-read under a lock. Two readers hitting this at the same instant would otherwise
      // both see an unmaterialised day and create two classes for it.
      const [locked] = await tx
        .select({
          id: recurringDaysTable.id,
          sessionId: recurringDaysTable.sessionId,
          status: recurringDaysTable.status,
          cycleIndex: recurringDaysTable.cycleIndex,
          scheduledFor: recurringDaysTable.scheduledFor,
        })
        .from(recurringDaysTable)
        .where(eq(recurringDaysTable.id, day.id))
        .for("update");

      if (!locked || locked.sessionId !== null || locked.status !== "planned") return null;

      const students = await tx
        .select({ studentId: recurringEnrollmentsTable.studentId })
        .from(recurringEnrollmentsTable)
        .where(
          and(
            eq(recurringEnrollmentsTable.recurringId, klass.id),
            eq(recurringEnrollmentsTable.cycleIndex, locked.cycleIndex),
            eq(recurringEnrollmentsTable.status, "active"),
          ),
        );

      const [created] = await tx
        .insert(sessionsTable)
        .values({
          teacherId: klass.teacherId,
          teacherName: teacher?.name ?? "",
          subject: klass.subject,
          topic: klass.topic,
          date: locked.scheduledFor,
          duration: klass.durationMinutes,
          maxStudents: klass.maxStudents,
          enrolledCount: students.length,
          // Nobody pays at this door. The month was paid for once, and this class is not for
          // sale on its own — see `isRecurringDay`, which is what refuses the sale.
          price: 0,
          status: "upcoming",
        })
        .returning();

      if (students.length > 0) {
        await tx.insert(sessionEnrollmentsTable).values(
          students.map((s) => ({
            sessionId: created!.id,
            studentId: s.studentId,
            paymentStatus: "paid" as const,
            paymentMethod: "monthly" as const,
          })),
        );
      }

      await tx
        .update(recurringDaysTable)
        .set({ sessionId: created!.id })
        .where(eq(recurringDaysTable.id, day.id));

      return day.id;
    });
    if (createdId !== null) made.push(createdId);
  }
  return made;
}

/**
 * Puts a student into the classes of theirs that already exist.
 *
 * Somebody joining a monthly class part-way through arrives after tomorrow's class has already
 * been materialised, and materialising only creates enrolments for the students who were there
 * at the time. Without this they would hold a place in the month and be refused at the door of
 * the very next class — the exact shape of bug this project has had before.
 */
export async function enrolInMaterialisedDays(
  recurringId: number,
  cycleIndex: number,
  studentId: number,
  now: number = Date.now(),
): Promise<number> {
  const days = await db
    .select({ sessionId: recurringDaysTable.sessionId })
    .from(recurringDaysTable)
    .where(
      and(
        eq(recurringDaysTable.recurringId, recurringId),
        eq(recurringDaysTable.cycleIndex, cycleIndex),
        eq(recurringDaysTable.status, "planned"),
        gt(recurringDaysTable.scheduledFor, new Date(now)),
      ),
    );

  const ids = days.map((d) => d.sessionId).filter((id): id is number => id !== null);
  if (ids.length === 0) return 0;

  let added = 0;
  for (const sessionId of ids) {
    const [existing] = await db
      .select({ id: sessionEnrollmentsTable.id })
      .from(sessionEnrollmentsTable)
      .where(
        and(
          eq(sessionEnrollmentsTable.sessionId, sessionId),
          eq(sessionEnrollmentsTable.studentId, studentId),
        ),
      );
    if (existing) continue;

    await db.insert(sessionEnrollmentsTable).values({
      sessionId,
      studentId,
      paymentStatus: "paid",
      paymentMethod: "monthly",
    });
    await db
      .update(sessionsTable)
      .set({ enrolledCount: sql`${sessionsTable.enrolledCount} + 1` })
      .where(eq(sessionsTable.id, sessionId));
    added += 1;
  }
  return added;
}

/**
 * Writes down what became of the class-days that are now in the past.
 *
 * Held if the teacher actually started the class, missed if they did not. Read from
 * `sessions.startedAt` rather than from anything the teacher is asked to confirm, because the
 * delivery floor and the abuse count are both counted from these rows and a teacher should not
 * be the one telling the ledger whether they turned up.
 */
export async function settleDueDays(
  klass: RecurringSession,
  now: number = Date.now(),
): Promise<{ held: number; missed: number }> {
  const cutoff = new Date(now - klass.durationMinutes * 60_000 - SETTLE_GRACE_MS);

  const held = await db.execute(sql`
    update recurring_days rd
       set status = 'held', held_at = s.started_at
      from sessions s
     where rd.session_id = s.id
       and rd.recurring_id = ${klass.id}
       and rd.status = 'planned'
       and rd.scheduled_for < ${cutoff}
       and s.started_at is not null
  `);

  const missed = await db.execute(sql`
    update recurring_days rd
       set status = 'missed', missed_at = now()
     where rd.recurring_id = ${klass.id}
       and rd.status = 'planned'
       and rd.scheduled_for < ${cutoff}
       and (rd.session_id is null
            or exists (select 1 from sessions s
                        where s.id = rd.session_id and s.started_at is null))
  `);

  return { held: held.rowCount ?? 0, missed: missed.rowCount ?? 0 };
}

/**
 * Is this ordinary-looking class actually a day of somebody's monthly class?
 *
 * The one question that keeps the monthly tier's door shut. A materialised class-day has a
 * price of zero, because the month was paid for once — so if it could be booked like any other
 * class, anybody could take a seat in a paid course for nothing. `POST /sessions/:id/book`
 * asks this and refuses.
 */
export async function isRecurringDay(sessionId: number): Promise<boolean> {
  const [found] = await db
    .select({ id: recurringDaysTable.id })
    .from(recurringDaysTable)
    .where(eq(recurringDaysTable.sessionId, sessionId))
    .limit(1);
  return Boolean(found);
}

/**
 * Which thread a class's chat belongs in.
 *
 * One conversation per class, and for a monthly class the class is the **course**: a teacher
 * saying "bring your compass tomorrow" should not have to pick which of thirty daily threads to
 * say it in, and a student should not have to hunt for it.
 *
 * The owner's worry, in their words: *"users will get confused between which chat they're
 * using — one may write something in one chat and if they're not replying right away they may
 * reply in another link. I just don't want this to be confusing."* The fix is not a better
 * label; it is that there is only one place for it to be.
 */
export async function threadTargetFor(
  sessionId: number,
): Promise<{ sessionId: number; recurringId: null } | { sessionId: null; recurringId: number }> {
  const [day] = await db
    .select({ recurringId: recurringDaysTable.recurringId })
    .from(recurringDaysTable)
    .where(eq(recurringDaysTable.sessionId, sessionId))
    .limit(1);
  return day
    ? { sessionId: null, recurringId: day.recurringId }
    : { sessionId, recurringId: null };
}

/** Keeps materialised class-days out of the public list of classes for sale. */
export const notARecurringDay = sql`not exists (
  select 1 from recurring_days rd where rd.session_id = ${sessionsTable.id}
)`;


export interface TimeChange {
  /** Class-days that moved. */
  moved: number;
  /** Already-created classes whose start moved with them. */
  classesMoved: number;
  /** Students who should be told, across every cycle affected. */
  studentIds: number[];
  /** Where the next class now is, so the teacher can be shown it. */
  nextAt: Date | null;
}

/**
 * Moves the daily time, and every class still to come with it.
 *
 * Each class-day keeps its own local date and changes only its time of day. That cannot
 * collide with `recurring_days_slot_idx`, because a class runs once a day: no two regular
 * class-days of one class share a local date, so no row can land on an instant another row
 * holds. (An earlier note here claimed this needed the same hop-out-and-back that shifting
 * days by whole days does. It does not — that hazard is real only when rows move *across* each
 * other's dates, which a time-of-day change never does.)
 *
 * `cycle_index` is recomputed from the new instant rather than carried over. Moving a class
 * later in the day can carry the last class of a month past the moment that month ends, and a
 * class-day filed under the wrong month is counted against the wrong delivery floor and the
 * wrong set of students' money.
 *
 * Classes already created move too. Leaving those behind is what "half-moving them would
 * strand students" meant: the students would be sitting in a room at the old time while the
 * teacher's class said the new one.
 */
export async function changeDailyTime(
  klass: RecurringSession,
  cycleAnchorMs: number,
  newStartMinute: number,
  now: number = Date.now(),
): Promise<TimeChange> {
  return db.transaction(async (tx) => {
    const days = await tx
      .select({
        id: recurringDaysTable.id,
        sessionId: recurringDaysTable.sessionId,
        scheduledFor: recurringDaysTable.scheduledFor,
        cycleIndex: recurringDaysTable.cycleIndex,
      })
      .from(recurringDaysTable)
      .where(
        and(
          eq(recurringDaysTable.recurringId, klass.id),
          eq(recurringDaysTable.status, "planned"),
          gt(recurringDaysTable.scheduledFor, new Date(now)),
        ),
      )
      .orderBy(asc(recurringDaysTable.scheduledFor));

    const cycles = new Set<number>();
    let classesMoved = 0;
    let nextAt: Date | null = null;

    for (const day of days) {
      const was = day.scheduledFor.getTime();
      const [year, month, date] = localDayKey(was, klass.timeZone).split("-").map(Number);
      const at = instantOfLocalTime(year!, month!, date!, newStartMinute, klass.timeZone);
      const moved = new Date(at);

      const cycle = cycleAt(cycleAnchorMs, at);
      const cycleIndex = cycle ? cycle.index : day.cycleIndex;

      await tx
        .update(recurringDaysTable)
        .set({ scheduledFor: moved, cycleIndex })
        .where(eq(recurringDaysTable.id, day.id));

      if (day.sessionId !== null) {
        await tx.update(sessionsTable).set({ date: moved }).where(eq(sessionsTable.id, day.sessionId));
        classesMoved += 1;
      }

      cycles.add(day.cycleIndex);
      cycles.add(cycleIndex);
      if (nextAt === null || moved < nextAt) nextAt = moved;
    }

    await tx
      .update(recurringSessionsTable)
      .set({ startMinute: newStartMinute, timeChangedAt: new Date(now) })
      .where(eq(recurringSessionsTable.id, klass.id));

    const students = cycles.size
      ? await tx
          .select({ studentId: recurringEnrollmentsTable.studentId })
          .from(recurringEnrollmentsTable)
          .where(
            and(
              eq(recurringEnrollmentsTable.recurringId, klass.id),
              inArray(recurringEnrollmentsTable.cycleIndex, [...cycles]),
              eq(recurringEnrollmentsTable.status, "active"),
            ),
          )
      : [];

    return {
      moved: days.length,
      classesMoved,
      studentIds: [...new Set(students.map((s) => s.studentId))],
      nextAt,
    };
  });
}

/* ------------------------------------------------------------------ enforcement */

/**
 * Black marks against a teacher this month.
 *
 * Counted from the ledger rather than stored. A missed class is a mark only once the
 * forty-eight hours the owner allowed for putting a make-up on the calendar have run out, and
 * a make-up added later clears it — which is what `isAbuse` says, and deriving the count means
 * the two can never drift apart. Suspension, by contrast, *is* recorded: once it has happened
 * it has happened, and a make-up bought afterwards does not undo it.
 */
export async function abusesIn(
  recurringId: number,
  cycleIndex: number,
  now: number = Date.now(),
  conn: Db = db,
): Promise<number> {
  const deadline = new Date(now - MAKEUP_DEADLINE_HOURS * 60 * 60 * 1000);
  const [row] = await conn
    .select({ n: count() })
    .from(recurringDaysTable)
    .where(
      and(
        eq(recurringDaysTable.recurringId, recurringId),
        eq(recurringDaysTable.cycleIndex, cycleIndex),
        eq(recurringDaysTable.status, "missed"),
        lt(recurringDaysTable.missedAt, deadline),
        sql`not exists (
          select 1 from recurring_days m
           where m.makeup_for_id = ${recurringDaysTable.id}
             and m.status <> 'cancelled'
        )`,
      ),
    );
  return row?.n ?? 0;
}

export interface MissedDay {
  id: number;
  scheduledFor: Date;
  missedAt: Date | null;
  madeUpAt: Date | null;
  /** True once this one counts against the teacher. */
  countsAgainstYou: boolean;
  /** When it stops being fixable, or null if it was never judged. */
  deadline: Date | null;
}

/**
 * Every class missed this month, and whether each one counts against the teacher.
 *
 * The same predicate `abusesIn` counts with, so what a teacher is *shown* and what they are
 * *judged on* cannot disagree. They used to: the route did its own arithmetic on `missedAt`,
 * which meant changing the rule in one place silently left the other telling teachers something
 * else. That is the shape of the bug this project already had once, when the whiteboard socket
 * and the video room route each decided for themselves who was allowed in a class.
 */
export async function missedDaysIn(
  recurringId: number,
  cycleIndex: number,
  now: number = Date.now(),
  conn: Db = db,
): Promise<MissedDay[]> {
  const deadlineMs = MAKEUP_DEADLINE_HOURS * 60 * 60 * 1000;
  const rows = await conn
    .select({
      id: recurringDaysTable.id,
      scheduledFor: recurringDaysTable.scheduledFor,
      missedAt: recurringDaysTable.missedAt,
      /*
       * The outer column is written out in full, deliberately, and must not be interpolated.
       *
       * Drizzle renders `${'${recurringDaysTable.id}'}` as a *bare* `"id"` inside a select
       * projection — it only qualifies it as `"recurring_days"."id"` in a where clause. Inside
       * a subquery that selects from the same table, a bare `"id"` binds to the **subquery's**
       * row, so the correlation quietly became `m.makeup_for_id = m.id`, which is never true.
       *
       * Nothing errors. Every make-up simply stops existing: a teacher who had put every missed
       * class right was still shown five black marks and would have been suspended for them.
       * `abusesIn` has the same subquery and is correct only because it sits in a where clause.
       */
      madeUpAt: sql<Date | null>`(
        select m.scheduled_for from recurring_days m
         where m.makeup_for_id = recurring_days.id and m.status <> 'cancelled'
         limit 1
      )`,
      counts: sql<boolean>`(
        recurring_days.missed_at < ${new Date(now - deadlineMs)}
        and not exists (
          select 1 from recurring_days m
           where m.makeup_for_id = recurring_days.id and m.status <> 'cancelled'
        )
      )`,
    })
    .from(recurringDaysTable)
    .where(
      and(
        eq(recurringDaysTable.recurringId, recurringId),
        eq(recurringDaysTable.cycleIndex, cycleIndex),
        eq(recurringDaysTable.status, "missed"),
      ),
    )
    .orderBy(desc(recurringDaysTable.scheduledFor));

  return rows.map((row) => ({
    id: row.id,
    scheduledFor: row.scheduledFor,
    missedAt: row.missedAt,
    madeUpAt: row.madeUpAt ? new Date(row.madeUpAt) : null,
    countsAgainstYou: row.counts === true,
    deadline: row.missedAt ? new Date(row.missedAt.getTime() + deadlineMs) : null,
  }));
}

/** How many make-up classes a month has used. */
export async function makeupsIn(
  recurringId: number,
  cycleIndex: number,
  conn: Db = db,
): Promise<number> {
  const [row] = await conn
    .select({ n: count() })
    .from(recurringDaysTable)
    .where(
      and(
        eq(recurringDaysTable.recurringId, recurringId),
        eq(recurringDaysTable.cycleIndex, cycleIndex),
        eq(recurringDaysTable.kind, "makeup"),
        sql`status <> 'cancelled'`,
      ),
    );
  return row?.n ?? 0;
}

/**
 * Makes sure the month a class is currently in has its class-days.
 *
 * Only month zero is written when the class is created. Without this, a class rolls into its
 * second month and has nothing in it: no classes to attend, and — because a price is a count
 * of the classes still to come — nothing to sell either.
 */
export async function ensureCycleGenerated(
  klass: RecurringSession,
  cycleIndex: number,
  cycleStartMs: number,
): Promise<number> {
  const existing = await countRegularDays(klass.id, cycleIndex);
  if (existing > 0) return existing;
  return generateCycle(klass, cycleIndex, cycleStartMs);
}

/** What one student actually received of what they bought, and what the month held overall. */
async function receiptFor(
  recurringId: number,
  cycleIndex: number,
  joinedAt: Date,
  conn: Db = db,
): Promise<number> {
  const [row] = await conn
    .select({ n: count() })
    .from(recurringDaysTable)
    .where(
      and(
        eq(recurringDaysTable.recurringId, recurringId),
        eq(recurringDaysTable.cycleIndex, cycleIndex),
        eq(recurringDaysTable.status, "held"),
        gt(recurringDaysTable.scheduledFor, joinedAt),
      ),
    );
  return row?.n ?? 0;
}

/** Classes held in a month, counting make-ups: a make-up is a class that happened. */
async function heldIn(recurringId: number, cycleIndex: number, conn: Db = db): Promise<number> {
  const [row] = await conn
    .select({ n: count() })
    .from(recurringDaysTable)
    .where(
      and(
        eq(recurringDaysTable.recurringId, recurringId),
        eq(recurringDaysTable.cycleIndex, cycleIndex),
        eq(recurringDaysTable.status, "held"),
      ),
    );
  return row?.n ?? 0;
}

export interface Settlement {
  cycleIndex: number;
  students: number;
  refunded: number;
  fromTeacher: number;
  fromPlatform: number;
}

/**
 * Writes one student's refund and closes their place.
 *
 * The refund row is a debt written down, not money moved — see the note on `refunds`. It is the
 * same table and the same queue an agent already works through, because a monthly refund is not
 * a different kind of promise to somebody and should not need a different person to notice it.
 */
async function settleStudent(
  tx: Db,
  args: {
    recurringId: number;
    cycleIndex: number;
    enrolment: { id: number; studentId: number; amountPaid: number; teacherShare: number; platformShare: number };
    refund: number;
    reason: string;
    now: Date;
  },
): Promise<Clawback> {
  const claw = refundClawback(args.refund, args.enrolment.teacherShare, args.enrolment.platformShare);

  if (claw.refunded > 0) {
    await tx.insert(refundsTable).values({
      sessionId: null,
      studentId: args.enrolment.studentId,
      pricePaid: args.enrolment.amountPaid,
      amount: claw.refunded,
      teacherShare: claw.teacherKeeps,
      platformShare: claw.platformKeeps,
      reason: args.reason,
      recurringId: args.recurringId,
      cycleIndex: args.cycleIndex,
      status: "owed",
    });
  }

  await tx
    .update(recurringEnrollmentsTable)
    .set({ status: claw.refunded > 0 ? "refunded" : "ended", endedAt: args.now })
    .where(eq(recurringEnrollmentsTable.id, args.enrolment.id));

  return claw;
}

/**
 * Closes every month that has finished and not yet been paid up.
 *
 * Idempotent through `settledThroughCycle` on the plan, and that matters more here than
 * anywhere else in this file: closing a month writes refunds, so closing it twice pays twice.
 * The counter is written in the same transaction as the refunds it accounts for.
 *
 * Only months strictly before the current one are closed. A month still running has classes
 * left in it, and judging a teacher on a month they are still teaching would refund students
 * for classes that are about to happen.
 */
export async function settleFinishedCycles(
  klass: RecurringSession,
  plan: TeacherPlan,
  currentCycleIndex: number,
  now: number = Date.now(),
): Promise<Settlement[]> {
  const from = plan.settledThroughCycle + 1;
  if (currentCycleIndex <= from - 1) return [];

  const done: Settlement[] = [];
  for (let index = from; index < currentCycleIndex; index += 1) {
    const settlement = await db.transaction(async (tx) => {
      /*
       * Re-read the counter under a lock: two readers arriving together must not both close
       * the same month and write two sets of refunds.
       *
       * This and the `status = 'active'` filter below are **two independent guards**, and
       * either one alone is enough — which is why removing just one does not fail the suite.
       * Removing both, with ten readers arriving at once, pays every student ten times. Keep
       * both: neither is redundant, they are simply each sufficient.
       */
      const [locked] = await tx
        .select({ settledThroughCycle: teacherPlansTable.settledThroughCycle })
        .from(teacherPlansTable)
        .where(eq(teacherPlansTable.id, plan.id))
        .for("update");
      if (!locked || locked.settledThroughCycle >= index) return null;

      const planned = await countRegularDays(klass.id, index, tx);
      const held = await heldIn(klass.id, index, tx);

      const enrolments = await tx
        .select()
        .from(recurringEnrollmentsTable)
        .where(
          and(
            eq(recurringEnrollmentsTable.recurringId, klass.id),
            eq(recurringEnrollmentsTable.cycleIndex, index),
            eq(recurringEnrollmentsTable.status, "active"),
          ),
        );

      const out: Settlement = { cycleIndex: index, students: 0, refunded: 0, fromTeacher: 0, fromPlatform: 0 };
      for (const enrolment of enrolments) {
        const received = Math.min(
          enrolment.sessionsPaidFor,
          await receiptFor(klass.id, index, enrolment.joinedAt, tx),
        );
        const owed = shortfallRefund({
          amountPaid: enrolment.amountPaid,
          sessionsPaidFor: enrolment.sessionsPaidFor,
          sessionsReceived: received,
          cycleSessionsHeld: held,
          cycleSessionsPlanned: planned,
        });
        const claw = await settleStudent(tx, {
          recurringId: klass.id,
          cycleIndex: index,
          enrolment,
          refund: owed,
          reason: "monthly_shortfall",
          now: new Date(now),
        });
        out.students += 1;
        out.refunded += claw.refunded;
        out.fromTeacher += claw.fromTeacher;
        out.fromPlatform += claw.fromPlatform;
      }

      await tx
        .update(teacherPlansTable)
        .set({ settledThroughCycle: index })
        .where(eq(teacherPlansTable.id, plan.id));

      return out;
    });
    if (settlement) done.push(settlement);
  }
  return done;
}

export interface StandingResult {
  abuses: number;
  suspended: boolean;
  /** Set when this call is the one that suspended them. */
  justSuspended: boolean;
  /** Set when this call is the one that should warn them, with how many marks they have. */
  warnAt: number | null;
  /** Students refunded because the suspension ended their month early. */
  refundedStudents: number;
  refundedTotal: number;
}

/**
 * Counts the black marks, warns, and suspends.
 *
 * The warning is the part the owner was most insistent about: a teacher must be told, in the
 * strongest terms, before the fifth mark takes their class away. It is sent once per new mark
 * rather than on every read — `warnedAtAbuses` is what remembers, and a warning that arrives
 * ten times a day is one nobody reads.
 *
 * Suspending ends the month early for everybody in it, so their money comes back for the part
 * that will not now happen. That is `stoppedEarlyRefund`, not the delivery floor: a teacher
 * suspended on day twenty-eight has usually held exactly twenty-five, and the floor would say
 * they owe nothing while their students still have days left they paid for.
 */
export async function enforceStanding(
  klass: RecurringSession,
  plan: TeacherPlan,
  cycleIndex: number,
  now: number = Date.now(),
): Promise<StandingResult> {
  const abuses = await abusesIn(klass.id, cycleIndex, now);
  const standing = abuseStanding(abuses);

  const result: StandingResult = {
    abuses,
    suspended: plan.status === "suspended",
    justSuspended: false,
    warnAt: null,
    refundedStudents: 0,
    refundedTotal: 0,
  };

  if (plan.status === "suspended") return result;

  if (standing.warn && abuses > plan.warnedAtAbuses) {
    await db
      .update(teacherPlansTable)
      .set({ warnedAtAbuses: abuses })
      .where(and(eq(teacherPlansTable.id, plan.id), lt(teacherPlansTable.warnedAtAbuses, abuses)));
    result.warnAt = abuses;
  }

  if (!standing.suspended) return result;

  const until = suspensionEnds(now);
  const suspended = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: teacherPlansTable.status })
      .from(teacherPlansTable)
      .where(eq(teacherPlansTable.id, plan.id))
      .for("update");
    /*
     * Somebody else got here first. Suspending twice would refund every student twice.
     *
     * As with closing a month: this and the `status = 'active'` filter on the enrolments are
     * two independent guards, each sufficient on its own. Removing both and letting ten
     * readers arrive together refunds everybody ten times over.
     */
    if (!locked || locked.status !== "active") return null;

    await tx
      .update(teacherPlansTable)
      .set({
        status: "suspended",
        suspendedUntil: until === null ? null : new Date(until),
        suspendedReason:
          `Your monthly class is suspended for ${SUSPENSION_DAYS} days. ` +
          `${abuses} classes were missed this month without a make-up being arranged. ` +
          `Your students have been refunded for the rest of the month.`,
      })
      .where(eq(teacherPlansTable.id, plan.id));

    await tx
      .update(recurringSessionsTable)
      .set({ status: "ended" })
      .where(eq(recurringSessionsTable.id, klass.id));

    const enrolments = await tx
      .select()
      .from(recurringEnrollmentsTable)
      .where(
        and(
          eq(recurringEnrollmentsTable.recurringId, klass.id),
          eq(recurringEnrollmentsTable.cycleIndex, cycleIndex),
          eq(recurringEnrollmentsTable.status, "active"),
        ),
      );

    let students = 0;
    let total = 0;
    for (const enrolment of enrolments) {
      const received = Math.min(
        enrolment.sessionsPaidFor,
        await receiptFor(klass.id, cycleIndex, enrolment.joinedAt, tx),
      );
      const owed = stoppedEarlyRefund(enrolment.amountPaid, enrolment.sessionsPaidFor, received);
      const claw = await settleStudent(tx, {
        recurringId: klass.id,
        cycleIndex,
        enrolment,
        refund: owed,
        reason: "monthly_suspension",
        now: new Date(now),
      });
      students += 1;
      total += claw.refunded;
    }

    // The suspended month is settled, so closing it later must not pay again.
    await tx
      .update(teacherPlansTable)
      .set({ settledThroughCycle: cycleIndex })
      .where(and(eq(teacherPlansTable.id, plan.id), lt(teacherPlansTable.settledThroughCycle, cycleIndex)));

    return { students, total };
  });

  if (suspended) {
    result.suspended = true;
    result.justSuspended = true;
    result.refundedStudents = suspended.students;
    result.refundedTotal = suspended.total;
  }
  return result;
}

/**
 * Puts a make-up class on the calendar for a class that was missed.
 *
 * Refuses rather than half-doing it: the allowances are the owner's — five make-ups a month,
 * forty classes a month including them — and a make-up for a class that already has one, or
 * for a class that was never missed, is a mistake rather than a request.
 */
export async function addMakeup(
  klass: RecurringSession,
  missedDayId: number,
  at: Date,
  cycleIndex: number,
): Promise<{ ok: true; id: number } | { ok: false; reason: string }> {
  return db.transaction(async (tx) => {
    const [missed] = await tx
      .select()
      .from(recurringDaysTable)
      .where(and(eq(recurringDaysTable.id, missedDayId), eq(recurringDaysTable.recurringId, klass.id)))
      .for("update");

    if (!missed) return { ok: false as const, reason: "That class is not one of yours." };
    if (missed.status !== "missed") {
      return { ok: false as const, reason: "That class was not missed, so it does not need making up." };
    }

    const [already] = await tx
      .select({ id: recurringDaysTable.id })
      .from(recurringDaysTable)
      .where(and(eq(recurringDaysTable.makeupForId, missedDayId), sql`status <> 'cancelled'`));
    if (already) return { ok: false as const, reason: "A make-up class is already arranged for that one." };

    /**
     * Not onto a day the teacher has already said they are away.
     *
     * The owner's case: somebody going out of town in a fortnight, arranging cover for a class
     * they missed. Without this they can put the make-up inside the trip and miss it too — one
     * absence becoming two, and a student told to turn up for a class nobody will hold.
     *
     * Checked inside the same transaction that creates it, so leave booked at the same moment
     * cannot slip past a check made before it.
     */
    const [away] = await tx
      .select({ startsAt: teacherLeaveTable.startsAt, endsAt: teacherLeaveTable.endsAt, reason: teacherLeaveTable.reason })
      .from(teacherLeaveTable)
      .where(
        and(
          eq(teacherLeaveTable.teacherId, klass.teacherId),
          lte(teacherLeaveTable.startsAt, at),
          gte(teacherLeaveTable.endsAt, at),
        ),
      )
      .limit(1);
    if (away) {
      return {
        ok: false as const,
        reason: away.reason
          ? `You are away then — ${away.reason}. Pick a day you will be here.`
          : "You are away then. Pick a day you will be here.",
      };
    }

    /**
     * Nor on top of a class that is already happening.
     *
     * A make-up at the same moment as an ordinary class-day is one the teacher cannot hold and
     * a student cannot attend, and it would be counted as two classes delivered.
     */
    const slotFrom = new Date(at.getTime() - klass.durationMinutes * 60_000 + 60_000);
    const slotTo = new Date(at.getTime() + klass.durationMinutes * 60_000 - 60_000);
    const [clash] = await tx
      .select({ id: recurringDaysTable.id })
      .from(recurringDaysTable)
      .where(
        and(
          eq(recurringDaysTable.recurringId, klass.id),
          sql`status <> 'cancelled'`,
          gte(recurringDaysTable.scheduledFor, slotFrom),
          lte(recurringDaysTable.scheduledFor, slotTo),
        ),
      )
      .limit(1);
    if (clash) {
      return { ok: false as const, reason: "There is already a class at that time. Pick another slot." };
    }

    const used = await makeupsIn(klass.id, cycleIndex, tx);
    const [total] = await tx
      .select({ n: count() })
      .from(recurringDaysTable)
      .where(
        and(eq(recurringDaysTable.recurringId, klass.id), eq(recurringDaysTable.cycleIndex, cycleIndex)),
      );
    const allowed = canAddMakeup(used, total?.n ?? 0);
    if (!allowed.ok) return { ok: false as const, reason: allowed.reason };

    const [created] = await tx
      .insert(recurringDaysTable)
      .values({
        recurringId: klass.id,
        cycleIndex,
        kind: "makeup",
        scheduledFor: at,
        status: "planned",
        makeupForId: missedDayId,
      })
      .onConflictDoNothing()
      .returning();

    if (!created) {
      return { ok: false as const, reason: "There is already a class at that time." };
    }
    return { ok: true as const, id: created.id };
  });
}
