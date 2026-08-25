/**
 * Support tickets: what a request can become, who may move it, and how many a person may open.
 *
 * Pure — no database — for the same reason the monthly tier's money is pure: these decide what
 * somebody is told about a problem they reported, and a rule that can only be exercised against
 * a live database is a rule nobody tests.
 *
 * ### Why a lifecycle at all
 *
 * The owner's words: "right now, a user can create several hundred requests without knowing the
 * status of their requests". A ticket that only moves from "open" to "resolved" tells the person
 * who reported it nothing while it is neither — so they report it again, and again, and the
 * queue fills with the same problem while the agent working it has no way to say "I am on it".
 */

/** How many requests one person may open in a day. */
export const MAX_TICKETS_PER_DAY = 3;
/** How long they must wait once they have used them up. */
export const TICKET_COOLDOWN_HOURS = 24;

/**
 * Every state a ticket can be in.
 *
 * `in_review` is not offered any more and is kept only because rows already carry it. It means
 * the same thing as `processing`, and `displayStatus` folds the two together so a person is
 * never shown two words for one state.
 */
export const TICKET_STATUSES = [
  "open",
  "opened",
  "assigned",
  "processing",
  "in_review",
  "resolved",
  "denied",
  "cancelled",
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** States from which nothing further happens. */
export const TERMINAL_STATUSES: readonly TicketStatus[] = ["resolved", "denied", "cancelled"];

/** Words for the person who reported it, not names from a database. */
const LABELS: Record<TicketStatus, string> = {
  open: "Created",
  opened: "Opened by an agent",
  assigned: "Assigned to an agent",
  processing: "Being worked on",
  in_review: "Being worked on",
  resolved: "Resolved",
  denied: "Denied",
  cancelled: "Cancelled",
};

/** One line saying what is happening, for somebody who has never seen this app's internals. */
const EXPLAINS: Record<TicketStatus, string> = {
  open: "We have your request. Nobody has picked it up yet.",
  opened: "An agent has read your request.",
  assigned: "An agent has taken this on.",
  processing: "An agent is working on this now.",
  in_review: "An agent is working on this now.",
  resolved: "This has been dealt with.",
  denied: "This was looked at and turned down. The reason is below.",
  cancelled: "This was cancelled.",
};

export function statusLabel(status: string): string {
  return LABELS[status as TicketStatus] ?? "Created";
}

export function statusExplains(status: string): string {
  return EXPLAINS[status as TicketStatus] ?? EXPLAINS.open;
}

/** Folds the legacy `in_review` into `processing`, so one state has one name. */
export function displayStatus(status: string): TicketStatus {
  return status === "in_review" ? "processing" : ((status as TicketStatus) ?? "open");
}

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.includes(displayStatus(status));
}

/**
 * Where a ticket may go next.
 *
 * Forward only, and never out of a state that is finished. A ticket that can go back to "open"
 * after being resolved is one where the history stops meaning anything: the person reading it
 * cannot tell whether their problem was dealt with once, twice, or not at all.
 */
const NEXT: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ["opened", "assigned", "processing", "resolved", "denied", "cancelled"],
  opened: ["assigned", "processing", "resolved", "denied", "cancelled"],
  assigned: ["processing", "resolved", "denied", "cancelled"],
  processing: ["resolved", "denied", "cancelled"],
  in_review: ["resolved", "denied", "cancelled"],
  resolved: [],
  denied: [],
  cancelled: [],
};

export type Allowed = { ok: true } | { ok: false; reason: string };

/**
 * May a ticket move from one state to another?
 *
 * An agent skipping straight from "Created" to "Resolved" is allowed on purpose — plenty of
 * requests are answered in one reading, and forcing four taps to say so would mean the steps
 * get skipped by not being used at all.
 */
