import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CYCLE_DAYS,
  MAX_ABUSES_PER_CYCLE,
  MAX_MAKEUPS_PER_CYCLE,
  MIN_SESSIONS_PER_CYCLE,
  PLAN_AUTOSTART_DAYS,
  PLATFORM_SHARE,
  abuseStanding,
  canAddMakeup,
  canChangeTime,
  canEnrol,
  cycleAt,
  cycleEnd,
  deliveryVerdict,
  isAbuse,
  isAllowedDuration,
  metDeliveryFloor,
  metStudentShare,
  planCycleAnchor,
  proRatedShortfall,
  quoteJoin,
  refundClawback,
  shortfallRefund,
  stoppedEarlyRefund,
} from "./monthly.ts";

/**
 * The monthly tier's money, worked through every situation the owner asked about.
 *
 * "Work out every situation where a student and teacher are not out of sync" was the request,
 * so the sync cases are tested as scenarios rather than as functions: a teacher whose cycle
 * starts on an awkward day, a student joining on the last afternoon, a teacher who disappears.
 */

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 7, 24, 6, 0, 0);

test("a cycle is thirty days, not a month in anybody's calendar", () => {
  assert.equal(CYCLE_DAYS, 30);
  assert.equal(cycleEnd(T0), T0 + 30 * DAY);
});

test("a cycle is the same length whatever month it falls in", () => {
  /**
   * The point of not using calendars. A Bikram Sambat month runs 29 to 32 days and a Gregorian
   * one 28 to 31; if a rate came from "a month", the two would disagree about somebody's money.
   */
  const lengths = new Set<number>();
  for (let month = 0; month < 12; month += 1) {
    const start = Date.UTC(2026, month, 1, 6, 0, 0);
    lengths.add((cycleEnd(start) as number) - start);
  }
  assert.equal(lengths.size, 1, "cycles differed in length depending on the month");
});

test("teacher and student are always in the same cycle, because there is only one", () => {
  const anchor = T0;
  // A student joining on day 21 is in the teacher's first cycle, not a calendar month of theirs.
  assert.equal(cycleAt(anchor, anchor + 21 * DAY)?.index, 0);
  // And on day 31 they are both in the second.
  assert.equal(cycleAt(anchor, anchor + 31 * DAY)?.index, 1);
  assert.equal(cycleAt(anchor, anchor + 31 * DAY)?.start, anchor + 30 * DAY);
});

test("a moment before the anchor is the first cycle, not a negative one", () => {
  // A plan is not retroactive; answering "cycle minus one" would only invent a case for callers.
  assert.equal(cycleAt(T0, T0 - 5 * DAY)?.index, 0);
});

test("the cycle starts when the class is created, not when the plan was bought", () => {
  const bought = T0;
  const created = T0 + 3 * DAY;
  assert.equal(planCycleAnchor(bought, created, T0 + 4 * DAY), created);
});

test("but a plan that is never used starts anyway, so the money buys something", () => {
  const bought = T0;
  // Inside the grace with no class: no cycle is running yet.
  assert.equal(planCycleAnchor(bought, null, T0 + 2 * DAY), null);
  // Past it, the cycle starts whether a class was created or not.
  assert.equal(planCycleAnchor(bought, null, T0 + PLAN_AUTOSTART_DAYS * DAY), bought + PLAN_AUTOSTART_DAYS * DAY);
});

test("a student joining part-way pays for the classes left, not the days", () => {
  // 30 planned, 9 left: nine thirtieths of the price.
  const quote = quoteJoin(3000, 9, 30);
  assert.equal(quote.amount, 900);
  assert.equal(quote.sessionsRemaining, 9);
  assert.equal(quote.sessionsPlanned, 30);
});

test("and the denominator is what the cycle actually holds, not thirty by assumption", () => {
  // A teacher who runs 26 classes a cycle: nine of 26, not nine of 30.
  const quote = quoteJoin(3000, 9, 26);
  assert.equal(quote.amount, Math.floor((3000 * 9) / 26));
});

