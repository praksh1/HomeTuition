import assert from "node:assert/strict";
import test from "node:test";
import { batchDetailsIssues, batchScheduleIssues, calendarDay, courseScheduleRange, lessonCountInput, prepareClassLessons, reconcileLessonCount, repeatLessons } from "./batchSchedule.ts";

const first = { date: "2026-10-01", time: "10:00", durationMinutes: 60 };
const period = { groupId: 1, index: 0, startsAt: "2026-10-01T04:15:00.000Z", endsAt: "2026-10-31T04:15:00.000Z" };

test("daily regular tuition prepares the teacher's exact count, not a guessed 26", () => {
  const prepared = prepareClassLessons(first, 30, "daily", [], period);
  assert.equal(prepared.ok, true);
  if (prepared.ok) {
    assert.equal(prepared.lessons.length, 30);
    assert.equal(prepared.lessons.at(-1)?.date, "2026-10-30");
  }
  const overflow = prepareClassLessons(first, 31, "daily", [], period);
  assert.equal(overflow.ok, false);
  if (!overflow.ok) assert.match(overflow.message, /Only 30 daily lessons fit.*one lesson per day.*Pick my own dates.*short course/);
});

test("lesson-count entry limits digits and range without allowing an enormous draft", () => {
  for (const [value, expected] of [["", ""], ["0", ""], ["007", "7"], ["15", "15"], ["60", "60"], ["61", "60"], ["999999999", "60"], ["12abc", "12"], ["abcd", ""]])
    assert.equal(lessonCountInput(value!), expected);
});

test("reducing fifty unprepared rows retains the first fifteen including edits", () => {
  const original = [first, ...Array.from({ length: 49 }, () => ({ ...first, date: "" }))];
  const changed = original.map((lesson, index) => index === 0 ? { ...lesson, time: "11:00" } : lesson);
  const resized = reconcileLessonCount(changed, 15, original);
  assert.equal(resized.lessons.length, 15);
  assert.equal(resized.needsConfirmation, false);
  assert.equal(resized.removed, 35);
  assert.equal(resized.lessons[0]?.time, "11:00");
  assert.equal(changed.length, 50);
});

test("removing scheduled or individually edited rows needs explicit confirmation", () => {
  const original = [first, { ...first, date: "2026-10-02" }];
  assert.equal(reconcileLessonCount(original, 1).needsConfirmation, true);
  assert.equal(reconcileLessonCount([first, { ...first, date: "", time: "12:00" }], 1).needsConfirmation, true);
  assert.equal(reconcileLessonCount([first, { ...first, date: "", durationMinutes: 45 }], 1).needsConfirmation, true);
});

test("increasing the count preserves dates and adds blank rows, never duplicate appointments", () => {
  const existing = [first, { ...first, date: "2026-10-02" }];
  const resized = reconcileLessonCount(existing, 4);
  assert.equal(resized.added, 2);
  assert.deepEqual(resized.lessons.slice(0, 2), existing);
  assert.deepEqual(resized.lessons.slice(2).map((lesson) => lesson.date), ["", ""]);
  for (const count of [0, 61, 1.5, NaN, Infinity]) assert.throws(() => reconcileLessonCount(existing, count), /Choose 1 to 60/);
});

test("empty rows from successive preparations remain safely removable after first-lesson edits", () => {
  const existing = [first, { ...first, date: "" }];
  const changed = [{ ...first, time: "11:00" }, existing[1]!];
  const grown = reconcileLessonCount(changed, 4, existing).lessons;
  const baseline = [existing[0]!, existing[1]!, ...grown.slice(2)].map((lesson) => ({ ...lesson }));
  assert.equal(reconcileLessonCount(grown, 1, baseline).needsConfirmation, false);
  grown[3]!.time = "15:00";
  assert.equal(reconcileLessonCount(grown, 1, baseline).needsConfirmation, true);
});

test("short-course dates follow all actual lesson instants and require a complete timetable", () => {
  const last = { date: "2026-12-31", time: "23:30", durationMinutes: 60 };
  assert.deepEqual(courseScheduleRange([first, last], 2), { startsAt: "2026-10-01T04:15:00.000Z", endsAt: "2026-12-31T18:45:00.000Z" });
  assert.deepEqual(courseScheduleRange([last, first], 2), courseScheduleRange([first, last], 2));
  assert.equal(courseScheduleRange([first], 2), null);
  assert.equal(courseScheduleRange([first, { ...last, date: "" }], 2), null);
  assert.equal(courseScheduleRange([first, { ...last, durationMinutes: 120 }], 2), null);
});

