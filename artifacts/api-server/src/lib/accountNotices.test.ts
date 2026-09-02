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
  assert.match(deliveryLine("sent", true), /was emailed/);

  const failed = deliveryLine("failed", false);
  assert.match(failed, /could not be delivered/);
  assert.doesNotMatch(failed, /was emailed/);

  const unconfigured = deliveryLine("not_configured", false);
  assert.match(unconfigured, /no email was sent/);
  assert.doesNotMatch(unconfigured, /was emailed/);
});

test("the delivery line is honest about the in-app half", () => {
  // There is no server-side notification store: an offline teacher receives nothing in-app.
  // The operator must not read "they have been told" when only a socket push was attempted.
  assert.match(deliveryLine("sent", false), /next open the app/);
  assert.match(deliveryLine("sent", true), /appeared in their open app/);
});
