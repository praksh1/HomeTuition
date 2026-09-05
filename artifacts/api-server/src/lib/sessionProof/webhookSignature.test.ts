import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import {
  REPLAY_WINDOW_SECONDS,
  expectedSignature,
  isActivationProbe,
  signingInput,
  verifyWebhookSignature,
} from "./webhookSignature.ts";

/**
 * These tests sign the way Daily signs, written out longhand.
 *
 * Deliberately *not* by calling `expectedSignature` — a test that builds its input with the same
 * helper the verifier uses agrees with the implementation no matter what either of them does, and
 * that is exactly how the first version of this file passed its own tests while accepting nothing
 * a real provider would ever send. The four elements of the scheme are spelled out here so that
 * removing any one of them from the implementation turns a test red.
 */

const SECRET = crypto.randomBytes(32).toString("base64");

/** The scheme, longhand: base64-decoded key, `timestamp + "." + JSON.stringify(body)`, base64 digest. */
function signLikeDaily(secretBase64: string, timestamp: string, body: unknown): string {
  return crypto
    .createHmac("sha256", Buffer.from(secretBase64, "base64"))
    .update(`${timestamp}.${JSON.stringify(body)}`)
    .digest("base64");
}

const BODY = { type: "meeting.started", id: "evt-1", payload: { room: "sikshya42", start_ts: 1_760_000_000 } };
const NOW_MS = 1_760_000_000_000;
const TS = String(Math.floor(NOW_MS / 1000));

test("a delivery signed exactly the way Daily signs is accepted", () => {
  const result = verifyWebhookSignature({
    secret: SECRET,
    timestamp: TS,
    signature: signLikeDaily(SECRET, TS, BODY),
    body: BODY,
    nowMs: NOW_MS,
  });
  assert.deepEqual(result, { ok: true });
});

test("the implementation agrees with the longhand scheme", () => {
  // The bridge between the two: if `expectedSignature` ever stops matching the scheme written out
  // above, this fails immediately rather than every other test failing mysteriously.
  assert.equal(expectedSignature(SECRET, TS, BODY), signLikeDaily(SECRET, TS, BODY));
});

test("the signed input carries the timestamp and a dot before the body", () => {
  // Guards the prefix specifically. A verifier that signed the body alone would accept a body
  // lifted from one delivery and replayed under any timestamp at all.
  assert.equal(signingInput("1700", { a: 1 }), '1700.{"a":1}');
  const withoutPrefix = crypto
    .createHmac("sha256", Buffer.from(SECRET, "base64"))
    .update(JSON.stringify(BODY))
    .digest("base64");
  assert.notEqual(withoutPrefix, signLikeDaily(SECRET, TS, BODY));
  assert.deepEqual(
    verifyWebhookSignature({ secret: SECRET, timestamp: TS, signature: withoutPrefix, body: BODY, nowMs: NOW_MS }),
    { ok: false, reason: "signature_mismatch" },
  );
});

test("the secret is decoded from base64, not used as characters", () => {
  // The difference is invisible until a real delivery arrives: both produce a digest, and only one
  // of them is Daily's.
  const asCharacters = crypto.createHmac("sha256", SECRET).update(signingInput(TS, BODY)).digest("base64");
  assert.notEqual(asCharacters, signLikeDaily(SECRET, TS, BODY));
  assert.deepEqual(
    verifyWebhookSignature({ secret: SECRET, timestamp: TS, signature: asCharacters, body: BODY, nowMs: NOW_MS }),
    { ok: false, reason: "signature_mismatch" },
  );
});

test("the digest is base64, not hex", () => {
  const asHex = crypto
    .createHmac("sha256", Buffer.from(SECRET, "base64"))
    .update(signingInput(TS, BODY))
    .digest("hex");
  assert.deepEqual(
    verifyWebhookSignature({ secret: SECRET, timestamp: TS, signature: asHex, body: BODY, nowMs: NOW_MS }),
    { ok: false, reason: "signature_mismatch" },
  );
});

test("a correctly signed delivery from outside the replay window is refused", () => {
  /*
    The check a valid signature cannot substitute for.

    The timestamp is *inside* the signed input, so a captured delivery replayed tomorrow carries a
    perfectly valid signature. Only freshness catches it.
  */
  const staleMs = NOW_MS + (REPLAY_WINDOW_SECONDS + 60) * 1000;
  assert.deepEqual(
    verifyWebhookSignature({
      secret: SECRET,
      timestamp: TS,
      signature: signLikeDaily(SECRET, TS, BODY),
      body: BODY,
      nowMs: staleMs,
    }),
    { ok: false, reason: "stale_timestamp" },
  );
});