test("the split is thirty per cent to Sikshya and always adds back", () => {
  for (const price of [1, 2, 3, 999, 3000, 6500, 12345]) {
    for (const remaining of [1, 7, 13, 30]) {
      const quote = quoteJoin(price, remaining, 30);
      assert.equal(
        quote.platformShare + quote.teacherShare,
        quote.amount,
        `the shares did not add back for ${price}/${remaining}`,
      );
      assert.ok(quote.platformShare >= 0 && quote.teacherShare >= 0);
    }
  }
  assert.equal(PLATFORM_SHARE, 0.3);
  assert.equal(quoteJoin(1000, 30, 30).platformShare, 300);
});

test("a charge rounds down, so nobody is billed a rupee they do not owe", () => {
  // 1000 × 7 / 30 = 233.33…
  assert.equal(quoteJoin(1000, 7, 30).amount, 233);
});

test("joining with nothing left to attend costs nothing and waits for the next cycle", () => {
  /**
   * Being charged for one class at teatime and then charged in full the next morning is not a
   * thing to do to somebody.
   */
  const quote = quoteJoin(3000, 0, 30);
  assert.equal(quote.amount, 0);
  assert.equal(quote.startsNextCycle, true);
});

test("a full cycle costs the full price", () => {
  const quote = quoteJoin(3000, 30, 30);
  assert.equal(quote.amount, 3000);
  assert.equal(quote.startsNextCycle, false);
});

test("nobody can be quoted for more classes than the cycle holds", () => {
  // A caller that miscounts must not produce a bill above the monthly price.
  assert.equal(quoteJoin(3000, 45, 30).amount, 3000);
});

test("the floor is twenty-five classes", () => {
  assert.equal(MIN_SESSIONS_PER_CYCLE, 25);
  assert.equal(deliveryVerdict(25, 5).met, true);
  assert.equal(deliveryVerdict(24, 6).met, false);
  assert.equal(deliveryVerdict(24, 6).shortBy, 1);
});

test("a teacher who fell short owes back the classes that did not happen", () => {
  // Paid 3000 for 30, received 20: ten thirtieths back. Twenty is under the floor, so it is due.
  assert.equal(shortfallRefund({ amountPaid: 3000, sessionsPaidFor: 30, sessionsReceived: 20, cycleSessionsHeld: 20, cycleSessionsPlanned: 30 }), 1000);
});

test("a shortfall refund rounds up, because it is money going to somebody", () => {
  // 1000 × 1 / 3 = 333.33…
  assert.equal(proRatedShortfall(1000, 3, 2), 334);
});

test("and can never exceed what was paid, whatever it is asked to believe", () => {
  assert.equal(proRatedShortfall(1000, 30, 0), 1000);
  assert.equal(proRatedShortfall(1000, 5, -3), 1000);
});

test("a teacher who delivered everything owes nothing", () => {
  assert.equal(shortfallRefund({ amountPaid: 3000, sessionsPaidFor: 30, sessionsReceived: 30, cycleSessionsHeld: 30, cycleSessionsPlanned: 30 }), 0);
  assert.equal(shortfallRefund({ amountPaid: 3000, sessionsPaidFor: 30, sessionsReceived: 31, cycleSessionsHeld: 31, cycleSessionsPlanned: 30 }), 0);
});

test("nothing is owed above the floor, and the whole shortfall below it", () => {
  /**
   * The owner's rule is a floor, not a sliding scale: "no refunds unless the teacher delivers
   * fewer than 25 sessions". So twenty-five owes nothing and twenty-four owes for all six
   * classes that did not happen — not for the one below the floor.
   */
  assert.equal(shortfallRefund({ amountPaid: 3000, sessionsPaidFor: 30, sessionsReceived: 25, cycleSessionsHeld: 25, cycleSessionsPlanned: 30 }), 0);
  assert.equal(shortfallRefund({ amountPaid: 3000, sessionsPaidFor: 30, sessionsReceived: 24, cycleSessionsHeld: 24, cycleSessionsPlanned: 30 }), 600);
});

test("a student who fell below their share of the floor is owed, even in a month that met it", () => {
  /**
   * The softening the owner agreed to.
   *
   * A student joined with nine classes left and the teacher then missed three of them. Those
   * three cost the teacher three off their cycle too — twenty-seven held, which clears the flat
   * floor, so rule 1 says nothing is owed. But this student received six of the nine they paid
   * for, which is two thirds against a promise of five sixths, so rule 2 says they are.
   *
   * They get back the classes *they* lost — three ninths of what they paid — not the teacher's
   * whole shortfall.
   */
  const quote = quoteJoin(3000, 9, 30);
  assert.equal(metDeliveryFloor(27), true, "the teacher kept the month");
  assert.equal(metStudentShare(6, 9, 30), false, "but not to this student");
  assert.equal(
    shortfallRefund({ amountPaid: quote.amount, sessionsPaidFor: 9, sessionsReceived: 6, cycleSessionsHeld: 27, cycleSessionsPlanned: 30 }),
    Math.ceil((quote.amount * 3) / 9),
  );
});

