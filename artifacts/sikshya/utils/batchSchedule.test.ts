import assert from "node:assert/strict";
import test from "node:test";
import { batchDetailsIssues, batchScheduleIssues, calendarDay, repeatLessons } from "./batchSchedule.ts";

const first = { date: "2028-02-28", time: "16:30", durationMinutes: 60 };
test("repeat schedule crosses leap day without changing the Nepal time", () => {
  const result = repeatLessons(first, 3, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(result, { ok: true, lessons: ["2028-02-28", "2028-02-29", "2028-03-01"].map((date) => ({ ...first, date })) });
});
test("weekly lessons cross year and daylight-saving boundaries by calendar days", () => {
  for (const date of ["2026-12-27", "2027-03-07", "2027-10-31"]) {
    const result = repeatLessons({ ...first, date }, 3, [0]);
    assert.equal(result.ok, true);
    if (result.ok) result.lessons.forEach((lesson, index) => {
      assert.equal(Date.parse(lesson.date) - Date.parse(date), index * 7 * 86400000);
      assert.equal(lesson.time, "16:30");
    });
  }
});
test("Sunday–Friday schedule skips Saturday and does not silently move first lesson", () => {
  const result = repeatLessons({ ...first, date: "2026-09-11" }, 3, [0, 1, 2, 3, 4, 5]);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.lessons.map((lesson) => lesson.date), ["2026-09-11", "2026-09-13", "2026-09-14"]);
  assert.equal(repeatLessons({ ...first, date: "2026-09-12" }, 3, [0, 1, 2, 3, 4, 5]).ok, false);
});
test("rejects bad dates, times, durations, counts and day choices", () => {
  for (const date of ["2027-02-29", "2026-04-31", "bad", "2026-13-01"]) {
    assert.equal(calendarDay(date), null);
    assert.equal(repeatLessons({ ...first, date }, 3, [1]).ok, false);
  }
  for (const time of ["24:00", "12:60", "9:00", ""]) assert.equal(repeatLessons({ ...first, time }, 3, [1]).ok, false);
  for (const count of [0, 61, 1.5, NaN, Infinity]) assert.equal(repeatLessons(first, count, [1]).ok, false);
  for (const days of [[], [-1], [7], [1.5]]) assert.equal(repeatLessons(first, 3, days).ok, false);
  assert.equal(repeatLessons({ ...first, durationMinutes: 120 }, 3, [1]).ok, false);
});
test("generation is bounded, deterministic and does not mutate its input", () => {
  const result = repeatLessons(first, 60, [1, 1]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.lessons.length, 60);
  assert.equal(first.date, "2028-02-28");
  assert.deepEqual(repeatLessons(first, 1, [1]), { ok: true, lessons: [first] });
});
test("step validation names bad entries and leaves authority with the server", () => {
  assert.deepEqual(batchDetailsIssues("6", "3000"), []);
  assert.equal(batchDetailsIssues("11", "0").length, 2);
  assert.equal(batchDetailsIssues("", "1.5").length, 2);
  assert.deepEqual(batchScheduleIssues([first], Date.parse("2028-02-28T10:44:59Z")), []);
  assert.match(batchScheduleIssues([first], Date.parse("2028-02-28T10:45:00Z"))[0]!, /future/);
  assert.deepEqual(batchScheduleIssues([first, first], 0), [], "overlapping drafts remain saveable; publication is checked by the server");
  assert.match(batchScheduleIssues([{ ...first, date: "2027-02-29" }], 0)[0]!, /valid/);
});
