import assert from "node:assert/strict";
import test from "node:test";
import { studentClassSection, studentSessionSection } from "./studentSessionGroups.ts";

const now = Date.parse("2026-09-13T12:00:00Z");
const lesson = (date: string, status = "upcoming") => ({ date, duration: 60, status });

test("a future lesson is upcoming even though its classroom door is still closed", () => {
  assert.equal(studentSessionSection(lesson("2026-09-20T12:00:00Z"), now), "upcoming");
});

test("an elapsed unstarted lesson and an explicitly finished lesson are history", () => {
  assert.equal(studentSessionSection(lesson("2026-09-12T12:00:00Z"), now), "history");
  assert.equal(studentSessionSection(lesson("2026-09-20T12:00:00Z", "completed"), now), "history");
});

test("a continuing class appears once in Upcoming instead of again under History", () => {
  assert.equal(studentClassSection([
    lesson("2026-09-10T12:00:00Z", "completed"),
    lesson("2026-09-20T12:00:00Z"),
  ], now), "upcoming");
});

test("live wins while any lesson is running and history begins after all lessons end", () => {
  assert.equal(studentClassSection([
    lesson("2026-09-13T11:45:00Z", "live"),
    lesson("2026-09-20T12:00:00Z"),
  ], now), "live");
  assert.equal(studentClassSection([
    lesson("2026-09-10T12:00:00Z", "completed"),
    lesson("2026-09-11T12:00:00Z", "cancelled"),
  ], now), "history");
});
