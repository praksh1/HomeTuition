import { and, asc, count, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  db,
  recurringDaysTable,
  recurringEnrollmentsTable,
  recurringSessionsTable,
  sessionEnrollmentsTable,
  sessionsTable,
  teacherPlansTable,
  usersTable,
  type RecurringSession,
  type TeacherPlan,
} from "@workspace/db";
import { CYCLE_DAYS, cycleAt, cycleEnd, planCycleAnchor } from "./monthly";
import { classInstants } from "./monthlySchedule";

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

/** The recurring class a plan runs, or null before the teacher has created it. */
export async function classForPlan(planId: number, conn: Db = db): Promise<RecurringSession | null> {
  const [found] = await conn
    .select()
    .from(recurringSessionsTable)
    .where(and(eq(recurringSessionsTable.planId, planId), eq(recurringSessionsTable.status, "active")));
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

/** Keeps materialised class-days out of the public list of classes for sale. */
export const notARecurringDay = sql`not exists (
  select 1 from recurring_days rd where rd.session_id = ${sessionsTable.id}
)`;
