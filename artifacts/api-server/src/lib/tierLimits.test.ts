import assert from "node:assert/strict";
import test from "node:test";
import {
  SUBSCRIPTION_TIERS,
  TIER_WINDOW_MS,
  earliestFittingDate,
  isTierKey,
  judgeAllowance,
  nextTierAbove,
  tierOf,
  windowWouldOverflow,
} from "./tierLimits.ts";

const DAY = 86_400_000;
const start = Date.UTC(2026, 8, 1); // 1 Sep 2026

/** `n` classes, one per day, from `start`. */
function daily(n: number, from = start): number[] {
  return Array.from({ length: n }, (_, i) => from + i * DAY);
}

test("a month is thirty times twenty-four hours, not a calendar month", () => {
  // The whole product depends on this. A calendar month would make the same plan mean
  // different things to a Bikram Sambat reader and a Gregorian one.
  assert.equal(TIER_WINDOW_MS, 30 * 24 * 60 * 60 * 1000);
});

test("the tiers are the ones being sold", () => {
  assert.equal(SUBSCRIPTION_TIERS.base.sessions, 10);
  assert.equal(SUBSCRIPTION_TIERS.base.price, 2000);
  assert.equal(SUBSCRIPTION_TIERS.tier4.sessions, 30);
  assert.equal(SUBSCRIPTION_TIERS.tier4.price, 4700);
});

test("an unknown or missing tier falls back to the cheapest, rather than throwing", () => {
  // A teacher with a corrupt or absent tier must still be able to teach, on the smallest plan.
  assert.equal(tierOf(null).key, "base");
  assert.equal(tierOf(undefined).key, "base");
  assert.equal(tierOf("nonsense").key, "base");
  assert.equal(tierOf("tier3").sessions, 25);
  assert.equal(isTierKey("tier2"), true);
  assert.equal(isTierKey("tier9"), false);
});

test("the top tier has nothing above it", () => {
  assert.equal(nextTierAbove("base"), "tier1");
  assert.equal(nextTierAbove("tier3"), "tier4");
  assert.equal(nextTierAbove("tier4"), null);
});

test("the last class inside the allowance is allowed, and the next one is not", () => {
  // Nine already booked, base plan of ten: the tenth goes through.
  assert.equal(windowWouldOverflow(daily(9), start + 9 * DAY, 10), false);
  // Ten already booked: the eleventh does not.
  assert.equal(windowWouldOverflow(daily(10), start + 10 * DAY, 10), true);
});

test("a class thirty days clear of the others is allowed however full the month was", () => {
  // Ten classes on days 0-9, and a new one 30 days after the first. The first has dropped out
  // of the window by then, so eleven classes exist but no thirty-day stretch holds more than ten.
  assert.equal(windowWouldOverflow(daily(10), start + 30 * DAY, 10), false);
});

test("the boundary is exclusive: exactly thirty days apart is a different window", () => {
  // Two classes, limit one. Thirty days minus a millisecond overlaps; thirty days does not.
  assert.equal(windowWouldOverflow([start], start + TIER_WINDOW_MS - 1, 1), true);
  assert.equal(windowWouldOverflow([start], start + TIER_WINDOW_MS, 1), false);
});

test("classes created out of order cannot be stacked", () => {
  // This is the case a backward-looking window misses. A teacher creates one for day 29 first,
  // then fills in days 0-9. Nothing before day 29 sees it, but the stretch is still overfull.
  const late = start + 29 * DAY;
  assert.equal(windowWouldOverflow([late, ...daily(9)], start + 9 * DAY, 10), true);
});

test("the check is symmetric — a class inserted in the middle is judged the same either way", () => {
  const before = daily(5);
  const after = daily(5, start + 20 * DAY);
  const middle = start + 10 * DAY;
  // Ten already exist within one stretch of the candidate; the eleventh must be refused
  // whichever side it arrives from.
  assert.equal(windowWouldOverflow([...before, ...after], middle, 10), true);
  assert.equal(windowWouldOverflow([...after, ...before], middle, 10), true);
});

test("a limit of zero refuses everything, and never divides by it", () => {
  assert.equal(windowWouldOverflow([], start, 0), true);
  assert.equal(windowWouldOverflow([], start, -3), true);
  assert.equal(earliestFittingDate([], start, 0), null);
});

test("the first class a teacher ever creates is always allowed", () => {
  assert.equal(windowWouldOverflow([], start, 10), false);
  const v = judgeAllowance({ tier: "base", existing: [], candidate: start });
  assert.equal(v.allowed, true);
  assert.equal(v.message, "");
});