test("weekly and twice-weekly patterns require stable chosen weekdays", () => {
  assert.equal(prepareClassLessons(first, 4, "weekly", [4], period).ok, true);
  assert.equal(prepareClassLessons(first, 4, "weekly", [1], period).ok, false);
  const twice = prepareClassLessons(first, 9, "twice_weekly", [1, 4], period);
  assert.equal(twice.ok, true);
  if (twice.ok) assert.equal(twice.lessons.length, 9);
  assert.equal(prepareClassLessons(first, 10, "twice_weekly", [1, 4], period).ok, false);
});

test("alternate days stop at the period boundary and own dates stay unchosen", () => {
  assert.equal(prepareClassLessons(first, 15, "alternate", [], period).ok, true);
  assert.equal(prepareClassLessons(first, 16, "alternate", [], period).ok, false);
  assert.equal(prepareClassLessons(first, 2, "every_two_weeks", [4], period).ok, true);
  assert.equal(prepareClassLessons(first, 4, "every_two_weeks", [4], period).ok, false);
  const own = prepareClassLessons(first, 3, "own", [], period);
  assert.equal(own.ok, true);
  if (own.ok) assert.deepEqual(own.lessons.map((lesson) => lesson.date), ["2026-10-01", "", ""]);
});

const legacyFirst = { date: "2028-02-28", time: "16:30", durationMinutes: 60 };
test("repeat schedule crosses leap day without changing the Nepal time", () => {
  const result = repeatLessons(legacyFirst, 3, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(result, { ok: true, lessons: ["2028-02-28", "2028-02-29", "2028-03-01"].map((date) => ({ ...legacyFirst, date })) });
});
test("weekly lessons cross year and daylight-saving boundaries by calendar days", () => {
  for (const date of ["2026-12-27", "2027-03-07", "2027-10-31"]) {
    const result = repeatLessons({ ...legacyFirst, date }, 3, [0]);
    assert.equal(result.ok, true);
    if (result.ok) result.lessons.forEach((lesson, index) => {
      assert.equal(Date.parse(lesson.date) - Date.parse(date), index * 7 * 86400000);
      assert.equal(lesson.time, "16:30");
    });
  }
});
test("Sunday–Friday schedule skips Saturday and does not silently move first lesson", () => {
  const result = repeatLessons({ ...legacyFirst, date: "2026-09-11" }, 3, [0, 1, 2, 3, 4, 5]);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.lessons.map((lesson) => lesson.date), ["2026-09-11", "2026-09-13", "2026-09-14"]);
  assert.equal(repeatLessons({ ...legacyFirst, date: "2026-09-12" }, 3, [0, 1, 2, 3, 4, 5]).ok, false);
});
test("rejects bad dates, times, durations, counts and day choices", () => {
  for (const date of ["2027-02-29", "2026-04-31", "bad", "2026-13-01"]) {
    assert.equal(calendarDay(date), null);
    assert.equal(repeatLessons({ ...legacyFirst, date }, 3, [1]).ok, false);
  }
  for (const time of ["24:00", "12:60", "9:00", ""]) assert.equal(repeatLessons({ ...legacyFirst, time }, 3, [1]).ok, false);
  for (const count of [0, 61, 1.5, NaN, Infinity]) assert.equal(repeatLessons(legacyFirst, count, [1]).ok, false);
  for (const days of [[], [-1], [7], [1.5]]) assert.equal(repeatLessons(legacyFirst, 3, days).ok, false);
  assert.equal(repeatLessons({ ...legacyFirst, durationMinutes: 120 }, 3, [1]).ok, false);
});
test("generation is bounded, deterministic and does not mutate its input", () => {
  const result = repeatLessons(legacyFirst, 60, [1, 1]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.lessons.length, 60);
  assert.equal(legacyFirst.date, "2028-02-28");
  assert.deepEqual(repeatLessons(legacyFirst, 1, [1]), { ok: true, lessons: [legacyFirst] });
});
test("step validation names bad entries and leaves authority with the server", () => {
  assert.deepEqual(batchDetailsIssues("6", "3000"), []);
  assert.equal(batchDetailsIssues("11", "0").length, 2);
  assert.equal(batchDetailsIssues("", "1.5").length, 2);
  assert.deepEqual(batchScheduleIssues([legacyFirst], Date.parse("2028-02-28T10:44:59Z")), []);
  assert.match(batchScheduleIssues([legacyFirst], Date.parse("2028-02-28T10:45:00Z"))[0]!, /future/);
  assert.deepEqual(batchScheduleIssues([legacyFirst, legacyFirst], 0), [], "overlapping drafts remain saveable; publication is checked by the server");
  assert.match(batchScheduleIssues([{ ...legacyFirst, date: "2027-02-29" }], 0)[0]!, /valid/);
});
