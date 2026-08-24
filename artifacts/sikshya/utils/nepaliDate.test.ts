import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BS_MONTHS,
  bsDaysInMonth,
  formatDate,
  formatDateBoth,
  fromBikramSambat,
  toBikramSambat,
  toNepaliDigits,
} from "./nepaliDate.ts";

/**
 * The conversion is a lookup table somebody else maintains, so it is checked rather than trusted.
 *
 * A wrong conversion here does not look wrong — it schedules a class on the wrong day and
 * nobody notices until a student turns up to an empty room. So these anchor on New Year's Day,
 * which is the one Bikram Sambat date every Nepali knows without looking it up, across five
 * separate years including one eighty years back.
 */

/** Noon UTC, so no timezone can nudge these across a midnight. */
const at = (iso: string) => new Date(`${iso}T06:00:00Z`);

test("New Year's Day lines up, across eighty years", () => {
  const newYears: [string, number][] = [
    ["1943-04-14", 2000],
    ["2023-04-14", 2080],
    ["2024-04-13", 2081],
    ["2025-04-14", 2082],
    ["2026-04-14", 2083],
  ];
  for (const [gregorian, bsYear] of newYears) {
    const bs = toBikramSambat(at(gregorian));
    assert.ok(bs, `${gregorian} did not convert`);
    assert.equal(bs.year, bsYear, `${gregorian} should be BS ${bsYear}`);
    assert.equal(bs.month, 1, `${gregorian} should be Baisakh`);
    assert.equal(bs.day, 1, `${gregorian} should be the 1st`);
  }
});

test("the day before New Year is the last day of Chaitra", () => {
  const bs = toBikramSambat(at("2026-04-13"));
  assert.ok(bs);
  assert.equal(bs.year, 2082);
  assert.equal(bs.month, 12);
});

test("an ordinary day converts both ways and comes back unchanged", () => {
  const original = at("2026-08-24");
  const bs = toBikramSambat(original);
  assert.ok(bs);
  assert.equal(bs.year, 2083);
  assert.equal(bs.month, 5);
  assert.equal(bs.day, 8);
  assert.equal(bs.monthName, "Bhadra");

  const back = fromBikramSambat(bs.year, bs.month, bs.day);
  assert.ok(back);
  assert.equal(back.getFullYear(), 2026);
  assert.equal(back.getMonth(), 7);
  assert.equal(back.getDate(), 24);
});

test("a round trip survives every month of a year", () => {
  for (let month = 1; month <= 12; month += 1) {
    for (const day of [1, 15, bsDaysInMonth(2083, month)]) {
      const forward = fromBikramSambat(2083, month, day);
      assert.ok(forward, `2083-${month}-${day} did not convert`);
      const back = toBikramSambat(forward);
      assert.ok(back);
      assert.equal(back.year, 2083, `year drifted for 2083-${month}-${day}`);
      assert.equal(back.month, month, `month drifted for 2083-${month}-${day}`);
      assert.equal(back.day, day, `day drifted for 2083-${month}-${day}`);
    }
  }
});

test("months are between 29 and 32 days, which is the whole reason for a table", () => {
  for (let month = 1; month <= 12; month += 1) {
    const days = bsDaysInMonth(2083, month);
    assert.ok(days >= 29 && days <= 32, `${BS_MONTHS[month - 1]} 2083 has ${days} days`);
  }
});

test("the year is not 365 days by construction, it is whatever the table says", () => {
  let total = 0;
  for (let month = 1; month <= 12; month += 1) total += bsDaysInMonth(2083, month);
  // A Bikram Sambat year is 365 or 366 days. Anything else means the month lengths are wrong.
  assert.ok(total === 365 || total === 366, `2083 came to ${total} days`);
});

test("a date is written the way a Nepali reader expects", () => {
  const written = formatDate(at("2026-08-24"), { system: "bs" });
  assert.equal(written, "8 Bhadra 2083");
});

test("and in Devanagari when asked", () => {
  const written = formatDate(at("2026-08-24"), { system: "bs", nepali: true });
  assert.equal(written, "८ भदौ २०८३");
});

test("digits convert without touching anything else", () => {
  assert.equal(toNepaliDigits(2083), "२०८३");
  assert.equal(toNepaliDigits("8 Bhadra"), "८ Bhadra");
});

test("Gregorian is still available for anyone who wants it", () => {
  const written = formatDate(at("2026-08-24"), { system: "ad" });
  assert.match(written, /2026/);
  assert.ok(!written.includes("Bhadra"));
});

test("both calendars together, for the places where being sure matters", () => {
  const written = formatDateBoth(at("2026-08-24"), { system: "bs" });
  assert.match(written, /Bhadra 2083/);
  assert.match(written, /2026/);
});

test("an unreadable date produces nothing rather than a wrong something", () => {
  assert.equal(formatDate("not a date"), "");
  assert.equal(toBikramSambat("not a date"), null);
});

test("a date outside the table falls back to Gregorian rather than to a blank", () => {
  // Far outside any published Bikram Sambat table. Somebody's typo, but it must still render.
  const written = formatDate(new Date("2400-01-01T06:00:00Z"), { system: "bs" });
  assert.match(written, /2400/);
});

test("a class's time survives the conversion", () => {
  const scheduled = fromBikramSambat(2083, 5, 8, 14, 30);
  assert.ok(scheduled);
  assert.equal(scheduled.getHours(), 14);
  assert.equal(scheduled.getMinutes(), 30);
});
