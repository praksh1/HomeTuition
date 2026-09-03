import assert from "node:assert/strict";
import test from "node:test";
import {
  FORBIDDEN_PHRASES,
  deliveryLine,
  documentDecisionNotice,
  teacherAccessDecisionNotice,
} from "./accountNotices.ts";

/** Every notice the module can produce, so a banned phrase is checked against all of them. */
function everyNotice() {
  return [
    documentDecisionNotice({ documentType: "citizenship", decision: "approved", recipientName: "Asha Gurung" }),
    documentDecisionNotice({
      documentType: "citizenship",
      decision: "rejected",
      reason: "The back of the card is missing.",
      recipientName: "Asha Gurung",
    }),
    documentDecisionNotice({ documentType: "teaching_license", decision: "approved", recipientName: "Bikash" }),
    teacherAccessDecisionNotice({ decision: "approved", recipientName: "Asha Gurung" }),
    teacherAccessDecisionNotice({
      decision: "rejected",
      note: "Your subject and your documents do not match.",
      recipientName: "Asha Gurung",
    }),
  ];
}

test("no notice claims Sikshya approved somebody's citizenship or identity", () => {
  // This is the defect that started the slice. A teacher was emailed "Your citizenship was
  // approved." by a tutoring company, which has no standing to say it.
  for (const notice of everyNotice()) {
    const haystack = `${notice.preview}\n${notice.subject}\n${notice.body}`.toLowerCase();
    for (const { phrase, because } of FORBIDDEN_PHRASES) {
      assert.ok(
        !haystack.includes(phrase.toLowerCase()),
        `"${phrase}" must never be sent — ${because}. Found in: ${haystack}`,
      );
    }
  }
});

test("accepting a document does not claim teacher access is active", () => {
  const notice = documentDecisionNotice({
    documentType: "citizenship",
    decision: "approved",
    recipientName: "Asha Gurung",
  });
  assert.match(notice.body, /accepted for Sikshya's teacher verification/);
  // The limit has to travel with the good news, or it is not read at all.
  assert.match(notice.body, /does not by itself activate\s+teacher access/);
  assert.match(notice.body, /notify you separately when the account review is complete/);
  assert.equal(notice.subject, "Sikshya document review update");
});

test("a rejected document names the document, the reason, and the way back", () => {
  const notice = documentDecisionNotice({
    documentType: "citizenship",
    decision: "rejected",
    reason: "The back of the card is missing.",
    recipientName: "Asha Gurung",
  });
  assert.match(notice.body, /citizenship document/);
  assert.match(notice.body, /The back of the card is missing\./);
  assert.match(notice.body, /upload a replacement/);
  // No judgement of the person, only of the file.
  assert.doesNotMatch(notice.body.toLowerCase(), /unfortunately|we regret|failed to/);
});

test("the document label never doubles the word document", () => {
  const notice = documentDecisionNotice({
    documentType: "identity_document",
    decision: "approved",
    recipientName: "Bikash",
  });
  assert.doesNotMatch(notice.body, /document document/);
});

test("teacher access approval points at the real next step", () => {
  const notice = teacherAccessDecisionNotice({ decision: "approved", recipientName: "Asha Gurung" });
  assert.match(notice.body, /teacher account has been approved/);
  // The old copy said "You can schedule classes now", which was false: a plan comes first.
  assert.match(notice.body, /choose a teaching plan/);
  assert.match(notice.preview, /choose a teaching plan/);
});

test("account approval and document acceptance are different messages", () => {
  const document = documentDecisionNotice({
    documentType: "citizenship",
    decision: "approved",
    recipientName: "Asha Gurung",
  });
  const account = teacherAccessDecisionNotice({ decision: "approved", recipientName: "Asha Gurung" });

  assert.notEqual(document.subject, account.subject);
  assert.notEqual(document.preview, account.preview);
  // The document message must not mention the plan step; the account one must.
  assert.doesNotMatch(document.body, /teaching plan/);
  assert.match(account.body, /teaching plan/);
});

test("a rejected account carries the operator's note", () => {
  const notice = teacherAccessDecisionNotice({
    decision: "rejected",
    note: "Your subject and your documents do not match.",
    recipientName: "Asha Gurung",
  });
  assert.match(notice.body, /Your subject and your documents do not match\./);
  assert.match(notice.body, /review will continue/);
});

test("a missing first name does not produce a broken greeting", () => {
  const notice = teacherAccessDecisionNotice({ decision: "approved", recipientName: "   " });
  assert.match(notice.body, /^Hello there,/);
});

test("the delivery line never claims an email that did not go", () => {
  // Only the "sent" outcome may say the teacher was emailed — in either connection state.
  for (const online of [true, false]) {
    assert.match(deliveryLine("sent", online), /was emailed/);
    assert.doesNotMatch(deliveryLine("failed", online), /was emailed/);
    assert.doesNotMatch(deliveryLine("not_configured", online), /was emailed/);
  }

  // And each failure says which of the two it was, so the operator knows whether to chase it.
  assert.match(deliveryLine("failed", true), /could not be delivered/);
  assert.match(deliveryLine("failed", false), /could not be delivered/);
  assert.match(deliveryLine("not_configured", true), /not configured/);
  assert.match(deliveryLine("not_configured", false), /not configured/);
});

test("the delivery line never promises in-app delivery that will not happen", () => {
  /*
    There is no server-side notification store. An offline teacher receives nothing in-app, then
    or later — the notification is not queued and does not arrive on next open.

    An earlier version said "they will see it when they next open the app". It read as the
    reassuring thing to say and was false, which is the exact defect this module exists to remove.
  */
  for (const outcome of ["sent", "failed", "not_configured"] as const) {
    const offline = deliveryLine(outcome, false);
    assert.match(
      offline,
      /No in-app notification was delivered because the teacher was not connected\.|not connected to receive an in-app notification/,
    );
    assert.doesNotMatch(offline, /next open|when they open|will see it|later/i);
  }
  assert.match(deliveryLine("sent", true), /appeared in their open app/);
});

test("when neither channel reached the teacher, the operator is told in those words", () => {
  // "The decision was saved" on its own reads as "and they were told". It has to say otherwise.
  for (const outcome of ["failed", "not_configured"] as const) {
    assert.match(deliveryLine(outcome, false), /has NOT been notified/);
  }

  // And it must not say that when one channel did land.
  assert.doesNotMatch(deliveryLine("failed", true), /has NOT been notified/);
  assert.doesNotMatch(deliveryLine("sent", false), /has NOT been notified/);
});