export function canTransition(from: string, to: string): Allowed {
  const current = displayStatus(from);
  const next = displayStatus(to);

  if (!TICKET_STATUSES.includes(next)) return { ok: false, reason: "That is not a status." };
  if (current === next) return { ok: false, reason: `This request is already ${statusLabel(next).toLowerCase()}.` };
  if (isTerminal(current)) {
    return { ok: false, reason: `This request is ${statusLabel(current).toLowerCase()} and cannot be changed.` };
  }
  if (!NEXT[current].includes(next)) {
    return { ok: false, reason: `A request cannot go from ${statusLabel(current)} to ${statusLabel(next)}.` };
  }
  return { ok: true };
}

/**
 * Whether an ending needs a reason written down.
 *
 * The owner asked for a justification on the endings, and the two that need it most are the
 * ones a person will argue with. "Denied" with no reason is the app telling somebody no and
 * refusing to say why.
 */
export function needsJustification(to: string): boolean {
  const next = displayStatus(to);
  return next === "resolved" || next === "denied";
}

export interface TicketAllowance {
  ok: boolean;
  used: number;
  remaining: number;
  /** When they may open another, if they may not now. */
  nextAllowedAt: number | null;
  reason: string | null;
}

/**
 * How many more requests this person may open.
 *
 * A limit exists because the app currently lets somebody file the same complaint two hundred
 * times, which buries the queue and does not get their problem looked at any sooner. Three a
 * day is the owner's number.
 *
 * The clock runs from each request rather than from midnight: a fixed daily reset means
 * somebody who used all three at eleven at night gets three more an hour later, and somebody
 * who used them at nine in the morning waits fifteen hours. Rolling is the same wait for
 * everybody.
 */
export function ticketAllowance(
  openedAt: readonly (Date | string | number)[],
  now: number = Date.now(),
): TicketAllowance {
  const windowMs = TICKET_COOLDOWN_HOURS * 60 * 60 * 1000;
  const recent = openedAt
    .map((at) => (at instanceof Date ? at.getTime() : new Date(at).getTime()))
    .filter((at) => Number.isFinite(at) && now - at < windowMs)
    .sort((a, b) => a - b);

  const used = recent.length;
  const remaining = Math.max(0, MAX_TICKETS_PER_DAY - used);
  if (remaining > 0) return { ok: true, used, remaining, nextAllowedAt: null, reason: null };

  // The oldest of the ones still counting is the one that frees up first.
  const oldest = recent[recent.length - MAX_TICKETS_PER_DAY];
  const nextAllowedAt = oldest === undefined ? now + windowMs : oldest + windowMs;
  const hours = Math.max(1, Math.ceil((nextAllowedAt - now) / (60 * 60 * 1000)));

  return {
    ok: false,
    used,
    remaining: 0,
    nextAllowedAt,
    reason:
      `You can send ${MAX_TICKETS_PER_DAY} requests a day, and you have used all ${MAX_TICKETS_PER_DAY}. ` +
      `You can send another in about ${hours} ${hours === 1 ? "hour" : "hours"}. ` +
      `If something is urgent, reply on a request you have already sent.`,
  };
}

/**
 * The number a person quotes when they ask about their request.
 *
 * Derived from the row's id rather than stored. A second column would need writing by something,
 * could disagree with the id, and would be one more thing to get wrong; this cannot drift
 * because there is nothing to drift from.
 */
export function ticketRef(id: number): string {
  if (!Number.isInteger(id) || id <= 0) return "HT-000000";
  return `HT-${String(id).padStart(6, "0")}`;
}

/** Reads a reference back, for an agent pasting one into a search box. */
export function ticketIdFromRef(ref: string): number | null {
  const match = /^\s*(?:HT-)?0*(\d{1,9})\s*$/i.exec(ref ?? "");
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * The buttons an agent should see on a ticket.
 *
 * Handed to the desk rather than hard-coded there, so the states an agent can reach and the
 * states the server will accept cannot drift apart — a button that produces a 409 is worse
 * than no button.
 */
export function nextStatuses(from: string): readonly TicketStatus[] {
  return NEXT[displayStatus(from)];
}
