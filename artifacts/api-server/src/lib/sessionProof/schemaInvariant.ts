/**
 * Process-local result of checking the database invariant behind provider-event deduplication.
 *
 * `ensureSessionProofTables()` owns the catalogue inspection and sets this exactly once per boot.
 * The webhook fails closed while it is unchecked or invalid. Classrooms never read this state.
 */
export type ProviderEvidenceSchemaState = "unchecked" | "ready" | "invalid";

export interface ProviderDedupeIndexDefinition {
  is_unique: boolean;
  columns: string[];
  predicate: string | null;
}

/** Exact semantic contract required by `onConflictDoNothing()` in provider ingestion. */
export function providerDedupeIndexIsValid(
  row: ProviderDedupeIndexDefinition | undefined,
): boolean {
  const columnsAreExact =
    Array.isArray(row?.columns) &&
    row.columns.length === 3 &&
    row.columns[0] === "provider" &&
    row.columns[1] === "event_type" &&
    row.columns[2] === "provider_participant_id";
  const predicate = (row?.predicate ?? "")
    .toLowerCase()
    .replace(/::text/g, "")
    .replace(/[\s"'()]/g, "");

  return (
    row?.is_unique === true &&
    columnsAreExact &&
    predicate ===
      "provider_participant_idisnotnullandevent_type=anyarray[participant.joined,participant.left]"
  );
}

let providerEvidenceSchemaState: ProviderEvidenceSchemaState = "unchecked";

export function markProviderEvidenceSchemaReady(): void {
  providerEvidenceSchemaState = "ready";
}

export function markProviderEvidenceSchemaInvalid(): void {
  providerEvidenceSchemaState = "invalid";
}

export function providerEvidenceSchemaReady(): boolean {
  return providerEvidenceSchemaState === "ready";
}

export function providerEvidenceSchemaStatus(): ProviderEvidenceSchemaState {
  return providerEvidenceSchemaState;
}
