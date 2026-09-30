import assert from "node:assert/strict";
import test from "node:test";
import { lessonRemedyParticipantContext } from "./lessonRemedyContext.ts";

const c = { id: 3, studentId: 7, teacherId: 9 };
const events = [
  { id: 1, caseId: 3, actorId: 7, actorRole: "student", event: "request", detail: { note: "  I have a school exam.  " } },
  { id: 2, caseId: 3, actorId: 9, actorRole: "teacher", event: "reject", detail: { note: "I am unavailable then; please contact me." } },
  { id: 3, caseId: 3, actorId: 10, actorRole: "operator", event: "resolve", detail: { note: "PRIVATE OPERATOR REVIEW" } },
  { id: 4, caseId: 3, actorId: 10, actorRole: "operator", event: "reject", detail: { note: "PRIVATE MODERATION" } },
];
test("owned participant and operator views receive useful request/rejection context, not private operator notes", () => {
  for (const actor of [{ userId: 7, role: "student" }, { userId: 9, role: "teacher" }, { userId: 10, role: "admin" }]) {
    const context = lessonRemedyParticipantContext(c, actor, events);
    assert.deepEqual(context, { requestNote: "I have a school exam.", teacherDecisionReason: "I am unavailable then; please contact me." });
    assert.doesNotMatch(JSON.stringify(context), /PRIVATE/);
  }
});
test("foreign accounts, foreign case events, and stale rejection notes cannot leak into current context", () => {
  for (const actor of [{ userId: 8, role: "student" }, { userId: 8, role: "teacher" }, { userId: 0, role: "system" }]) {
    assert.deepEqual(lessonRemedyParticipantContext(c, actor, events), { requestNote: null, teacherDecisionReason: null });
  }
  const later = [...events, { id: 5, caseId: 3, actorId: 7, actorRole: "student", event: "request", detail: { note: "A different date please." } },
    { id: 6, caseId: 4, actorId: 7, actorRole: "student", event: "request", detail: { note: "OTHER CLASS" } }];
  assert.deepEqual(lessonRemedyParticipantContext(c, { userId: 9, role: "teacher" }, later),
    { requestNote: "A different date please.", teacherDecisionReason: null });
});
