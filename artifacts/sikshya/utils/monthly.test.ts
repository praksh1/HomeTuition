import assert from "node:assert/strict";
import { test } from "node:test";
import { formatStartMinute, parseStartMinute, money } from "./monthly.ts";

test("a time of day survives being written down and read back", () => {
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    assert.equal(parseStartMinute(formatStartMinute(minute)), minute, `minute ${minute}`);
  }
});

test("times read the way a teacher writes them", () => {
  assert.equal(formatStartMinute(0), "00:00");
  assert.equal(formatStartMinute(16 * 60), "16:00");
  assert.equal(formatStartMinute(16 * 60 + 30), "16:30");
  assert.equal(formatStartMinute(1439), "23:59");
});

test("something that is not a time is refused rather than becoming midnight", () => {
  /**
   * The failure that matters. A teacher typing "half four" and getting a class at 00:00 would
   * find out from a student, in the morning.
   */
  for (const bad of ["", "half four", "4pm", "16", "16:0", "25:00", "16:60", "-1:00", "abc", "16:3o"]) {
    assert.equal(parseStartMinute(bad), null, `"${bad}" was accepted`);
  }
});

test("spacing is forgiven, because it is not the teacher's mistake", () => {
  assert.equal(parseStartMinute(" 16:30 "), 990);
  assert.equal(parseStartMinute("16 : 30"), 990);
  assert.equal(parseStartMinute("9:05"), 545);
});

test("money is written one way everywhere", () => {
  assert.equal(money(0), "NPR 0");
  assert.equal(money(3000), "NPR 3,000");
  assert.equal(money(233.4), "NPR 233");
});
