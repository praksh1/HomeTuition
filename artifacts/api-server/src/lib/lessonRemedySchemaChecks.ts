/** Catalog-only readiness checks: damaged durable storage is never an empty legacy history. */
export const REMEDY_STORAGE_COLUMNS = {
  lesson_remedy_cases: ["id", "original_booking_id", "original_position", "original_session_id", "student_id", "teacher_id",
    "reason", "teacher_non_delivery_confirmed", "teacher_failed_replacement", "status", "policy_version", "policy_snapshot",
    "requested_before_start", "original_claim_closes_at", "replacement_deadline_at", "replacement_review_closes_at", "outcome",
    "resolved_by", "resolved_at", "requested_at", "updated_at"],
  lesson_remedy_offers: ["id", "case_id", "version", "offered_by", "starts_at", "ends_at", "expires_at", "status",
    "replacement_session_id", "accepted_at", "declined_at", "withdrawn_at", "created_at"],
  lesson_remedy_events: ["id", "case_id", "offer_id", "actor_id", "actor_role", "event", "from_status", "to_status",
    "request_key", "detail", "created_at"],
} as const;
export const REMEDY_STORAGE_INDEXES = [
  { name: "lesson_remedy_cases_original_idx", tableName: "lesson_remedy_cases", columns: ["original_booking_id", "original_position"], predicate: null },
  { name: "lesson_remedy_offers_version_idx", tableName: "lesson_remedy_offers", columns: ["case_id", "version"], predicate: null },
  { name: "lesson_remedy_offers_pending_idx", tableName: "lesson_remedy_offers", columns: ["case_id"], predicate: "status='proposed'" },
  { name: "lesson_remedy_offers_accepted_idx", tableName: "lesson_remedy_offers", columns: ["case_id"], predicate: "accepted_atisnotnull" },
  { name: "lesson_remedy_events_request_idx", tableName: "lesson_remedy_events", columns: ["case_id", "request_key"], predicate: null },
] as const;

export interface RemedyStorageCatalog {
  cases: unknown; offers: unknown; events: unknown;
  columns: unknown; indexes: unknown;
}
function predicate(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return "invalid";
  // pg_get_expr may add parentheses, whitespace, or an explicit cast on a text constant.
  return value.toLowerCase().replace(/::text\b/g, "").replace(/[\s()\"]/g, "");
}
/** False only means all three tables have never been installed. Everything partial fails closed. */
export function assertLessonRemedyStorage(catalog: RemedyStorageCatalog | undefined): boolean {
  if (!catalog) throw Error("Make-up storage readiness could not be checked.");
  const tables = [catalog.cases, catalog.offers, catalog.events];
  if (tables.every((table) => !table)) return false;
  if (tables.some((table) => !table) || !Array.isArray(catalog.columns) || !Array.isArray(catalog.indexes)) {
    throw Error("Make-up storage is incomplete. Support must check its durable obligations before continuing.");
  }
  for (const [tableName, names] of Object.entries(REMEDY_STORAGE_COLUMNS)) {
    for (const name of names) if (!catalog.columns.some((row: Record<string, unknown>) => row?.tableName === tableName && row.name === name)) {
      throw Error("Make-up storage columns are incomplete. No durable obligation can be ignored.");
    }
  }
  for (const expected of REMEDY_STORAGE_INDEXES) {
    const actual = catalog.indexes.find((row: Record<string, unknown>) => row?.name === expected.name && row.tableName === expected.tableName);
    if (!actual || actual.isUnique !== true || actual.isValid !== true || actual.isReady !== true || actual.isImmediate !== true ||
        !Array.isArray(actual.columns) || actual.columns.length !== expected.columns.length ||
        actual.columns.some((name: unknown, i: number) => name !== expected.columns[i]) ||
        predicate(actual.predicate) !== expected.predicate) {
      throw Error("Make-up storage uniqueness guards are unavailable. No new seat or payment decision can be recorded.");
    }
  }
  return true;
}