test("the date offered as the earliest that fits actually fits", () => {
  const existing = daily(10);
  const when = earliestFittingDate(existing, start + 10 * DAY, 10);
  assert.notEqual(when, null);
  assert.equal(windowWouldOverflow(existing, when!, 10), false);
  // And it is genuinely the earliest: a millisecond sooner still overflows.
  assert.equal(windowWouldOverflow(existing, when! - 1, 10), true);
});

test("a refusal says the true number, not the total near the date", () => {
  // Ten on days 0-9 and ten more on days 40-49. The candidate on day 5 joins the first group
  // only — saying "you have twenty" would be false, however close the second group looks.
  const existing = [...daily(10), ...daily(10, start + 40 * DAY)];
  const v = judgeAllowance({ tier: "base", existing, candidate: start + 5 * DAY });
  assert.equal(v.allowed, false);
  assert.equal(v.usedNearby, 11);
});

test("an upgrade is only offered when it would actually take the class", () => {
  // Base allows 10, Tier 1 allows 15. With 12 in the way, upgrading works.
  const helps = judgeAllowance({ tier: "base", existing: daily(12), candidate: start + 12 * DAY });
  assert.equal(helps.allowed, false);
  assert.equal(helps.upgradeTo, "tier1");
  assert.match(helps.message, /Tier 1/);
  assert.match(helps.message, /2,800/);

  // With 40 in the way, no tier takes it — so offer none rather than sell a plan that refuses.
  const hopeless = judgeAllowance({ tier: "base", existing: daily(40), candidate: start + 15 * DAY });
  assert.equal(hopeless.allowed, false);
  assert.equal(hopeless.upgradeTo, null);
  assert.doesNotMatch(hopeless.message, /upgrade/i);
});

test("the top tier is never told to upgrade", () => {
  // The candidate has to land *inside* the run to overflow it. Thirty classes on thirty
  // consecutive days plus one on the day after spans exactly thirty days, which fits — the
  // first has already left the window. Putting it in the middle is what fills one.
  const v = judgeAllowance({ tier: "tier4", existing: daily(30), candidate: start + 15 * DAY });
  assert.equal(v.allowed, false);
  assert.equal(v.upgradeTo, null);
  assert.doesNotMatch(v.message, /upgrade/i);
});

test("a refusal never formats a date, so the app can show the reader's own calendar", () => {
  const v = judgeAllowance({ tier: "base", existing: daily(10), candidate: start + 10 * DAY });
  assert.equal(v.allowed, false);
  // The instant is handed over machine-readable...
  assert.ok(v.freesAt && !Number.isNaN(Date.parse(v.freesAt)));
  // ...and the words carry no month name, which would pick a calendar for a Nepali reader.
  assert.doesNotMatch(v.message, /January|February|March|April|May|June|July|August|September|October|November|December/);
  assert.doesNotMatch(v.message, /\d{4}-\d{2}-\d{2}/);
});

test("the message names the plan, the allowance and the window in a teacher's words", () => {
  const v = judgeAllowance({ tier: "tier2", existing: daily(20), candidate: start + 20 * DAY });
  assert.equal(v.allowed, false);
  assert.match(v.message, /Tier 2/);
  assert.match(v.message, /20 classes/);
  assert.match(v.message, /30 days/);
});

test("a higher tier lets through exactly what the lower one refused", () => {
  const existing = daily(10);
  const candidate = start + 10 * DAY;
  assert.equal(judgeAllowance({ tier: "base", existing, candidate }).allowed, false);
  assert.equal(judgeAllowance({ tier: "tier1", existing, candidate }).allowed, true);
});

test("every tier allows exactly the number of classes it sells", () => {
  for (const [key, { sessions }] of Object.entries(SUBSCRIPTION_TIERS)) {
    const existing = daily(sessions - 1);
    const lastAllowed = start + (sessions - 1) * DAY;
    assert.equal(
      judgeAllowance({ tier: key, existing, candidate: lastAllowed }).allowed,
      true,
      `${key} refused its own ${sessions}th class`,
    );
    // Placed inside the run, not after it: a class the day *after* a full run of thirty is
    // exactly thirty days clear of the first and legitimately fits.
    assert.equal(
      judgeAllowance({
        tier: key,
        existing: daily(sessions),
        candidate: start + Math.floor(sessions / 2) * DAY,
      }).allowed,
      false,
      `${key} allowed one more than the ${sessions} it sells`,
    );
  }
});
