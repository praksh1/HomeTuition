import {
  PROGRAM_BETA_COMPLAINT_WINDOW_HOURS,
  type ProgramAllocationEvent,
  type ProgramAllocationState,
} from "./programCommerce.ts";

export interface BatchTestSettlementFacts {
  state: ProgramAllocationState;
  sessionStatus: string;
  scheduledStartMs: number;
  durationMinutes: number;
  teacherPresenceRecorded: boolean;
  activeComplaint: boolean;
  nowMs: number;
}

/**
 * System-owned settlement events derived only from records neither an operator nor client can
 * invent. This chooses no complaint outcome and confirms no transfer of money.
 */
export function automaticBatchTestEvents(facts: BatchTestSettlementFacts): ProgramAllocationEvent[] {
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
  const complaintClosesMs = scheduledEndMs + PROGRAM_BETA_COMPLAINT_WINDOW_HOURS * 60 * 60_000;
  if (state === "delivered_pending" && facts.nowMs >= complaintClosesMs) {
    events.push("complaint_window_closed");
  }
  return events;
}

export function batchTestNeedsHumanAttention(state: string): boolean {
  return state === "disputed" || state === "replacement_pending";
}
