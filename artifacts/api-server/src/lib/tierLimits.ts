/**
 * What a teacher's subscription entitles them to, and whether a new class would exceed it.
 *
 * This is the revenue model for ordinary pay-per-class teaching. Sikshya takes **no commission
 * on a booking** — deliberately, and there is a note saying so where the booking transaction
 * lives, because the absence looks like an oversight and is not. What is sold instead is
 * capacity: a teacher buys a tier, and the tier says how many classes they may run.
 *
 * Entirely separate from the NPR 6,500 monthly recurring-class tier in `monthly.ts`, which has
 * its own table and its own rules. A teacher may hold both, and a day of a recurring class does
 * **not** count against the allowance here — they paid for that separately. See
 * `sessionAllowance.ts`, which is what excludes them.
 *
 * ## No imports, on purpose
 *
 * Node's `--experimental-strip-types` cannot resolve extensionless workspace imports, so a file
 * that imports `@workspace/db` cannot be unit-tested at all. Every rule about who may teach how
 * much therefore lives here, where it can be tested directly, and the database query that feeds
 * it sits next door in `sessionAllowance.ts`. Same split as `tickets.ts`, `operators.ts` and
 * `videoCost.ts`.
 */

export const SUBSCRIPTION_TIERS = {
  base: { sessions: 10, price: 2000 },
  tier1: { sessions: 15, price: 2800 },
  tier2: { sessions: 20, price: 3500 },
  tier3: { sessions: 25, price: 4220 },
  tier4: { sessions: 30, price: 4700 },
} as const;

export type SubscriptionTierKey = keyof typeof SUBSCRIPTION_TIERS;

/** Human names, so a refusal can say "Base" rather than "base" or, worse, "tier1". */
export const TIER_NAMES: Record<SubscriptionTierKey, string> = {
  base: "Base",
  tier1: "Tier 1",
  tier2: "Tier 2",
  tier3: "Tier 3",
  tier4: "Tier 4",
};

/**
 * A month, for the purpose of an allowance, is **thirty times twenty-four hours**.
 *
 * Never a calendar month, and this is not a stylistic choice. `MONTHLY.md` sets the rule for
 * the whole product: a Bikram Sambat month runs 29 to 32 days and a Gregorian one 28 to 31, so
 * anything priced off "a month" costs two different amounts depending on which calendar
 * somebody's phone is set to. Bikram Sambat and Gregorian are display only, everywhere.
 *
 * Reusing that same constant here rather than inventing a second kind of month means a teacher
 * holding both tiers is never subject to two different definitions of the word.
 */
export const TIER_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function isTierKey(value: unknown): value is SubscriptionTierKey {
  return typeof value === "string" && Object.hasOwn(SUBSCRIPTION_TIERS, value);
}

/** The tier a stored value names, falling back to the cheapest rather than throwing. */
export function tierOf(stored: string | null | undefined): {
  key: SubscriptionTierKey;
  sessions: number;
  price: number;
} {
  const key: SubscriptionTierKey = isTierKey(stored) ? stored : "base";
  return { key, ...SUBSCRIPTION_TIERS[key] };
}

/** The next tier up, or null at the top. A refusal must not offer an upgrade that cannot be bought. */
export function nextTierAbove(key: SubscriptionTierKey): SubscriptionTierKey | null {
  const order = Object.keys(SUBSCRIPTION_TIERS) as SubscriptionTierKey[];
  const here = order.indexOf(key);
  return here >= 0 && here + 1 < order.length ? order[here + 1]! : null;
}

/**
 * Would adding this class put more than `limit` classes inside any thirty-day stretch?
 *
 * ### Why it is asked this way
 *
 * The obvious implementation is a counter that resets on a date. That needs somewhere to store
 * the date the cycle began — and the only place to put it is a new column on `teacher_profiles`,
 * which is the one change this project has measured as taking the site down: the API redeploys
 * itself while `db:push` is manual, so a new column on a wide table read with bare `select()`s
 * is a 500 on sign-in until somebody runs it by hand. A new table avoids that and is the usual
 * answer, but a whole table to hold one timestamp per teacher is a lot of machinery for a rule
 * that can be read straight off the classes themselves.
 *
 * It is also the more honest question. A counter can drift from what actually happened; the
 * classes cannot. This is the same reasoning that made the monthly tier count black marks from
 * the ledger instead of storing them, so that what a teacher is shown and what they are judged
 * on cannot disagree.
 *
 * ### Why "any stretch" rather than a window ending now
 *
 * Checking only the thirty days *before* the new class lets a teacher stack classes by creating
 * them out of order — make one for the 30th, then one for the 5th, and neither sees the other.
 * Checking both directions bounds the damage but still allows almost twice the limit.
 *
 * Sorting the dates and asking whether any `limit + 1` of them fit inside thirty days is exact,
 * and it is exact in both directions at once: if such a group exists this refuses, and if none
 * exists there is genuinely no thirty-day stretch anywhere on the calendar holding more than
 * the allowance. It costs one sort of a small list.
 *
 * @param existing  Scheduled instants (ms) of the teacher's other classes near the candidate.
 * @param candidate The instant (ms) the new class is scheduled for.
 * @param limit     Classes allowed in a window. A limit of zero or less refuses everything.
 * @param windowMs  How long a window is. Defaults to a month as defined above.
 */
