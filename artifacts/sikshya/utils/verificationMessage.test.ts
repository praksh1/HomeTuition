import assert from "node:assert/strict";
import test from "node:test";
import {
  noticeFromParams,
  noticeFromResend,
  noticeFromResendError,
  type VerificationNotice,
} from "./verificationMessage.ts";

/** Every claim the screen must never make when it does not know delivery happened. */
const CLAIMS_SENT = /\bhas been sent\b|\bwe sent\b|\bsent to this address\b/i;

const say = (n: VerificationNotice) => `${n.tone}: ${n.text}`;

test("no parameters at all never claims an email was sent", () => {
  // AuthGuard redirects here with no params, and the login screen passes only an address. This is
  // the common path, not the edge case, and it defaulted to "We sent a verification link."
  const notice = noticeFromParams(undefined, undefined);
  assert.equal(notice.tone, "unknown");
  assert.doesNotMatch(notice.text, CLAIMS_SENT, say(notice));
  assert.match(notice.text, /cannot confirm/i);
  // It has to leave the reader somewhere to go.
  assert.match(notice.text, /Send another link/i);
});

test("an unconfigured server says nothing was sent and why", () => {
  const notice = noticeFromParams("0", "0");
  assert.equal(notice.tone, "unconfigured");
  assert.match(notice.text, /not set up|not configured/i);
  assert.match(notice.text, /account is saved/i);
  assert.doesNotMatch(notice.text, CLAIMS_SENT, say(notice));
});

test("configured but not sent is a failure, not a missing configuration", () => {
  // The defect: `sent === "0" || configured === "0"` produced the *unconfigured* text for both, so
  // a transient send failure told the teacher to go and contact support.
  const notice = noticeFromParams("0", "1");
  assert.equal(notice.tone, "failed");
  assert.match(notice.text, /could not be sent/i);
  assert.match(notice.text, /Send another link/i);
  assert.doesNotMatch(notice.text, /not set up|not configured/i, say(notice));
});

test("a confirmed send says so without promising it arrived", () => {
  const notice = noticeFromParams("1", "1");
  assert.equal(notice.tone, "sent");
  assert.match(notice.text, /24 hours/);
  // Submission is not delivery.
  assert.match(notice.text, /not guaranteed|check spam/i);
});

test("unconfigured outranks a stale sent flag", () => {
  // A server with no provider cannot have sent anything, whatever the other parameter says.
  const notice = noticeFromParams("1", "0");
  assert.equal(notice.tone, "unconfigured");
  assert.doesNotMatch(notice.text, CLAIMS_SENT, say(notice));
});

test("a malformed flag is missing information, not a negative answer", () => {
  for (const bad of ["", "true", "yes", "01", " 1"]) {
    const notice = noticeFromParams(bad, bad);
    assert.equal(notice.tone, "unknown", `"${bad}" should read as unknown`);
    assert.doesNotMatch(notice.text, CLAIMS_SENT, say(notice));
  }
});

test("repeated parameters arrive as an array and are read from the first value", () => {
  // Navigating to the screen more than once can repeat a query parameter.
  assert.equal(noticeFromParams(["1"], ["1"]).tone, "sent");
  assert.equal(noticeFromParams(["0"], ["0"]).tone, "unconfigured");
  assert.equal(noticeFromParams([], []).tone, "unknown");
});

test("repeated navigation without parameters keeps saying the truthful unknown", () => {
  // A user who registers, wanders off and is bounced back by AuthGuard loses the parameters. The
  // screen must degrade to "we cannot confirm", never back up to a claim it can no longer support.
  const first = noticeFromParams("1", "1");
  const afterRedirect = noticeFromParams(undefined, undefined);
  const again = noticeFromParams(undefined, undefined);

  assert.equal(first.tone, "sent");
  assert.equal(afterRedirect.tone, "unknown");
  assert.deepEqual(again, afterRedirect, "the same inputs must give the same answer every time");
  assert.doesNotMatch(afterRedirect.text, CLAIMS_SENT, say(afterRedirect));
});

test("an already-verified resend never claims another email went out", () => {
  // The route answers 200 with { verified: true, sent: false }. The screen treated any 200 as
  // proof and announced a new link — false in exactly the case the server was being careful about.
  const notice = noticeFromResend({ verified: true, sent: false });
  assert.equal(notice.tone, "verified");
  assert.match(notice.text, /already verified/i);
  assert.match(notice.text, /no new link was sent/i);
  assert.doesNotMatch(notice.text, /A new verification link has been sent/i, say(notice));
});

test("a genuine resend reports the send without promising delivery", () => {
  const notice = noticeFromResend({ verified: false, sent: true });
  assert.equal(notice.tone, "sent");
  assert.match(notice.text, /new verification link has been sent/i);
  assert.match(notice.text, /spam|junk/i);
});

test("a 200 that confirms nothing is not treated as a send", () => {
  for (const body of [{}, null, undefined, { verified: false, sent: false }, { sent: "yes" }]) {
    const notice = noticeFromResend(body);
    assert.equal(notice.tone, "failed", `body ${JSON.stringify(body)} should not read as sent`);
    assert.doesNotMatch(notice.text, /A new verification link has been sent/i, say(notice));
  }
});

test("a failed resend shows the server's own explanation when there is one", () => {
  // 429 and 503 both arrive as thrown ApiErrors carrying the route's message.
  const rateLimited = noticeFromResendError(new Error("Please wait a minute before asking for another email."));
  assert.equal(rateLimited.tone, "failed");
  assert.match(rateLimited.text, /wait a minute/i);

  const unconfigured = noticeFromResendError(new Error("Email delivery is not configured yet. Please contact Sikshya support."));
  assert.match(unconfigured.text, /not configured yet/i);
});

test("a failed resend with no usable message still says something true", () => {
  for (const thrown of [new Error("   "), new Error(""), "a string", null, undefined]) {
    const notice = noticeFromResendError(thrown);
    assert.equal(notice.tone, "failed");
    assert.match(notice.text, /could not be sent/i);
  }
});

test("no notice the module can produce promises an inbox", () => {
  const every = [
    noticeFromParams(undefined, undefined),
    noticeFromParams("0", "0"),
    noticeFromParams("0", "1"),
    noticeFromParams("1", "1"),
    noticeFromResend({ verified: true, sent: false }),
    noticeFromResend({ verified: false, sent: true }),
    noticeFromResend({}),
    noticeFromResendError(new Error("boom")),
  ];
  for (const notice of every) {
    assert.doesNotMatch(
      notice.text,
      /check your inbox|it has arrived|you will receive|arrived in your/i,
      say(notice),
    );
  }
});
