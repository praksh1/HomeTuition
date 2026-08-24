import * as NepaliDateModule from "nepali-date-converter";

/**
 * The constructor, dug out from under however many layers of interop this bundler adds.
 *
 * The package ships UMD with an `__esModule` marker, and what `import` hands back differs
 * between Node's type-stripping, Metro and esbuild — in one of them the class sits at
 * `module.default.default`. Unwrapping until a function appears works in all of them.
 *
 * Resolved once, at load, and **loudly**. The first version of this let a failure fall into the
 * same `catch` that handles a date outside the table, so every conversion silently answered
 * "unsupported" and the tests said the calendar was broken rather than the import. A catch that
 * turns a programming mistake into a plausible-looking answer is worse than no catch.
 */
type NepaliDateCtor = new (...args: unknown[]) => {
  getYear(): number;
  getMonth(): number;
  getDate(): number;
  toJsDate(): Date;
};

const NepaliDate: NepaliDateCtor = (() => {
  let candidate: unknown = NepaliDateModule;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof candidate === "function") return candidate as NepaliDateCtor;
    candidate = (candidate as { default?: unknown })?.default;
  }
  throw new Error("nepali-date-converter did not export a constructor this bundler can reach");
})();

/**
 * Dates as people in Nepal actually keep them.
 *
 * Nepal runs on **Bikram Sambat**, not the Gregorian calendar. It is the civil calendar: it is
 * what a school timetable, a government form and a wall calendar all use, and it is roughly 56
 * years and 8 months ahead. A parent told their child's class is on "9/1/2026" has to do a
 * conversion in their head; told it is on "१९ भदौ २०८२" they simply know.
 *
 * This app is for Nepal and has been showing Gregorian dates only — listed in ISSUES.md as a
 * known gap since the first round of testing.
 *
 * ### Where the conversion comes from
 *
 * `nepali-date-converter`, which is **MIT** licensed. That matters: the other well-known
 * package for this is GPL-3.0, and linking copyleft code into a commercial app that is going to
 * the App Store is a licensing problem nobody would notice until it was expensive.
 *
 * The conversion cannot be computed — Bikram Sambat months are between 29 and 32 days and the
 * pattern is published each year rather than derived — so it rests on a lookup table. Rather
 * than trust it, `nepaliDate.test.ts` checks it against New Year's Day for five separate years,
 * which is the date every Nepali knows.
 */

/** Bikram Sambat month names, in the Latin spellings used in Nepal. */
export const BS_MONTHS = [
  "Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin",
  "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra",
] as const;

/** The same months in Devanagari, for anyone reading Nepali. */
export const BS_MONTHS_NP = [
  "बैशाख", "जेठ", "असार", "साउन", "भदौ", "असोज",
  "कार्तिक", "मंसिर", "पुष", "माघ", "फागुन", "चैत",
] as const;

/** Weekday names, Sunday first, as the week runs in Nepal. */
export const BS_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const BS_WEEKDAYS_NP = ["आइत", "सोम", "मंगल", "बुध", "बिहि", "शुक्र", "शनि"] as const;

/** Devanagari digits, because a date written half in each reads badly. */
const NP_DIGITS = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"] as const;

export function toNepaliDigits(value: number | string): string {
  return String(value).replace(/\d/g, (d) => NP_DIGITS[Number(d)]);
}

export interface BikramDate {
  /** Bikram Sambat year, e.g. 2083. */
  year: number;
  /** 1–12, Baisakh through Chaitra. Not zero-based: this is for reading, not arithmetic. */
  month: number;
  day: number;
  monthName: string;
  monthNameNp: string;
  /** 0 = Sunday. */
  weekday: number;
}

/** The Bikram Sambat date for a moment in time, in the viewer's own timezone. */
export function toBikramSambat(value: Date | string | number): BikramDate | null {
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  try {
    const bs = new NepaliDate(at);
    const month = bs.getMonth() + 1;
    return {
      year: bs.getYear(),
      month,
      day: bs.getDate(),
      monthName: BS_MONTHS[month - 1] ?? "",
      monthNameNp: BS_MONTHS_NP[month - 1] ?? "",
      weekday: at.getDay(),
    };
  } catch {
    // Outside the table's range. The caller falls back to Gregorian rather than showing nothing.
    return null;
  }
}

