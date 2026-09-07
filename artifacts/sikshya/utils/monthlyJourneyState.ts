export interface MonthlyChatPage<T extends { id: number }> {
  messages: T[];
  pinned: T[];
}

/** Poll the latest page until a first message exists, then ask only for newer ids. */
export function monthlyChatCatchUpPath(classId: number, newestId?: number): string {
  const base = `/monthly/classes/${classId}/messages`;
  return newestId === undefined ? base : `${base}?after=${newestId}`;
}

/**
 * Merge a catch-up without duplicating a message sent locally while the request was in flight.
 * The server's numeric message id is the authority for identity.
 */
export function mergeMonthlyChatCatchUp<T extends { id: number }, V extends MonthlyChatPage<T>>(
  previous: V,
  update: MonthlyChatPage<T>,
): V {
  const seen = new Set(previous.messages.map((message) => message.id));
  const arrived = update.messages.filter((message) => !seen.has(message.id));
  /*
   * The route promises ascending ids for an `after` page. A locally returned POST can land in
   * state while that GET is in flight, though: [72, 74] plus [73, 74] must not become
   * [72, 74, 73]. Keep the already-rendered object for duplicate ids, add only genuinely new
   * rows, then restore the server's chronological id order.
   */
  const messages = arrived.length > 0
    ? [...previous.messages, ...arrived].sort((left, right) => left.id - right.id)
    : previous.messages;
  /* A pin can be replaced or edited without changing the count. Identity and content matter. */
  const pinsChanged = JSON.stringify(previous.pinned) !== JSON.stringify(update.pinned);
  if (messages !== previous.messages || pinsChanged) {
    return { ...previous, messages, pinned: pinsChanged ? update.pinned : previous.pinned };
  }
  return previous;
}

export type SubmissionsLoadState<T> = { rows: T[] | null; problem: string | null };
export type SubmissionsLoadAction<T> =
  | { type: "loaded"; rows: T[] }
  | { type: "failed"; problem: string };

/** A successful retry must leave the error branch, not keep painting yesterday's failure. */
export function submissionsLoadReducer<T>(
  state: SubmissionsLoadState<T>,
  action: SubmissionsLoadAction<T>,
): SubmissionsLoadState<T> {
  if (action.type === "loaded") return { rows: action.rows, problem: null };
  return { ...state, problem: action.problem };
}

export function studentMonthlyEmptyCopy(hasEnrolment: boolean): string {
  return hasEnrolment
    ? "No other monthly classes are available right now."
    : "No monthly classes are available to join right now.";
}
