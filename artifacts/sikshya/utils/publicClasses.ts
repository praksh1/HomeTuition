/**
 * The Single Classes tab of Discover, as pure functions.
 *
 * The API endpoint is `GET /public/classes` (see `artifacts/api-server/src/routes/sessions.ts`).
 * That route already filters out monthly-class-days, unapproved/suspended teachers, cancelled /
 * completed / expired classes, and classes with no seats — so every row this file receives is
 * one a student may honestly buy right now.
 *
 * ## The rule the card exists to hold
 *
 * **Every field on the card comes from the API, and every truthful commercial signal is shown
 * before the student taps.** The pay-per-class billing model, the actual price, the teacher's
 * name, the date/time, the duration, the seat count. `Array(enrolledCount).fill("")` was the
 * hack the old journey used to reuse `SessionCard`; here the count is a number and the card
 * reads it directly.
 */

/** One row of `GET /public/classes`. Every field is authoritative. */
export interface PublicClass {
  id: number;
  /** The teacher's user id — the id the whole app talks about a teacher by. */
  teacherUserId: number;
  /**
   * The teacher's profile id, which the `/(student)/teacher/[id]` route looks them up by.
   *
   * Two ids because the two tables have their own primary keys and the app has to be able to
   * talk about a teacher in either currency; the card routes with the profile id, and any
   * downstream API call for follow/subscribe uses the user id. Sending both keeps the caller
   * honest — the API is not the place to choose one and lose the other.
   */
  teacherProfileId: number;
  teacherName: string;
  subject: string;
  topic: string;
  /** ISO string of the booked slot's start. */
  date: string;
  /** Minutes. The API defaults to 60 in the schema. */
  duration: number;
  maxStudents: number;
  enrolledCount: number;
  /** Rupees per class, whole integers. */
  price: number;
}

/** Everything a public class card needs to draw, decided from a `PublicClass`. */
export interface PublicClassCardFields {
  id: number;
  /** The id the `/(student)/teacher/[id]` route uses. */
  teacherProfileId: number;
  teacherName: string;
  subject: string;
  topic: string;
  /** The card's own line: "Pay per class". Named so a later change touches one file. */
  billingLine: string;
  /** "NPR 500" — the whole integer, tabular-numeric. */
  priceLine: string;
  /** "60 min" or "1 hour 30 min". Kept as an English string; the card localises with numerals. */
  durationLine: string;
  /** True when the seat count matches the cap. */
  soldOut: boolean;
  /** "3 of 10 seats" for available classes; "Sold out" for full ones. */
  seatsLine: string;
  /** Non-null, non-empty display strings for the action button. */
  actionLabel: string;
  /** For a screen reader: the whole sentence. */
  spokenLabel: string;
}

/**
 * Every card field, decided from one API row. Never invents a value; the API is the authority.
 *
 * `formatDate` is *not* here because a card needs the viewer's calendar preference, which lives
 * in a React context. The card does that step itself; this function decides everything the
 * calendar cannot answer.
 */
export function publicClassCard(row: PublicClass): PublicClassCardFields {
  const remaining = Math.max(0, row.maxStudents - row.enrolledCount);
  const soldOut = remaining === 0;
  const priceLine = `NPR ${row.price.toLocaleString()}`;
  const durationLine = formatMinutes(row.duration);
  const seatsLine = soldOut
    ? "Sold out"
    : `${remaining} of ${row.maxStudents} seat${row.maxStudents === 1 ? "" : "s"} left`;
  const billingLine = "Pay per class";
  const actionLabel = soldOut ? "See other classes" : "View & book";
  const spokenLabel = soldOut
    ? `${row.topic} with ${row.teacherName}. Sold out.`
    : `${row.topic} with ${row.teacherName}. ${priceLine}, pay per class. View and book.`;
  return {
    id: row.id,
    teacherProfileId: row.teacherProfileId,
    teacherName: row.teacherName,
    subject: row.subject,
    topic: row.topic,
    billingLine,
    priceLine,
    durationLine,
    soldOut,
    seatsLine,
    actionLabel,
    spokenLabel,
  };
}

/** "60 min" / "1 hour" / "1 hour 30 min". Never a fraction; the API stores whole minutes. */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} ${h === 1 ? "hour" : "hours"}`;
  return `${h} ${h === 1 ? "hour" : "hours"} ${m} min`;
}

/* ========================================================================== *
 * List state                                                                  *
 * ========================================================================== */

/**
 * The Single-Classes list, decided from what happened rather than what is currently loading.
 *
 * Same distinctions as `programListState` (`programDiscovery.ts`): loading, initial failure,
 * global empty, no match under an active query, pagination failure with cards preserved, ready.
 * A `noMatch` when the *server* returned an empty page under an active query is separate from
 * a `noMatch` because local text couldn't be typed — this route now searches server-side, so
 * the state's `noMatch.query` is what was submitted.
 */
export type PublicClassListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "noMatch"; query: string }
  | { kind: "ready"; rows: PublicClass[]; hasMore: boolean; paginationError: string | null };

export interface PublicClassListInput {
  initialLoad: boolean;
  loadedRows: PublicClass[];
  hasMore: boolean;
  initialError: string | null;
  paginationError: string | null;
  submittedQuery: string;
}

export function publicClassListState(input: PublicClassListInput): PublicClassListState {
  if (input.initialLoad) return { kind: "loading" };
  if (input.initialError !== null && input.loadedRows.length === 0) {
    return { kind: "error", message: input.initialError };
  }
  if (input.loadedRows.length === 0) {
    if (input.submittedQuery.trim().length > 0) {
      return { kind: "noMatch", query: input.submittedQuery.trim() };
    }
    return { kind: "empty" };
  }
  return {
    kind: "ready",
    rows: input.loadedRows,
    hasMore: input.hasMore,
    paginationError: input.paginationError,
  };
}

/**
 * One page merged with previous pages, deduplicating by id. A class rescheduled to the top of
 * the next page therefore appears once rather than twice.
 */
export interface PublicClassPage {
  rows: PublicClass[];
  nextCursor: string | null;
}

export function appendClassPage(current: PublicClassPage, next: PublicClassPage): PublicClassPage {
  const seen = new Set(current.rows.map((r) => r.id));
  const additions = next.rows.filter((r) => !seen.has(r.id));
  return { rows: [...current.rows, ...additions], nextCursor: next.nextCursor };
}
