export type HomeworkDeadlineResult =
  | { ok: true; dueAt: Date | null }
  | { ok: false; error: string };

/** Read an optional deadline using the server clock, never the phone's clock. */
export function readHomeworkDeadline(
  value: unknown,
  nowMs = Date.now(),
): HomeworkDeadlineResult {
  if (value === undefined || value === null || value === "") {
    return { ok: true, dueAt: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "Choose a valid homework deadline." };
  }
  const dueMs = Date.parse(value);
  if (!Number.isFinite(dueMs)) {
    return { ok: false, error: "Choose a valid homework deadline." };
  }
  if (dueMs <= nowMs) {
    return {
      ok: false,
      error: "Choose a homework deadline that is still in the future.",
    };
  }
  return { ok: true, dueAt: new Date(dueMs) };
}
