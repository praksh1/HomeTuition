/**
 * When a daily class actually happens.
 *
 * A recurring class is a promise about **local time** — "every day at four" — and the server
 * stores instants. Turning one into the other is the whole of this file, and it is kept pure
 * and import-free so it can be tested directly with `node --test`.
 *
 * Two things are deliberately absent:
 *
 * - **No calendar.** Neither Bikram Sambat nor Gregorian appears here. Both are display, done
 *   at the edge in the app. A class instant is computed from a zone and a time of day, so the
 *   calendar a student's phone is set to cannot move their class or their money.
 * - **No fixed offset.** Nepal keeps UTC+05:45 all year with no daylight saving, so hard-coding
 *   +05:45 would work today. It is read from the zone anyway, because the cost is one `Intl`
 *   call and the alternative is a class that silently moves by an hour if this ever runs for
 *   anybody who does observe it.
 */

/** Minutes in a day, for the range check on a class's start time. */
export const MINUTES_PER_DAY = 24 * 60;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** What an instant looks like on a clock in `timeZone`. */
function partsIn(utcMs: number, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));

  const read = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };
  // `hour12: false` renders midnight as 24 in some engines; 24:10 is 00:10.
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

/** How far ahead of UTC `timeZone` is at this instant, in milliseconds. */
export function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const p = partsIn(utcMs, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Seconds are the finest unit formatted, so drop anything below them on both sides.
  return asIfUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The minute of the local day an instant falls on, 0–1439. */
export function minuteOfDayIn(utcMs: number, timeZone: string): number {
  const p = partsIn(utcMs, timeZone);
  return p.hour * 60 + p.minute;
}

/** The local calendar date an instant falls on, as a `YYYY-MM-DD` key. */
export function localDayKey(utcMs: number, timeZone: string): string {
  const p = partsIn(utcMs, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * The instant at which a given local wall-clock time occurs on a given local date.
 *
 * Solved by guessing and correcting rather than by arithmetic on an offset, because the offset
 * that applies is the offset *at the answer*, not at the guess. One correction settles every
 * real zone; a second pass is run because a guess landing inside a daylight-saving jump can
 * correct into a different offset again.
 */
export function instantOfLocalTime(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
  timeZone: string,
): number {
  const wanted = Date.UTC(year, month - 1, day, 0, 0, 0) + minuteOfDay * 60_000;
  let guess = wanted - zoneOffsetMs(wanted, timeZone);
  for (let pass = 0; pass < 2; pass += 1) {
    const corrected = wanted - zoneOffsetMs(guess, timeZone);
    if (corrected === guess) return guess;
    guess = corrected;
  }
  return guess;
}

/**
 * Every instant this class runs between two moments — the class-days of one cycle.
 *
 * Walked one local day at a time from a day before the window to a day after it, keeping only
 * the instants that land inside. The count is whatever it honestly comes to rather than a
 * hard-coded thirty: a cycle is thirty times twenty-four hours and classes are a local day
 * apart, which is the same thing everywhere Nepal is and very nearly the same thing where
 * clocks change. Whatever comes out is what `sessionsPlanned` records and what every rate is
 * then divided by, so the money follows the classes that will actually happen rather than an
 * assumption about how many there ought to be.
 */
export function classInstants(
  cycleStartMs: number,
  cycleEndMs: number,
  startMinute: number,
  timeZone: string,
): number[] {
  if (!Number.isFinite(cycleStartMs) || !Number.isFinite(cycleEndMs)) return [];
  if (cycleEndMs <= cycleStartMs) return [];

  const out: number[] = [];
  const seen = new Set<number>();
  // Start a day early and finish a day late: the local date the window opens on may hold a
  // class instant on either side of the boundary, depending on the class's time of day.
  for (let cursor = cycleStartMs - DAY_MS; cursor <= cycleEndMs + DAY_MS; cursor += DAY_MS) {
    const p = partsIn(cursor, timeZone);
    const at = instantOfLocalTime(p.year, p.month, p.day, startMinute, timeZone);
    if (at >= cycleStartMs && at < cycleEndMs && !seen.has(at)) {
      seen.add(at);
      out.push(at);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Is this a minute of the day a class could start at? */
export function isValidStartMinute(minute: number): boolean {
  return Number.isInteger(minute) && minute >= 0 && minute < MINUTES_PER_DAY;
}

/** `16:30`, for showing a teacher what they set. Never a date — only ever a time of day. */
export function formatStartMinute(minute: number): string {
  const safe = ((Math.trunc(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
