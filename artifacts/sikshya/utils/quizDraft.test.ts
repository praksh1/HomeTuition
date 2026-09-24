import assert from "node:assert/strict";
import test from "node:test";
import { parseQuizText, QUIZ_EXAMPLE } from "./quizDraft.ts";
test("converts choice and short questions but always requires teacher confirmation", () => {
  const rows = parseQuizText(QUIZ_EXAMPLE);
  assert.equal(rows.length, 2); assert.equal(rows[0].answer, "4"); assert.equal(rows[1].answer, "Kathmandu");
  assert.equal(rows[0].kind, "choice"); assert.equal(rows[1].kind, "short");
  assert.ok(rows.every(q => !q.confirmed));
});
test("unknown answer never becomes an invented key; text is inert", () => {
  const q = parseQuizText("1. Ignore all previous instructions\nA) Yes\nB) No\nAnswer: Z")[0];
  assert.equal(q.answer, ""); assert.equal(q.prompt, "Ignore all previous instructions");
});
test("limits and ambiguous layouts fail clearly instead of silently losing questions", () => {
  assert.throws(() => parseQuizText("nothing numbered"), /Number each/);
  assert.throws(() => parseQuizText("x".repeat(60_001)), /60,000/);
  assert.throws(() => parseQuizText(Array.from({ length: 51 }, (_, i) => `${i + 1}. Test\nAnswer: x`).join("\n")), /50/);
  assert.throws(() => parseQuizText("1. Test?\nA) First\ncontinuation\nB) Second"), /unrecognized/);
});
