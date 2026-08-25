/**
 * The shapes the ticket endpoints hand back, and how each state should read on screen.
 *
 * The words themselves come from the server (lib/tickets.ts), so a state that is renamed is
 * renamed once. What lives here is only how each state should *look* — a colour is a screen
 * decision, and putting it in the API would mean shipping a server to change a shade.
 */

export interface Ticket {
  id: number;
  /** The number the reporter quotes: HT-000123. */
  ref: string;
  reason: string;
  description: string;
  sessionId: number | null;
  evidenceUrl: string | null;
  status: string;
  statusLabel: string;
  statusExplains: string;
  resolution: string | null;
  /** That somebody has it, not which somebody. The desk sees the name; the reporter does not. */
  assigned: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface TicketEvent {
  id: number;
  at: string;
  status: string;
  label: string;
  by: string | null;
  byRole: string;
  note: string | null;
  fileKey: string | null;
}

export interface Allowance {
  used: number;
  limit: number;
  remaining: number;
  nextAllowedAt: number | null;
  reason: string | null;
}

export type Tone = "waiting" | "working" | "done" | "refused";

/**
 * Four tones, not eight.
 *
 * A reporter needs to know one thing at a glance: is anybody on this, and is it over. Giving
 * each of the eight states its own colour would say less, not more.
 */
export const STATUS_TONE: Record<string, Tone> = {
  open: "waiting",
  opened: "working",
  assigned: "working",
  processing: "working",
  in_review: "working",
  resolved: "done",
  denied: "refused",
  cancelled: "refused",
};
