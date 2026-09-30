import { createHash } from "node:crypto";

export class RemedyRefusal extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export function validRemedyRequestKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(value);
}
export function remedyNote(value: unknown, required = false): string {
  if (typeof value !== "string") {
    if (required) throw new RemedyRefusal(400, "note_required", "Add a short explanation for this decision.");
    return "";
  }
  const note = value.trim();
  if (note.length > 1500) throw new RemedyRefusal(400, "note_too_long", "Keep your explanation within 1,500 characters.");
  if (required && note.length < 10) throw new RemedyRefusal(400, "note_required", "Add a clear explanation of at least 10 characters.");
  return note;
}
/** Each write fingerprints its normalized, fixed-shape input; never hashes a client's arbitrary object. */
export function remedyRequestFingerprint(input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/** Lifecycle only: callers must still apply purchase, account, claim, quota and financial-review gates. */
export function canOpenLessonRemedyRequest(record: {
  status: string; outcome: string | null; acceptedEver: boolean;
} | null): boolean {
  return record === null || (record.acceptedEver === false
    && ["withdrawn", "review_required"].includes(record.status)
    && record.outcome !== "refund_review");
}
