import {
  PROGRAM_BETA_COMPLAINT_WINDOW_HOURS,
  type ProgramAllocationEvent,
  type ProgramAllocationState,
} from "./programCommerce.ts";
import { remedySettlementTarget, type RemedyFulfillment } from "./lessonRemedies.ts";

export interface BatchTestSettlementFacts {
  state: ProgramAllocationState;
  sessionStatus: string;
  scheduledStartMs: number;
  durationMinutes: number;
  actualEndMs?: number | null;
  teacherPresenceRecorded: boolean;
  activeComplaint: boolean;
  nowMs: number;
  /** Supplied by the allocation-aware store once durable remedies are activated. */
  remedy?: RemedyFulfillment;
  evidenceSessionId?: number;
}

/**
 * System-owned settlement events derived only from records neither an operator nor client can
 * invent. This chooses no complaint outcome and confirms no transfer of money.
 */
export function automaticBatchTestEvents(facts: BatchTestSettlementFacts): ProgramAllocationEvent[] {
  if (facts.remedy) {
    const target = remedySettlementTarget(facts.remedy);
    // The original lesson cannot satisfy a replacement. A completed label plus a brief
    // teacher join is not enough to confirm make-up delivery: that is a separate evidence
    // review transition, never a consequence of this accounting synchronizer.
    if (target.hold || target.sessionId !== facts.evidenceSessionId || facts.remedy.status !== "delivered_review") return [];
  }
  const events: ProgramAllocationEvent[] = [];
  let state = facts.state;

  if (state === "future" && facts.sessionStatus === "cancelled") {
    events.push("lesson_cancelled");
    state = "replacement_pending";
  } else if (state === "future" && facts.sessionStatus === "completed" && facts.teacherPresenceRecorded) {
    events.push("lesson_delivered");
    state = "delivered_pending";
  }

  if ((state === "delivered_pending" || state === "eligible") && facts.activeComplaint) {
    events.push("complaint_opened");
    return events;
  }

  const scheduledEndMs = facts.scheduledStartMs + facts.durationMinutes * 60_000;
  // A late-running class must not lose review time because its planned slot has passed.
  // Historical sessions without an end record retain the scheduled-end fallback.
  const reviewStartsMs = Math.max(scheduledEndMs, facts.actualEndMs ?? scheduledEndMs);
  const complaintClosesMs = reviewStartsMs + PROGRAM_BETA_COMPLAINT_WINDOW_HOURS * 60 * 60_000;
  if (state === "delivered_pending" && facts.nowMs >= complaintClosesMs) {
    events.push("complaint_window_closed");
  }
  return events;
}

export function batchTestNeedsHumanAttention(state: string): boolean {
  return state === "disputed" || state === "replacement_pending";
}