export function windowWouldOverflow(
  existing: readonly number[],
  candidate: number,
  limit: number,
  windowMs: number = TIER_WINDOW_MS,
): boolean {
  if (limit <= 0) return true;
  const all = [...existing, candidate].sort((a, b) => a - b);
  // Whether any run of `limit + 1` classes is short enough to sit inside one window.
  for (let i = 0; i + limit < all.length; i++) {
    if (all[i + limit]! - all[i]! < windowMs) return true;
  }
  return false;
}

/**
 * The soonest instant this class could be scheduled for without overflowing, or null if it
 * already fits.
 *
 * Told to a teacher as "the earliest you can put this is…", which is a thing they can act on.
 * "You are over your limit" alone is not — it leaves them guessing whether to wait a day or a
 * month.
 *
 * The answer is bounded by the classes already in the way: moving the candidate later can only
 * help once it clears a window that some existing run of `limit` classes occupies. So the only
 * instants worth testing are just after each existing class leaves a window, and the earliest
 * of those that works is the answer.
 */
export function earliestFittingDate(
  existing: readonly number[],
  candidate: number,
  limit: number,
  windowMs: number = TIER_WINDOW_MS,
): number | null {
  if (limit <= 0) return null;
  if (!windowWouldOverflow(existing, candidate, limit, windowMs)) return null;

  // Each existing class stops constraining a window one millisecond after it falls out of it.
  const tries = [...new Set(existing.map((t) => t + windowMs))]
    .filter((t) => t > candidate)
    .sort((a, b) => a - b);

  for (const t of tries) {
    if (!windowWouldOverflow(existing, t, limit, windowMs)) return t;
  }
  return null;
}

export interface AllowanceVerdict {
  allowed: boolean;
  /** The tier in force. */
  tier: SubscriptionTierKey;
  /** Classes the tier includes per window. */
  limit: number;
  /** Classes already in the window this one would join. Only meaningful when refused. */
  usedNearby: number;
  /** Earliest instant this class would fit, as an ISO string. Null when it fits, or when nothing helps. */
  freesAt: string | null;
  /** The tier that would allow it, if buying one would. */
  upgradeTo: SubscriptionTierKey | null;
  /** Plain language for the teacher. Empty when allowed. */
  message: string;
}

/**
 * How many of the teacher's classes sit in the fullest window containing this date.
 *
 * Used only to tell a teacher a true number in the refusal. Counting everything within thirty
 * days either side would overstate it, because those cannot all be in one window.
 */
function busiestWindowCount(
  existing: readonly number[],
  candidate: number,
  windowMs: number,
): number {
  const all = [...existing, candidate].sort((a, b) => a - b);
  let most = 1;
  for (let i = 0; i < all.length; i++) {
    let n = 0;
    for (let j = i; j < all.length && all[j]! - all[i]! < windowMs; j++) n++;
    if (n > most) most = n;
  }
  return most;
}

/**
 * The whole decision, in the shape a route wants it.
 *
 * Dates are handed back as ISO instants and never formatted. The app shows a date in the
 * reader's own calendar — Bikram Sambat for a Nepali user, Gregorian for anyone else — and a
 * server that formatted one would be picking a calendar on their behalf.
 */
export function judgeAllowance(args: {
  tier: string | null | undefined;
  /** The teacher's other class instants near the candidate, in ms. */
  existing: readonly number[];
  /** When the new class is scheduled for, in ms. */
  candidate: number;
  windowMs?: number;
}): AllowanceVerdict {
  const windowMs = args.windowMs ?? TIER_WINDOW_MS;
  const { key, sessions: limit } = tierOf(args.tier);

  if (!windowWouldOverflow(args.existing, args.candidate, limit, windowMs)) {
    return {
      allowed: true,
      tier: key,
      limit,
      usedNearby: busiestWindowCount(args.existing, args.candidate, windowMs),
      freesAt: null,
      upgradeTo: null,
      message: "",
    };
  }

  const freesAtMs = earliestFittingDate(args.existing, args.candidate, limit, windowMs);
  const up = nextTierAbove(key);
  // Only offer an upgrade that would actually take this class. Offering one that would refuse
  // it again is worse than offering none — the teacher pays and is still stuck.
  const upgradeHelps =
    up !== null && !windowWouldOverflow(args.existing, args.candidate, SUBSCRIPTION_TIERS[up].sessions, windowMs);

  const days = Math.round(windowMs / 86_400_000);
  const parts = [
    `Your ${TIER_NAMES[key]} plan includes ${limit} classes every ${days} days, ` +
      `and you already have ${limit} within ${days} days of this date.`,
  ];
  if (freesAtMs !== null) parts.push("Pick a later date,");
  else parts.push("Try a different date,");
  if (upgradeHelps && up) {
    parts.push(
      `or upgrade to ${TIER_NAMES[up]} — ${SUBSCRIPTION_TIERS[up].sessions} classes ` +
        `for NPR ${SUBSCRIPTION_TIERS[up].price.toLocaleString("en-US")} a month.`,
    );
  } else {
    parts.push("or cancel one of the classes already booked around it.");
  }

  return {
    allowed: false,
    tier: key,
    limit,
    usedNearby: busiestWindowCount(args.existing, args.candidate, windowMs),
    freesAt: freesAtMs === null ? null : new Date(freesAtMs).toISOString(),
    upgradeTo: upgradeHelps ? up : null,
    message: parts.join(" "),
  };
}
