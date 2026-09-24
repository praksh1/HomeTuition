import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSupportReviewBrief, conversationTopic, investigationChoices, supportInvestigation, type SupportTurn } from "./supportInvestigation.ts";

test("a technical investigation progresses across short replies without repeating questions", () => {
  const history: SupportTurn[] = [];
  const prompts = new Set<string>();
  for (const question of ["My call is broken", "Camera or microphone", "iPhone Safari", "Today 10AM Nepal, I already checked permissions"]) {
    const result = supportInvestigation({ topic: "class_access", history, question, candidate: "Unknown", candidateSource: "handoff" })!;
    assert.ok(!prompts.has(result.answer));
    prompts.add(result.answer);
    history.push({ role: "user", body: question }, { role: "assistant", body: result.answer });
  }
  assert.match(history.at(-1)!.body, /person should review/);
  assert.equal(conversationTopic("general", ["general", "class_access"]), "class_access");
  assert.equal(conversationTopic("account", ["class_access"]), "class_access");
  assert.equal(conversationTopic("safety", ["billing"]), "safety");
});
test("a failed or repeated FAQ advances to investigation, not another copy", () => {
  const history = [{ role: "assistant", body: "Check permissions" }];
  assert.ok(supportInvestigation({ topic: "class_access", history, question: "Still not working", candidate: "Check permissions", candidateSource: "faq" }));
  assert.equal(supportInvestigation({ topic: "class_access", history: [], question: "How can I join?", candidate: "Open Classes", candidateSource: "faq" }), null);
});
test("human and safety paths stay accessible and do not claim evidence was viewed", () => {
  assert.equal(supportInvestigation({ topic: "general", history: [], question: "I need a human", candidate: "", candidateSource: "local" })?.readyForHuman, true);
  const first = supportInvestigation({ topic: "safety", history: [], question: "unsafe", candidate: "", candidateSource: "handoff" })!;
  assert.equal(first.readyForHuman, true);
  const next = supportInvestigation({ topic: "safety", history: [{ role: "assistant", body: first.answer }], question: "class", candidate: "", candidateSource: "handoff" })!;
  assert.match(next.answer, /have not viewed/);
});
test("stored choices reopen exactly and case brief distinguishes allegations from records", () => {
  const result = supportInvestigation({ topic: "class_access", history: [], question: "Broken", candidate: "", candidateSource: "handoff" })!;
  assert.deepEqual(investigationChoices(result.answer), result.choices);
  const brief = buildSupportReviewBrief([{ role: "user", body: "The teacher never came" }], ["Session #12 status: completed (sessions record)."]);
  assert.match(brief, /not independently verified/);
  assert.match(brief, /Session #12/);
  assert.match(brief, /Missing records are not proof/);
  assert.ok(brief.length <= 4000);
});

test("long handoffs retain the initial report and latest corrections", () => {
  const reports = Array.from({ length: 15 }, (_, i) => ({ role: "user", body: `Distinct detail ${i + 1}.` }));
  const brief = buildSupportReviewBrief(reports);
  assert.match(brief, /Distinct detail 1\./);
  assert.match(brief, /Distinct detail 15\./);
  assert.match(brief, /Additional reports remain/);
});
