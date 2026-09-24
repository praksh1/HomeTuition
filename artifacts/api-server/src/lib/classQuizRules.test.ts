import assert from "node:assert/strict";
import test from "node:test";
import { gradeQuiz, studentQuestions, validateQuiz } from "./classQuizRules.ts";
const draft = () => ({ title: "Practice", questions: [{ id: "q1", prompt: "2 + 2?", kind: "choice", options: ["3", "4"], answer: "4", points: 2, confirmed: true }, { id: "q2", prompt: "Capital?", kind: "short", options: [], answer: "Kathmandu", points: 1, confirmed: true }] });
test("server grades exact choices and normalized short answers, not supplied scores", () => {
  const quiz = validateQuiz(draft());
  assert.equal(gradeQuiz(quiz.questions, { q1: "4", q2: " KATHMANDU " }).score, 3);
  assert.equal(gradeQuiz(quiz.questions, { q1: "3", q2: "Kathmand" }).score, 0);
  assert.throws(() => gradeQuiz(quiz.questions, { q1: "4", q2: "K", score: 999 }), /match/);
  assert.throws(() => gradeQuiz(quiz.questions, { q1: "invalid", q2: "K" }), /listed/);
  assert.throws(() => gradeQuiz(quiz.questions, { q1: "4" }), /each/);
});
test("student projection never sends answer keys or confirmation metadata before reveal", () => {
  const questions = validateQuiz(draft()).questions;
  assert.ok(studentQuestions(questions).every(q => !("answer" in q) && !("confirmed" in q)));
  assert.equal(studentQuestions(questions, true)[0].answer, "4");
});
test("reject malformed content, duplicate ids, invalid points and ambiguous local deadlines", () => {
  const mutations: Array<(d: ReturnType<typeof draft>) => unknown> = [d => d.questions.push(d.questions[0]), d => d.questions[0].points = -1, d => d.questions[0].answer = "unknown", d => d.questions[0].options = ["4", " 4 "], d => d.questions[0].prompt = "", d => d.questions[0].answer = "", d => d.questions[0].id = "__proto__"];
  for (const mutate of mutations) {
    const d = draft(); mutate(d); assert.throws(() => validateQuiz(d));
  }
  assert.throws(() => validateQuiz({ ...draft(), dueAt: "2026-10-10T12:00" }), /complete/);
  assert.equal(validateQuiz({ ...draft(), dueAt: "2026-10-10T12:00:00+05:45" }).dueAt?.toISOString(), "2026-10-10T06:15:00.000Z");
});