test("a share is a rate, and reduces to the owner's own rule for a full month", () => {
  // Whoever bought the whole month is asking exactly "did the teacher hold twenty-five?".
  assert.equal(metStudentShare(25, 30, 30), true);
  assert.equal(metStudentShare(24, 30, 30), false);
  // Nine classes bought promises seven and a half. Seven is short of it; eight is not.
  assert.equal(metStudentShare(7, 9, 30), false, "seven of nine is below five sixths");
  assert.equal(metStudentShare(8, 9, 30), true, "eight of nine is above it");
  assert.equal(metStudentShare(9, 9, 30), true);
  // A month that planned no classes promised nothing, so nothing falls short of it.
  assert.equal(metStudentShare(0, 5, 0), true);
  assert.equal(metStudentShare(0, 0, 30), true);
});

test("neither rule takes cover away from somebody the other one protected", () => {
  /**
   * Why it is "either", not "instead of".
   *
   * This student bought nine classes and received eight — above their share — but the teacher
   * held only twenty of thirty across the month. Rule 2 alone would pay them nothing; the rule
   * the owner originally set pays them for the one class they lost. Softening the rule must
   * not quietly remove cover from anybody.
   */
  const quote = quoteJoin(3000, 9, 30);
  assert.equal(metStudentShare(8, 9, 30), true, "this student got their share");
  assert.equal(metDeliveryFloor(20), false, "but the teacher missed the month");
  assert.equal(
    shortfallRefund({ amountPaid: quote.amount, sessionsPaidFor: 9, sessionsReceived: 8, cycleSessionsHeld: 20, cycleSessionsPlanned: 30 }),
    Math.ceil((quote.amount * 1) / 9),
  );
});

test("the floor is judged on the teacher's cycle, not on one student's share of it", () => {
  /**
   * The case that decides whether the two counts really are separate.
   *
   * A student joined with nine classes left and the teacher then missed three of them. Those
   * three cost the teacher three off their cycle too — twenty-seven held, which clears the
   * floor. Judging the floor off the student's six would pay out on a month the teacher
   * delivered, so this must be zero.
   *
   * It being zero is the owner's rule working as written, and it is also the rule at its
   * harshest: this student lost a third of what they bought and gets nothing back. Flagged to
   * the owner rather than quietly changed — see `metDeliveryFloor` in monthly.ts.
   */
  const quote = quoteJoin(3000, 9, 30);
  // A student who got everything they bought is owed nothing, however the month went for
  // anybody else: reading the flat floor off their nine would pay them for a month delivered.
  assert.equal(shortfallRefund({ amountPaid: quote.amount, sessionsPaidFor: 9, sessionsReceived: 9, cycleSessionsHeld: 30, cycleSessionsPlanned: 30 }), 0);
  // The same student, in a cycle the teacher genuinely under-delivered: they get back the
  // classes *they* missed, not the teacher's whole shortfall.
  assert.equal(shortfallRefund({ amountPaid: quote.amount, sessionsPaidFor: 9, sessionsReceived: 6, cycleSessionsHeld: 20, cycleSessionsPlanned: 30 }), Math.ceil((quote.amount * 3) / 9));
});

test("a missed class is not a black mark until the make-up window has passed", () => {
  const missed = T0;
  assert.equal(isAbuse(missed, null, missed + 1 * HOUR), false);
  assert.equal(isAbuse(missed, null, missed + 47 * HOUR), false);
  assert.equal(isAbuse(missed, null, missed + 49 * HOUR), true);
});

test("and a scheduled make-up clears it, however late in the window", () => {
  const missed = T0;
  assert.equal(isAbuse(missed, missed + 47 * HOUR, missed + 100 * HOUR), false);
});

