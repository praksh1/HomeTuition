import { and, asc, count, eq, gt, inArray, sql } from "drizzle-orm";
import {
  db,
  recurringDaysTable,
  recurringEnrollmentsTable,
  recurringSessionsTable,
  teacherPlansTable,
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
