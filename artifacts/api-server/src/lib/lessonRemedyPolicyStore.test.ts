import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { establishedLessonRemedyPolicy, snapshotLessonRemedyPolicy, LessonRemedyError } from "./lessonRemedies.ts";

test("an enrollment's first established make-up policy governs later cases and retries", () => {
  const frozen = snapshotLessonRemedyPolicy("monthly_tuition", 20);
  const record = { policyVersion: frozen.version, policySnapshot: { ...frozen } };
  assert.deepEqual(establishedLessonRemedyPolicy("monthly_tuition", 20, [record, record]), frozen);
  assert.deepEqual(establishedLessonRemedyPolicy("short_course", 30, []), snapshotLessonRemedyPolicy("short_course", 30));
});
test("malformed, foreign or unsupported frozen policy fails closed instead of silently using today's terms", () => {
  const frozen = snapshotLessonRemedyPolicy("monthly_tuition", 20);
  for (const record of [
    { policyVersion: frozen.version, policySnapshot: { ...frozen, courtesyLimit: 99 } },
    { policyVersion: "unknown-future-version", policySnapshot: frozen },
    { policyVersion: frozen.version, policySnapshot: null },
    { policyVersion: frozen.version, policySnapshot: snapshotLessonRemedyPolicy("short_course", 20) },
    { policyVersion: frozen.version, policySnapshot: snapshotLessonRemedyPolicy("monthly_tuition", 21) },
  ]) assert.throws(() => establishedLessonRemedyPolicy("monthly_tuition", 20, [record]),
    error => error instanceof LessonRemedyError && error.code === "policy_needs_review");
});
test("committed acceptance replay returns its saved link before new-transition or enrollment checks", () => {
  const source = readFileSync(new URL("./lessonRemedyStore.ts", import.meta.url), "utf8");
  const branch = source.slice(source.indexOf("export async function acceptLessonMakeup"), source.indexOf("export async function actOnLessonMakeup"));
  const replay = branch.indexOf("if (isReplay)");
  assert.ok(replay > 0 && replay < branch.indexOf("requireOpenEnrollment(p)"));
  assert.ok(replay < branch.indexOf("assessRemedyAcceptance("));
  const history = branch.slice(replay, branch.indexOf("requireOpenEnrollment(p)"));
  assert.match(history, /offer\.acceptedAt/); assert.match(history, /offer\.replacementSessionId/);
  assert.match(history, /changed: false/);
  assert.doesNotMatch(history, /insert\(|update\(|ledger\(/);
});
