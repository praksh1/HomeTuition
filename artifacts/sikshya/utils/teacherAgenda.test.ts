import { test } from "node:test";
import assert from "node:assert/strict";
import { teacherAgendaTimeLabel } from "./teacherAgenda.ts";
const format = () => "Calendar date";
test("next Nepal day is Tomorrow even when only minutes away", () => {
  assert.equal(teacherAgendaTimeLabel("2026-09-26T18:20:00Z", format, new Date("2026-09-26T18:10:00Z")), "Tomorrow, 00:05 Nepal time");
});
test("same Nepal day is Today and clock does not use device timezone", () => {
  assert.equal(teacherAgendaTimeLabel("2026-09-26T10:00:00Z", format, new Date("2026-09-26T09:00:00Z")), "Today, 15:45 Nepal time");
});
test("past and distant days use the selected calendar, invalid dates are explicit", () => {
  const now = new Date("2026-09-26T09:00:00Z");
  assert.equal(teacherAgendaTimeLabel("2026-09-24T09:00:00Z", format, now), "Calendar date, 14:45 Nepal time");
  assert.equal(teacherAgendaTimeLabel("bad", format, now), "Time unavailable");
});