test("five black marks is a suspension, and the warning comes before the last one", () => {
  assert.equal(MAX_ABUSES_PER_CYCLE, 5);
  assert.equal(abuseStanding(0).warn, false);
  assert.equal(abuseStanding(2).warn, false);
  // A warning that arrives with the suspension is a notification, not a warning.
  assert.equal(abuseStanding(3).warn, true);
  assert.equal(abuseStanding(4).warn, true);
  assert.equal(abuseStanding(4).remaining, 1);
  assert.equal(abuseStanding(5).suspended, true);
  assert.equal(abuseStanding(5).warn, false);
  assert.equal(abuseStanding(9).suspended, true);
});

test("the daily time can be moved until eighteen hours before the next class", () => {
  const next = T0 + 40 * HOUR;
  assert.equal(canChangeTime(next, next - 19 * HOUR).ok, true);
  assert.equal(canChangeTime(next, next - 17 * HOUR).ok, false);
});

test("make-ups run out at five, and a cycle cannot hold more than forty classes", () => {
  assert.equal(canAddMakeup(0, 30).ok, true);
  assert.equal(canAddMakeup(MAX_MAKEUPS_PER_CYCLE, 30).ok, false);
  assert.equal(canAddMakeup(1, 40).ok, false);
});

test("a class takes forty-five students and no more", () => {
  assert.equal(canEnrol(44).ok, true);
  assert.equal(canEnrol(45).ok, false);
});

test("a daily class runs ninety minutes at most, in whole minutes", () => {
  assert.equal(isAllowedDuration(90).ok, true);
  assert.equal(isAllowedDuration(91).ok, false);
  assert.equal(isAllowedDuration(45.5).ok, false);
  assert.equal(isAllowedDuration(0).ok, false);
});

/**
 * The situations the owner asked to have worked out, end to end.
 */

test("scenario: a teacher takes leave and vanishes", () => {
  // Student paid for 30, teacher held 8 and then stopped.
  const quote = quoteJoin(3000, 30, 30);
  const owed = stoppedEarlyRefund(quote.amount, quote.sessionsRemaining, 8);
  assert.equal(owed, 2200);
  // And the teacher is well past the floor, so the shortfall route agrees.
  assert.equal(deliveryVerdict(8, 22).met, false);
});

test("scenario: a teacher misses six and makes up five", () => {
  // 30 planned, 6 missed, 5 made up → 29 held, one black mark. Not suspended, but warned.
  assert.equal(deliveryVerdict(29, 1).met, true);
  assert.equal(abuseStanding(1).suspended, false);
  assert.equal(shortfallRefund({ amountPaid: 3000, sessionsPaidFor: 30, sessionsReceived: 29, cycleSessionsHeld: 29, cycleSessionsPlanned: 30 }), 0, "a teacher who met the floor owes nothing");
});

test("scenario: a teacher misses ten and makes up five", () => {
  // 25 held: exactly the floor, five black marks, so suspended even though nobody is owed.
  const verdict = deliveryVerdict(25, 5);
  assert.equal(verdict.met, true);
  assert.equal(shortfallRefund({ amountPaid: 3000, sessionsPaidFor: 30, sessionsReceived: 25, cycleSessionsHeld: 25, cycleSessionsPlanned: 30 }), 0);
  // Meeting the floor is not the same as behaving well. Five unmade-up misses is a suspension.
  assert.equal(abuseStanding(5).suspended, true);
});

test("scenario: a student joins on the last afternoon of a cycle", () => {
  const anchor = T0;
  const joinAt = anchor + 30 * DAY - 2 * HOUR;
  assert.equal(cycleAt(anchor, joinAt)?.index, 0, "still the teacher's first cycle");
  // One class left: they pay for one, not for a month.
  assert.equal(quoteJoin(3000, 1, 30).amount, 100);
  // And the next day both renew together.
  assert.equal(cycleAt(anchor, joinAt + 3 * HOUR)?.index, 1);
});

test("scenario: a student who joined mid-cycle renews on the same day as the teacher", () => {
  const anchor = T0;
  const joined = anchor + 12 * DAY;
  const teacherRenewsAt = cycleAt(anchor, joined)!.end;
  // The student's renewal is the teacher's renewal. There is no second clock to drift.
  assert.equal(teacherRenewsAt, anchor + 30 * DAY);
  assert.equal(cycleAt(anchor, teacherRenewsAt)?.index, 1);
  assert.equal(cycleAt(anchor, teacherRenewsAt)?.start, teacherRenewsAt);
});

