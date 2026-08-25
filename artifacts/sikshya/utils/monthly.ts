/**
 * What the monthly tier looks like from the app's side.
 *
 * The shapes here mirror what the API returns, and the two helpers are the only arithmetic the
 * app does about a monthly class — everything else is worked out on the server, deliberately.
 * A price computed twice is a price that can disagree with itself, and this one is somebody's
 * money.
 */

/** Minutes in a day. A class's time is stored as minutes past midnight, never as a date. */
export const MINUTES_PER_DAY = 24 * 60;

export interface MonthlyCycle {
  index: number;
  startsAt: string;
  endsAt: string;
}

export interface MonthlyQuote {
  sessionsRemaining: number;
  sessionsPlanned: number;
  amount: number;
  platformShare: number;
  teacherShare: number;
  /** True when the month has no classes left, so joining means waiting for the next one. */
  startsNextCycle: boolean;
}

export interface MonthlyEnrolment {
  cycleIndex: number;
  amountPaid: number;
  sessionsPaidFor: number;
  sessionsPlanned: number;
  status: string;
}

export interface MonthlyLedger {
  planned: number;
  held: number;
  missed: number;
  cancelled: number;
  makeups: number;
  total: number;
}

export interface MonthlyClass {
  id: number;
  teacherId: number;
  teacherName: string;
  subject: string;
  topic: string;
  /** Minutes past midnight in `timeZone`. The app decides how to show it. */
  startMinute: number;
  startTime: string;
  durationMinutes: number;
  timeZone: string;
  monthlyPrice: number;
  maxStudents: number;
  status: string;
  enrolled: number;
  seatsLeft: number;
  cycle: MonthlyCycle | null;
  sessionsPlanned: number;
  sessionsRemaining: number;
  ledger: MonthlyLedger | null;
  quote: MonthlyQuote | null;
  enrolment: MonthlyEnrolment | null;
}

export interface MonthlyStanding {
  abuses: number;
  suspended: boolean;
  remaining: number;
  warn: boolean;
}

export interface MonthlyPlanView {
  plan: {
    id: number;
    price: number;
    purchasedAt: string;
    cycleAnchor: string | null;
    status: string;
    suspendedUntil: string | null;
    suspendedReason: string | null;
  } | null;
  cycle: MonthlyCycle | null;
  class: MonthlyClass | null;
  ledger: MonthlyLedger | null;
  standing: MonthlyStanding | null;
  makeups?: { used: number; allowed: number; left: number };
  makeupDeadlineHours?: number;
  suspensionDays?: number;
  tierPrice: number;
  platformShare?: number;
}

export interface MissedClass {
  id: number;
  wasAt: string;
  missedAt: string | null;
  madeUpAt: string | null;
  countsAgainstYou: boolean;
  deadline: string | null;
  hoursLeft: number | null;
}

export interface MissedClassesView {
  missed: MissedClass[];
  makeups: { used: number; allowed: number; left: number };
  makeupDeadlineHours?: number;
}

/**
 * `16:30` from 990.
 *
 * A time of day, never a date — so no calendar is involved and none can be wrong. Bikram
 * Sambat and Gregorian differ about which day it is; they agree entirely about what four in the
 * afternoon means.
 */
export function formatStartMinute(minute: number): string {
  if (!Number.isFinite(minute)) return "";
  const safe = ((Math.trunc(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

/**
 * 990 from `16:30`, or null if it is not a time.
 *
 * Deliberately strict about the shape while being forgiving about spacing: a teacher typing
 * "16:30 " should not be told their class has no time, and one typing "half four" should not
 * quietly get midnight.
 */
export function parseStartMinute(text: string): number | null {
  const match = /^\s*(\d{1,2})\s*:\s*(\d{2})\s*$/.exec(text ?? "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** "NPR 1,000" — the one place the app writes an amount, so it reads the same everywhere. */
export function money(amount: number): string {
  return `NPR ${Math.round(amount).toLocaleString("en-IN")}`;
}