/** The moment a Bikram Sambat date and time refers to. Null when that date does not exist. */
export function fromBikramSambat(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
): Date | null {
  try {
    const bs = new NepaliDate(year, month - 1, day);
    const at = bs.toJsDate();
    if (Number.isNaN(at.getTime())) return null;
    at.setHours(hours, minutes, 0, 0);
    return at;
  } catch {
    return null;
  }
}

/**
 * How many days a Bikram Sambat month has: between 29 and 32, and not derivable.
 *
 * Found by asking, rather than from a table of our own: step forward from the first of the
 * month and see where the month changes. Slower than a lookup and impossible to get out of step
 * with the conversion itself, which is the failure that would matter.
 */
export function bsDaysInMonth(year: number, month: number): number {
  for (let day = 32; day >= 29; day -= 1) {
    const at = fromBikramSambat(year, month, day);
    if (!at) continue;
    const back = toBikramSambat(at);
    if (back && back.year === year && back.month === month && back.day === day) return day;
  }
  return 30;
}

export type DateSystem = "bs" | "ad";

export interface FormatOptions {
  /** "bs" for Bikram Sambat, "ad" for Gregorian. */
  system?: DateSystem;
  /** Devanagari numerals and month names. */
  nepali?: boolean;
  /** Append the time. */
  withTime?: boolean;
  /** Include the weekday. */
  withWeekday?: boolean;
  /** "long" spells the month; "short" is numeric. */
  style?: "long" | "short";
}

function timePart(at: Date): string {
  return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * One date, written the way the reader expects it.
 *
 * Falls back to Gregorian rather than to nothing when a date is outside the conversion table —
 * a class in the year 2200 is somebody's typo, and showing them a blank is worse than showing
 * them the date they typed.
 */
export function formatDate(value: Date | string | number, options: FormatOptions = {}): string {
  const {
    system = "bs",
    nepali = false,
    withTime = false,
    withWeekday = false,
    style = "long",
  } = options;

  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return "";

  const gregorian = () => {
    const date = at.toLocaleDateString([], {
      ...(withWeekday ? { weekday: "short" as const } : {}),
      day: "numeric",
      month: style === "long" ? "short" : "numeric",
      year: "numeric",
    });
    return withTime ? `${date}, ${timePart(at)}` : date;
  };

  if (system === "ad") return gregorian();

  const bs = toBikramSambat(at);
  if (!bs) return gregorian();

  const num = (n: number) => (nepali ? toNepaliDigits(n) : String(n));
  const weekday = nepali ? BS_WEEKDAYS_NP[bs.weekday] : BS_WEEKDAYS[bs.weekday];
  const month = style === "long" ? (nepali ? bs.monthNameNp : bs.monthName) : num(bs.month);

  const core = style === "long"
    ? `${num(bs.day)} ${month} ${num(bs.year)}`
    : `${num(bs.year)}/${num(bs.month)}/${num(bs.day)}`;

  const withDay = withWeekday ? `${weekday}, ${core}` : core;
  return withTime ? `${withDay}, ${timePart(at)}` : withDay;
}

/**
 * Both calendars at once, for the places where being certain matters.
 *
 * A class's own page says "19 Bhadra 2083 (2 Sep 2026)". Somebody who thinks in one and has to
 * coordinate in the other — a teacher with an overseas student, a parent filling in a form —
 * should not have to convert anything themselves.
 */
export function formatDateBoth(value: Date | string | number, options: FormatOptions = {}): string {
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  /**
   * The reader's own calendar first, the other one in brackets.
   *
   * This used to put Bikram Sambat first regardless, ignoring the preference entirely — so
   * somebody who had chosen Gregorian still met a Nepali date on the one page they open to be
   * sure of one. Found by setting the default back to Gregorian and watching a browser test
   * that should have failed carry on passing.
   */
  const preferred = options.system ?? "bs";
  const other: DateSystem = preferred === "bs" ? "ad" : "bs";

  const main = formatDate(at, { ...options, system: preferred });
  const aside = formatDate(at, { ...options, system: other, withTime: false, withWeekday: false });

  // No conversion available for this date: both halves would say the same thing.
  if (!toBikramSambat(at)) return main;
  return `${main} (${aside})`;
}