test("scenario: a teacher suspended mid-cycle, with students at different depths", () => {
  // One joined at the start and one half-way; both are owed for what will not now happen.
  const early = quoteJoin(3000, 30, 30);
  const late = quoteJoin(3000, 15, 30);
  assert.equal(stoppedEarlyRefund(early.amount, early.sessionsRemaining, 10), 2000);
  assert.equal(stoppedEarlyRefund(late.amount, late.sessionsRemaining, 10), 500);
  // Neither is owed more than they paid.
  assert.ok(stoppedEarlyRefund(late.amount, late.sessionsRemaining, 0) <= late.amount);
});

test("scenario: a teacher suspended late in the cycle still owes the days that remain", () => {
  /**
   * The realistic shape of a suspension. Five misses is what triggers it, so by the time it
   * lands the teacher has usually held twenty-five of thirty — the floor, exactly. The
   * end-of-cycle rule would say they owe nothing.
   *
   * But the cycle has now stopped with days still on it, and those classes will never happen.
   * The owner was explicit: a suspended teacher's students get the remaining period back. So
   * stopping early is judged on what was left, never on the floor.
   */
  const full = quoteJoin(3000, 30, 30);
  assert.equal(shortfallRefund({ amountPaid: full.amount, sessionsPaidFor: 30, sessionsReceived: 25, cycleSessionsHeld: 25, cycleSessionsPlanned: 30 }), 0, "the end-of-cycle rule lets 25 pass");
  assert.equal(stoppedEarlyRefund(full.amount, 30, 25), 500, "stopping early does not");
  // And a teacher suspended having held twenty-seven owes for three, not for nothing.
  assert.equal(stoppedEarlyRefund(full.amount, 30, 27), 300);
});

test("scenario: nobody is charged twice for the same class", () => {
  /**
   * The join quote and the shortfall refund speak the same unit — classes — so a student who
   * pays for nine and receives nine is owed nothing, and one who receives six is owed exactly
   * three classes' worth. Pricing in days and judging in classes would leave a gap here.
   */
  const quote = quoteJoin(3000, 9, 30);
  assert.equal(shortfallRefund({ amountPaid: quote.amount, sessionsPaidFor: 9, sessionsReceived: 9, cycleSessionsHeld: 30, cycleSessionsPlanned: 30 }), 0);
  assert.equal(shortfallRefund({ amountPaid: quote.amount, sessionsPaidFor: 9, sessionsReceived: 6, cycleSessionsHeld: 20, cycleSessionsPlanned: 30 }), Math.ceil((quote.amount * 3) / 9));
});


test("a refund comes out of the teacher's share first, then Sikshya's fee", () => {
  // 3000 paid, split 2100/900. A 1000 refund is entirely the teacher's to carry.
  const small = refundClawback(1000, 2100, 900);
  assert.equal(small.fromTeacher, 1000);
  assert.equal(small.fromPlatform, 0);
  assert.equal(small.teacherKeeps, 1100);
  assert.equal(small.platformKeeps, 900);

  // A refund larger than the teacher's share spills into Sikshya's fee, and no further.
  const big = refundClawback(2500, 2100, 900);
  assert.equal(big.fromTeacher, 2100);
  assert.equal(big.fromPlatform, 400);
  assert.equal(big.teacherKeeps, 0);
  assert.equal(big.platformKeeps, 500);
});

test("a clawback's four numbers always add back to what was paid", () => {
  for (const [refund, teacher, platform] of [
    [0, 2100, 900],
    [1, 2100, 900],
    [3000, 2100, 900],
    [5000, 2100, 900],
    [700, 0, 900],
    [700, 2100, 0],
  ] as const) {
    const c = refundClawback(refund, teacher, platform);
    assert.equal(
      c.refunded + c.teacherKeeps + c.platformKeeps,
      teacher + platform,
      `refunding ${refund} of ${teacher}+${platform} did not add back`,
    );
    assert.equal(c.fromTeacher + c.fromPlatform, c.refunded);
    assert.ok(c.teacherKeeps >= 0 && c.platformKeeps >= 0, "somebody kept a negative amount");
  }
});

test("nobody can be refunded more than was collected", () => {
  const c = refundClawback(99999, 2100, 900);
  assert.equal(c.refunded, 3000);
  assert.equal(c.teacherKeeps, 0);
  assert.equal(c.platformKeeps, 0);
});
