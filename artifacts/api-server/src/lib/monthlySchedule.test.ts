import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classInstants,
  formatStartMinute,
  instantOfLocalTime,
  isValidStartMinute,
  localDayKey,
  minuteOfDayIn,
  zoneOffsetMs,
} from "./monthlySchedule.ts";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const KTM = "Asia/Kathmandu";

test("Nepal is five and three quarter hours ahead, all year round", () => {
  // The forty-five minutes are the point: an offset assumed in whole hours puts every class
  // in the country a quarter of an hour out.
  for (const month of [0, 3, 6, 9]) {
    assert.equal(zoneOffsetMs(Date.UTC(2026, month, 15, 6, 0), KTM), 5.75 * HOUR);
  }
});

test("four in the afternoon in Kathmandu is quarter past ten UTC", () => {
  const at = instantOfLocalTime(2026, 8, 25, 16 * 60, KTM);
  assert.equal(new Date(at).toISOString(), "2026-08-25T10:15:00.000Z");
  assert.equal(minuteOfDayIn(at, KTM), 16 * 60);
  assert.equal(localDayKey(at, KTM), "2026-08-25");
});

test("a local time round-trips to itself, every minute of the day", () => {
  for (let minute = 0; minute < 24 * 60; minute += 7) {
    const at = instantOfLocalTime(2026, 8, 25, minute, KTM);
    assert.equal(minuteOfDayIn(at, KTM), minute, `minute ${minute} did not survive the trip`);
  }
});

test("a cycle holds thirty classes, and each is at the same time on the clock", () => {
  const anchor = Date.UTC(2026, 7, 24, 12, 15);
  const days = classInstants(anchor, anchor + 30 * DAY, 16 * 60, KTM);
  assert.equal(days.length, 30);
  for (const at of days) assert.equal(minuteOfDayIn(at, KTM), 16 * 60);
  // Every one of them inside the window, none outside it.
  assert.ok(days[0]! >= anchor);
  assert.ok(days[days.length - 1]! < anchor + 30 * DAY);
});

test("the first class is tomorrow when the class time has already passed today", () => {
  // Created at 18:00 local for a class at 16:00: today's is gone.
  const anchor = instantOfLocalTime(2026, 8, 24, 18 * 60, KTM);
  const days = classInstants(anchor, anchor + 30 * DAY, 16 * 60, KTM);
  assert.equal(localDayKey(days[0]!, KTM), "2026-08-25");
  assert.equal(days.length, 30);
});

test("the first class is today when the class time is still to come", () => {
  // Created at 14:00 local for a class at 16:00: today's still counts.
  const anchor = instantOfLocalTime(2026, 8, 24, 14 * 60, KTM);
  const days = classInstants(anchor, anchor + 30 * DAY, 16 * 60, KTM);
  assert.equal(localDayKey(days[0]!, KTM), "2026-08-24");
  assert.equal(days.length, 30);
});

test("a class landing exactly on a cycle boundary belongs to one cycle only", () => {
  /**
   * The case that decides whether the window is half-open. It happens whenever the class time
   * is the time the teacher set the class up — "starts now, same time daily" — because then the
   * anchor *is* a class instant, and so is the moment thirty days later where one cycle ends
   * and the next begins.
   *
   * A window closed at both ends puts that class in both cycles: the student is charged for
   * thirty-one and the teacher is credited for a class they taught once.
   */
  const anchor = instantOfLocalTime(2026, 8, 24, 16 * 60, KTM);
  const first = classInstants(anchor, anchor + 30 * DAY, 16 * 60, KTM);
  const second = classInstants(anchor + 30 * DAY, anchor + 60 * DAY, 16 * 60, KTM);
  assert.equal(first.length, 30, "the boundary class was counted twice in the first cycle");
  assert.equal(second.length, 30);
  assert.equal(first[0], anchor, "the cycle's own first instant is a class");
  assert.equal(second[0], anchor + 30 * DAY, "the boundary class belongs to the second cycle");
  assert.ok(!first.includes(anchor + 30 * DAY), "the boundary class appeared in both cycles");
});

test("consecutive cycles neither repeat a class nor drop one", () => {
  /**
   * The join between one cycle and the next is where a student could be charged for a class
   * that never happens, or attend one nobody was charged for. The windows are half-open on
   * purpose so that the instant a cycle ends belongs to exactly one of them.
   */
  const anchor = instantOfLocalTime(2026, 8, 24, 14 * 60, KTM);
  const first = classInstants(anchor, anchor + 30 * DAY, 16 * 60, KTM);
  const second = classInstants(anchor + 30 * DAY, anchor + 60 * DAY, 16 * 60, KTM);
  const overlap = first.filter((at) => second.includes(at));
  assert.equal(overlap.length, 0, "a class appeared in both cycles");
  assert.equal(first.length + second.length, 60, "a class fell between two cycles");
  // And no gap: the two lists laid end to end are still one class a day apart.
  const all = [...first, ...second];
  for (let i = 1; i < all.length; i += 1) {
    assert.equal(all[i]! - all[i - 1]!, DAY, `classes ${i - 1} and ${i} are not a day apart`);
  }
});

test("a daylight-saving zone does not move the class on the clock", () => {
  /**
   * Nepal has no daylight saving, so this can only ever be exercised somewhere else — which is
   * exactly why it is tested. A fixed +05:45 would pass every test above and fail this one.
   *
   * London goes forward on 29 March 2026. A class at 09:00 must still be at 09:00 after it.
   */
  const before = instantOfLocalTime(2026, 3, 20, 9 * 60, "Europe/London");
  const after = instantOfLocalTime(2026, 4, 10, 9 * 60, "Europe/London");
  assert.equal(minuteOfDayIn(before, "Europe/London"), 9 * 60);
  assert.equal(minuteOfDayIn(after, "Europe/London"), 9 * 60);
  // In UTC they are an hour apart, which is the clock change showing up where it should.
  assert.equal(new Date(before).toISOString(), "2026-03-20T09:00:00.000Z");
  assert.equal(new Date(after).toISOString(), "2026-04-10T08:00:00.000Z");
});

test("a class scheduled into a skipped hour still lands, once", () => {
  // 01:30 on 29 March 2026 does not exist in London: the clocks jump 01:00 → 02:00.
  const at = instantOfLocalTime(2026, 3, 29, 90, "Europe/London");
  assert.ok(Number.isFinite(at), "an impossible local time produced no instant at all");
  const days = classInstants(
    Date.UTC(2026, 2, 27, 0, 0),
    Date.UTC(2026, 3, 1, 0, 0),
    90,
    "Europe/London",
  );
  // Five local dates in the window, and no date represented twice.
  const keys = days.map((d) => localDayKey(d, "Europe/London"));
  assert.equal(new Set(keys).size, keys.length, "a local date got two classes");
});

test("start minutes are checked, and shown as a time rather than a number", () => {
  assert.equal(isValidStartMinute(0), true);
  assert.equal(isValidStartMinute(1439), true);
  assert.equal(isValidStartMinute(1440), false);
  assert.equal(isValidStartMinute(-1), false);
  assert.equal(isValidStartMinute(90.5), false);
  assert.equal(formatStartMinute(0), "00:00");
  assert.equal(formatStartMinute(16 * 60 + 30), "16:30");
  assert.equal(formatStartMinute(1439), "23:59");
});
