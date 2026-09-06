import test from "node:test";
import assert from "node:assert/strict";
import { providerDedupeIndexIsValid } from "./schemaInvariant.ts";

const correct = {
  is_unique: true,
  columns: ["provider", "event_type", "provider_participant_id"],
  predicate:
    "((provider_participant_id IS NOT NULL) AND (event_type = ANY (ARRAY['participant.joined'::text, 'participant.left'::text])))",
};

test("accepts PostgreSQL's canonical definition of the participant dedupe index", () => {
  assert.equal(providerDedupeIndexIsValid(correct), true);
});

test("rejects a deceptive same-name plain index", () => {
  assert.equal(providerDedupeIndexIsValid({ ...correct, is_unique: false }), false);
});

test("rejects missing, reordered, extra, or incomplete keys", () => {
  assert.equal(providerDedupeIndexIsValid(undefined), false);
  assert.equal(providerDedupeIndexIsValid({ ...correct, columns: [...correct.columns].reverse() }), false);
  assert.equal(providerDedupeIndexIsValid({ ...correct, columns: [...correct.columns, "session_id"] }), false);
  assert.equal(providerDedupeIndexIsValid({ ...correct, columns: correct.columns.slice(0, 2) }), false);
});

test("rejects an absent or broader partial-index predicate", () => {
  assert.equal(providerDedupeIndexIsValid({ ...correct, predicate: null }), false);
  assert.equal(
    providerDedupeIndexIsValid({
      ...correct,
      predicate: "provider_participant_id IS NOT NULL",
    }),
    false,
  );
});
