export interface ProgramCommerceAction {
  event: string;
  label: string;
  reason?: boolean;
}

/** One plain-language action vocabulary for both simulated ledgers. */
export const PROGRAM_COMMERCE_NEXT: Record<string, ProgramCommerceAction[]> = {
  future: [
    { event: "lesson_delivered", label: "Mark lesson delivered" },
    { event: "lesson_cancelled", label: "Teacher cancelled" },
  ],
  replacement_pending: [
    { event: "replacement_scheduled", label: "Replacement agreed" },
    { event: "refund_approved", label: "Approve lesson refund", reason: true },
  ],
  delivered_pending: [
    { event: "complaint_opened", label: "Open complaint" },
    { event: "complaint_window_closed", label: "Close 48-hour window" },
  ],
  disputed: [
    { event: "complaint_upheld", label: "Uphold complaint", reason: true },
    { event: "complaint_denied", label: "Decline complaint", reason: true },
  ],
  eligible: [
    { event: "complaint_opened", label: "Open late complaint" },
    { event: "payout_confirmed", label: "Rehearse payout" },
  ],
  refund_owed: [{ event: "refund_confirmed", label: "Rehearse refund" }],
};
