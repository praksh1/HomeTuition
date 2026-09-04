import assert from "node:assert/strict";
import { test } from "node:test";
import { emailFor, type NotificationEvent } from "./notificationEmails.ts";

/**
 * A sentence about money has to be true about the event it describes.
 *
 * The defect these pin: a test booking took no money and sent the teacher an email saying a
 * student had "booked and paid" for their class. The event carried `amount: 0`, which nothing
 * read, and the formatter had no way to tell the two apart. A teacher reading that is being told
 * something false about their own income by the app that is supposed to be counting it.
 *
 * The field is `testBooking`, named for what it is true of. A class being *open* to test bookings
 * is a different fact and must not reach a sentence about somebody's money.
 */

const booked = (extra: Partial<NotificationEvent> = {}): NotificationEvent => ({
  kind: "session_booked",
  at: new Date().toISOString(),
  fromName: "Sita",
  topic: "Algebra",
  sessionId: 7,
  ...extra,
});

test("an ordinary booking still says booked and paid", () => {
  const mail = emailFor(booked({ amount: 500 }), "Ram Bahadur");
  assert.ok(mail);
  assert.match(mail.text, /booked and paid for your class/);
  assert.doesNotMatch(mail.subject, /TEST/);
  assert.doesNotMatch(mail.text, /no payment/i);
  assert.match(mail.text, /Hi Ram,/, "and still greets them by their first name");
});

test("a test booking never claims a payment was made", () => {
  const mail = emailFor(booked({ amount: 0, testBooking: true }), "Ram Bahadur");
  assert.ok(mail);
  assert.doesNotMatch(mail.text, /paid/i, "not even in passing");
  assert.match(mail.text, /NO PAYMENT WAS PROCESSED/);
  assert.match(mail.text, /nothing was added to your earnings/i);
});

test("the body is plain text, so it carries no Markdown to read as punctuation", () => {
  // These are sent as `text`, not HTML. A mail client shows `**No payment**` with the asterisks
  // in it, which reads as a typo in the one sentence that most needs to be believed.
  for (const event of [booked({ amount: 500 }), booked({ testBooking: true })]) {
    const mail = emailFor(event, "Ram");
    assert.ok(mail);
    assert.doesNotMatch(mail.text, /\*\*/, mail.text);
    assert.doesNotMatch(mail.subject, /\*\*/);
  }
});

test("and says so in the subject, which is all a phone shows", () => {
  // A teacher glancing at a notification bar reads the subject and nothing else.
  const mail = emailFor(booked({ testBooking: true }), "Ram");
  assert.ok(mail);
  assert.match(mail.subject, /TEST, no payment/);
});

test("the two are genuinely different emails, not one with a suffix", () => {
  const paid = emailFor(booked({ amount: 500 }), "Ram");
  const free = emailFor(booked({ amount: 0, testBooking: true }), "Ram");
  assert.ok(paid && free);
  assert.notEqual(paid.subject, free.subject);
  assert.notEqual(paid.text, free.text);
});

test("`testBooking` is read as a flag, never inferred from a zero amount", () => {
  /**
   * A free class and a class nobody was charged for are different facts. If the formatter guessed
   * from `amount === 0` it would relabel any genuinely free class as a test booking, and it would
   * miss a test booking on a class whose price happened to be sent along.
   */
  const zeroButReal = emailFor(booked({ amount: 0 }), "Ram");
  assert.ok(zeroButReal);
  assert.match(zeroButReal.text, /booked and paid/, "a zero amount alone is not a test booking");

  const testWithPrice = emailFor(booked({ amount: 500, testBooking: true }), "Ram");
  assert.ok(testWithPrice);
  assert.match(testWithPrice.text, /No payment was processed/i, "and the flag wins over the number");
});

test("nothing else's wording moved", () => {
  // The split into this file was meant to change one branch. Everything else is checked here so
  // a future edit to the shared greeting or signoff cannot quietly reword six emails at once.
  const at = new Date().toISOString();
  const cases: [NotificationEvent, RegExp][] = [
    [{ kind: "message", at, fromName: "Sita", preview: "hello" }, /sent you a message/],
    [{ kind: "follower", at, fromName: "Sita" }, /has started following you/],
    [{ kind: "session_invite", at, fromName: "Sita", topic: "Algebra" }, /has scheduled a new class/],
    [{ kind: "session_dropped", at, fromName: "Sita", topic: "Algebra" }, /has dropped your class/],
    [{ kind: "session_live", at, topic: "Algebra" }, /is live now/],
  ];
  for (const [event, expected] of cases) {
    const mail = emailFor(event, "Ram");
    assert.ok(mail, event.kind);
    assert.match(mail.text, expected, event.kind);
    assert.match(mail.text, /turn these emails off/, `${event.kind} keeps the signoff`);
  }
});

test("a kind with no email written for it sends none, rather than an empty one", () => {
  assert.equal(emailFor({ kind: "session_rescheduled", at: "", topic: "x" }, "Ram")?.subject !== undefined, true);
  // The default branch: an unknown kind returns null and nothing is sent.
  assert.equal(emailFor({ kind: "unheard_of" as NotificationEvent["kind"], at: "" }, "Ram"), null);
});
