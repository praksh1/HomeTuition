export interface ProgramCommerceHistoryEntry {
  id: number;
  allocationId: number | null;
  event: string;
  detail: { note?: string | null; paymentMoved?: boolean } | null;
  createdAt: string;
}

export const PROGRAM_ALLOCATION_STATE_LABELS: Record<string, string> = {
  future: "Held for a future lesson",
  replacement_pending: "Waiting for a replacement or refund decision",
  delivered_pending: "Lesson delivered · 48-hour review window",
  disputed: "Complaint under review",
  eligible: "Cleared for the next test payout",
  paid_out: "Test payout completed",
  refund_owed: "Test refund approved",
  refunded: "Test refund completed",
};

const EVENT_LABELS: Record<string, string> = {
  test_enrolment_created: "Test enrolment created",
  lesson_delivered: "Lesson marked delivered",
  lesson_cancelled: "Teacher cancellation recorded",
  replacement_scheduled: "Replacement lesson agreed",
  refund_approved: "Lesson refund approved",
  complaint_opened: "Student complaint opened",
  complaint_window_closed: "48-hour complaint window closed",
  complaint_upheld: "Complaint upheld",
  complaint_denied: "Complaint declined",
  payout_confirmed: "Test payout confirmed",
  refund_confirmed: "Test refund confirmed",
};

/** Human-readable copy without letting database event codes leak into the operator UI. */
export function programCommerceEventLabel(event: string): string {
  return EVENT_LABELS[event] ?? "Recorded rehearsal action";
}

/** The ledger is append-only. Oldest-first tells the story in the order it happened. */
export function orderedProgramCommerceHistory<T extends { id: number }>(
  entries: T[],
): T[] {
  return [...entries].sort((left, right) => left.id - right.id);
}

/** Every operator-facing instant uses one named clock, independent of the device timezone. */
export function programCommerceNepalTime(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "Time unavailable";
  return `${new Intl.DateTimeFormat("en-NP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kathmandu",
  }).format(instant)} Nepal time`;
}
