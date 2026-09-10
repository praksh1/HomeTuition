/**
 * Provider- and database-independent money model for a future Learning Program purchase.
 *
 * This is intentionally not a checkout and has no rates or dates baked into it. The owner has
 * not approved a commission, student service fee, complaint window, payout day or gateway. What
 * is settled is the accounting shape: one confirmed program payment is divided across its paid
 * lessons, and each lesson earns or returns only its own allocation.
 *
 * Existing Single Class and Monthly payment code must not import this until there is an explicit
 * migration contract. Today this module is a calculator and an executable specification only.
 */

export const PROGRAM_ALLOCATION_STATES = [
  "future",
  "replacement_pending",
  "delivered_pending",
  "disputed",
  "eligible",
  "paid_out",
  "refund_owed",
  "refunded",
] as const;

export type ProgramAllocationState = (typeof PROGRAM_ALLOCATION_STATES)[number];

export const PROGRAM_ALLOCATION_EVENTS = [
  "lesson_delivered",
  "lesson_cancelled",
  "replacement_scheduled",
  "refund_approved",
  "complaint_opened",
  "complaint_window_closed",
  "complaint_upheld",
  "complaint_denied",
  "payout_confirmed",
  "refund_confirmed",
] as const;

export type ProgramAllocationEvent = (typeof PROGRAM_ALLOCATION_EVENTS)[number];

export interface ProgramLessonAllocation {
  /** One-based lesson number in the frozen purchase terms. */
  lessonNumber: number;
  /** Whole NPR, matching the unit used by the existing application. */
  amountNpr: number;
  state: ProgramAllocationState;
}

export class ProgramCommerceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProgramCommerceInputError";
  }
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ProgramCommerceInputError(`${label} must be a positive whole number.`);
  }
}

/**
 * Divide a confirmed tuition amount over the lessons bought.
 *
 * Remainders go to the earliest lessons, deterministically. No rupee disappears and no later
 * calculation has to recreate a division from mutable Program data. A future provider using
 * paisa can replace the unit at the boundary; silently reinterpreting today's NPR columns cannot.
 */
export function allocateProgramTuition(
  totalNpr: number,
  paidLessonCount: number,
): ProgramLessonAllocation[] {
  positiveInteger(totalNpr, "Program tuition");
  positiveInteger(paidLessonCount, "Paid lesson count");

  if (paidLessonCount > totalNpr) {
    throw new ProgramCommerceInputError(
      "Program tuition must allocate at least NPR 1 to every paid lesson.",
    );
  }

  const base = Math.floor(totalNpr / paidLessonCount);
  const remainder = totalNpr % paidLessonCount;

  return Array.from({ length: paidLessonCount }, (_, index) => ({
    lessonNumber: index + 1,
    amountNpr: base + (index < remainder ? 1 : 0),
    state: "future" as const,
  }));
}

const TRANSITIONS: Readonly<
  Partial<Record<ProgramAllocationState, Partial<Record<ProgramAllocationEvent, ProgramAllocationState>>>>
> = {
  future: {
    lesson_delivered: "delivered_pending",
    lesson_cancelled: "replacement_pending",
  },
  replacement_pending: {
    // A make-up carries the same allocation forward; it never creates a second earning.
    replacement_scheduled: "future",
    refund_approved: "refund_owed",
  },
  delivered_pending: {
    complaint_opened: "disputed",
    complaint_window_closed: "eligible",
  },
  disputed: {
    complaint_upheld: "refund_owed",
    complaint_denied: "eligible",
  },
  eligible: {
    // An exceptional complaint may freeze an earning until the payout is actually confirmed.
    complaint_opened: "disputed",
    payout_confirmed: "paid_out",
  },
  refund_owed: {
    refund_confirmed: "refunded",
  },
};

/**
 * Apply one authoritative event to one lesson allocation.
 *
 * Evidence never calls this directly and never chooses a verdict. Delivery, complaint decisions,
 * provider confirmations and the published complaint-window job are separate authoritative
 * events. A cancellation first waits for a replacement-or-refund decision; it does not decide its
 * own remedy. Rejecting an impossible transition is safer than quietly turning it into success.
 */
export function transitionProgramAllocation(
  state: ProgramAllocationState,
  event: ProgramAllocationEvent,
): ProgramAllocationState {
  const next = TRANSITIONS[state]?.[event];
  if (next === undefined) {
    throw new ProgramCommerceInputError(`Cannot apply ${event} while an allocation is ${state}.`);
  }
  return next;
}

export function allocationMayEnterPayout(state: ProgramAllocationState): boolean {
  return state === "eligible";
}

export function allocationMayBeRefunded(state: ProgramAllocationState): boolean {
  return state === "refund_owed";
}