test("a delivery from slightly in the future is still accepted", () => {
  // Two servers running NTP still disagree by seconds, and refusing that would drop genuine events.
  const skewed = NOW_MS - 60_000;
  assert.deepEqual(
    verifyWebhookSignature({
      secret: SECRET,
      timestamp: TS,
      signature: signLikeDaily(SECRET, TS, BODY),
      body: BODY,
      nowMs: skewed,
    }),
    { ok: true },
  );
});

test("a missing header is named, not treated as a mismatch", () => {
  const signature = signLikeDaily(SECRET, TS, BODY);
  assert.deepEqual(
    verifyWebhookSignature({ secret: SECRET, timestamp: undefined, signature, body: BODY, nowMs: NOW_MS }),
    { ok: false, reason: "missing_timestamp" },
  );
  assert.deepEqual(
    verifyWebhookSignature({ secret: SECRET, timestamp: TS, signature: undefined, body: BODY, nowMs: NOW_MS }),
    { ok: false, reason: "missing_signature" },
  );
  assert.deepEqual(
    verifyWebhookSignature({ secret: SECRET, timestamp: "  ", signature, body: BODY, nowMs: NOW_MS }),
    { ok: false, reason: "missing_timestamp" },
  );
});

test("a timestamp that is not a number is refused before any hashing", () => {
  assert.deepEqual(
    verifyWebhookSignature({
      secret: SECRET,
      timestamp: "yesterday",
      signature: signLikeDaily(SECRET, "yesterday", BODY),
      body: BODY,
      nowMs: NOW_MS,
    }),
    { ok: false, reason: "bad_timestamp" },
  );
});

test("a secret that is not real base64 is a configuration fault, not a mismatch", () => {
  /*
    Named separately on purpose. "signature mismatch" sends an operator to look at Daily's
    dashboard; "bad secret" sends them to look at the environment variable, which is where the
    problem actually is.
  */
  assert.equal(expectedSignature("not base64 !!!", TS, BODY), null);
  assert.equal(expectedSignature("", TS, BODY), null);
  assert.deepEqual(
    verifyWebhookSignature({ secret: "!!!!", timestamp: TS, signature: "x", body: BODY, nowMs: NOW_MS }),
    { ok: false, reason: "bad_secret" },
  );
});

test("a secret with or without base64 padding decodes the same way", () => {
  const padded = Buffer.from("sixteen bytes!!!").toString("base64");
  assert.ok(padded.endsWith("="));
  assert.equal(expectedSignature(padded, TS, BODY), expectedSignature(padded.replace(/=+$/, ""), TS, BODY));
});

test("a different body under the same timestamp does not verify", () => {
  const signature = signLikeDaily(SECRET, TS, BODY);
  assert.deepEqual(
    verifyWebhookSignature({
      secret: SECRET,
      timestamp: TS,
      signature,
      body: { ...BODY, id: "evt-2" },
      nowMs: NOW_MS,
    }),
    { ok: false, reason: "signature_mismatch" },
  );
});

test("a signature of the wrong length is refused rather than throwing", () => {
  // `timingSafeEqual` throws on unequal lengths, and a webhook route that throws is a webhook that
  // gets retried for hours.
  assert.deepEqual(
    verifyWebhookSignature({ secret: SECRET, timestamp: TS, signature: "abc", body: BODY, nowMs: NOW_MS }),
    { ok: false, reason: "signature_mismatch" },
  );
});

/* ---------------------------------------------------------------------------- activation probe */

test("Daily's activation probe is recognised exactly", () => {
  assert.equal(isActivationProbe({ test: "test" }), true);
});

test("nothing else is mistaken for the activation probe", () => {
  /*
    This matters more than it looks. The probe is answered *unsigned*, so anything this function
    calls a probe is a body that skips signature verification entirely.
  */
  assert.equal(isActivationProbe({ test: "test", type: "meeting.started" }), false);
  assert.equal(isActivationProbe({ test: "TEST" }), false);
  assert.equal(isActivationProbe({ test: 1 }), false);
  assert.equal(isActivationProbe({ Test: "test" }), false);
  assert.equal(isActivationProbe({}), false);
  assert.equal(isActivationProbe([{ test: "test" }]), false);
  assert.equal(isActivationProbe("test"), false);
  assert.equal(isActivationProbe(null), false);
  assert.equal(isActivationProbe(undefined), false);
  assert.equal(isActivationProbe({ type: "participant.joined", payload: { room: "sikshya1" } }), false);
});
