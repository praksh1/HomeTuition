import { and, eq, gte, lte, ne } from "drizzle-orm";
import { db, sessionsTable, teacherProfilesTable } from "@workspace/db";
import { notARecurringDay } from "./monthlyStore";
import { TIER_WINDOW_MS, judgeAllowance, tierOf, type AllowanceVerdict } from "./tierLimits";

// Re-exported so a route needs one import rather than two.
export { SUBSCRIPTION_TIERS, TIER_NAMES, TIER_WINDOW_MS, tierOf } from "./tierLimits";
export type { AllowanceVerdict, SubscriptionTierKey } from "./tierLimits";

/**
 * Reading a teacher's subscription allowance off the classes themselves.
 *
 * The rules live in `tierLimits.ts`, which imports nothing and is unit-tested. This file only
 * fetches what those rules need. Two things it does are worth knowing about.
 *
 * ### Days of a monthly class do not count
 *
 * A day of a recurring class is materialised as an ordinary `sessions` row — that is the whole
 * point of the design, so the video room, the whiteboard, the chat and `membership.ts` all work
 * on it untouched. It follows that a naive count would charge a teacher's NPR 6,500
 * recurring-class days against the pay-per-class allowance they bought separately, and a
 * monthly teacher would be locked out within a fortnight of a plan they are not using.
 *
 * `notARecurringDay` is the existing guard for exactly this distinction, already used to keep
 * class-days out of Discover. Reused rather than re-derived, per the rule in CLAUDE.md that a
 * question with one answer gets asked in one place.
 *
 * ### The counter on `teacher_profiles` is not used
 *
 * `sessions_this_month` exists on that table and has never been written to since registration
 * sets it to zero — so every teacher's dashboard has been showing "0 sessions this month"
 * forever. It is not repaired here, it is bypassed: a stored counter needs a reset that this
 * project has no scheduler to run, and it can drift from what actually happened. The classes
 * cannot drift from themselves. Same reasoning that made the monthly tier count black marks
 * from the ledger rather than storing them.
 */

/** How wide a net to cast when fetching neighbours: anything that could share a window. */
const NEIGHBOURHOOD_MS = TIER_WINDOW_MS;

/**
 * The instants of the teacher's other classes close enough to `around` to share a window with
 * it.
 *
 * Only classes within one window either side can possibly matter — a class thirty-one days away
 * cannot be in any thirty-day stretch that also holds `around`. Fetching a bounded slice rather
 * than a teacher's whole history keeps this cheap however long they have been teaching.
 *
 * Cancelled classes are left out. A class that was called off was not taught, and holding a
 * slot against a teacher for it would charge them for their own cancellation — which the refund
 * rules already handle, by giving the student the whole price back.
 */
export async function neighbouringClassTimes(args: {
  teacherId: number;
  around: Date;
  /** Excluded from the count, for judging a class that already exists. */
  excludeSessionId?: number;
}): Promise<number[]> {
  const from = new Date(args.around.getTime() - NEIGHBOURHOOD_MS);
  const to = new Date(args.around.getTime() + NEIGHBOURHOOD_MS);

  const rows = await db
    .select({ id: sessionsTable.id, date: sessionsTable.date })
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.teacherId, args.teacherId),
        gte(sessionsTable.date, from),
        lte(sessionsTable.date, to),
        ne(sessionsTable.status, "cancelled"),
        notARecurringDay,
      ),
    );

  return rows
    .filter((r) => r.id !== args.excludeSessionId)
    .map((r) => r.date.getTime());
}

/** The tier a teacher is on. Absent profile means the cheapest, never a crash. */
export async function tierForTeacher(teacherId: number): Promise<string | null> {
  const [row] = await db
    .select({ tier: teacherProfilesTable.subscriptionTier })
    .from(teacherProfilesTable)
    .where(eq(teacherProfilesTable.userId, teacherId))
    .limit(1);
  return row?.tier ?? null;
}

/**
 * May this teacher put a class at this time?
 *
 * The one call a route needs. Returns the verdict, including the words to show the teacher when
 * the answer is no.
 */
export async function mayCreateClassAt(args: {
  teacherId: number;
  when: Date;
  excludeSessionId?: number;
}): Promise<AllowanceVerdict> {
  const [tier, existing] = await Promise.all([
    tierForTeacher(args.teacherId),
    neighbouringClassTimes({
      teacherId: args.teacherId,
      around: args.when,
      excludeSessionId: args.excludeSessionId,
    }),
  ]);

  return judgeAllowance({ tier, existing, candidate: args.when.getTime() });
}

export interface AllowanceSummary {
  tier: string;
  tierName: string;
  /** Classes the plan includes per thirty days. */
  limit: number;
  /** Classes in the busiest thirty-day stretch from now on. */
  used: number;
  /** How many more could be added at the busiest point. Never negative. */
  remaining: number;
  price: number;
}

/**
 * What to show a teacher on their own dashboard.
 *
 * "Used" is the fullest thirty-day stretch among their upcoming classes rather than a count of
 * everything ahead of them, because that is the number the limit is actually about: a teacher
 * with forty classes spread over six months is nowhere near their allowance, and telling them
 * "40 of 10" would be alarming and wrong.
 */
export async function allowanceSummary(teacherId: number, now = new Date()): Promise<AllowanceSummary> {
  const tier = await tierForTeacher(teacherId);
  const { key, sessions: limit, price } = tierOf(tier);

  const rows = await db
    .select({ date: sessionsTable.date })
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.teacherId, teacherId),
        gte(sessionsTable.date, new Date(now.getTime() - TIER_WINDOW_MS)),
        ne(sessionsTable.status, "cancelled"),
        notARecurringDay,
      ),
    );

  const times = rows.map((r) => r.date.getTime()).sort((a, b) => a - b);

  // The fullest window: for each class, how many fall within thirty days after it.
  let busiest = 0;
  for (let i = 0; i < times.length; i++) {
    let n = 0;
    for (let j = i; j < times.length && times[j]! - times[i]! < TIER_WINDOW_MS; j++) n++;
    if (n > busiest) busiest = n;
  }

  const names: Record<string, string> = {
    base: "Base", tier1: "Tier 1", tier2: "Tier 2", tier3: "Tier 3", tier4: "Tier 4",
  };

  return {
    tier: key,
    tierName: names[key] ?? "Base",
    limit,
    used: busiest,
    remaining: Math.max(0, limit - busiest),
    price,
  };
}
