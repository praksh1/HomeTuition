import crypto from "node:crypto";

/**
 * Proving a webhook really came from Daily.
 *
 * ## Why this is its own file, and why it is this pedantic
 *
 * `/webhooks/daily` is unauthenticated by definition: anybody on the internet can POST to it. The
 * signature is the *only* thing standing between "Daily said the teacher was in the room" and
 * "somebody said Daily said the teacher was in the room" — on an endpoint whose whole purpose is
 * to produce evidence in a money argument. A verifier that is approximately right is a verifier
 * that is wrong.
 *
 * A first version of this file got the algorithm wrong in four separate ways at once — hex digest
 * instead of base64, the secret used as raw UTF-8 instead of decoded base64, the signing input
 * missing its timestamp prefix, and no replay window at all. Each of those alone accepts nothing
 * genuine; together they described a coherent scheme that simply was not Daily's. That is why the
 * shape of the input is spelled out below rather than left to the reader.
 *
 * ## The scheme
 *
 * ```
 *   key       = base64-decode(DAILY_WEBHOOK_SECRET)
 *   input     = <X-Webhook-Timestamp> + "." + JSON.stringify(<parsed body>)
 *   signature = base64( HMAC-SHA256(key, input) )
 * ```
 *
 * compared against `X-Webhook-Signature` in constant time, with the timestamp required to be
 * recent.
 *
 * Two details are easy to get wrong and both are load-bearing:
 *
 * - **The secret is base64.** Daily hands back a base64 string; using its characters as key bytes
 *   produces a different key and therefore a different digest for every message.
 * - **The signed input is the re-serialised body, not the raw bytes.** This is unlike most webhook
 *   schemes — including this project's own payment webhook, which signs `req.rawBody` — and it is
 *   what Daily documents. It is written explicitly here so nobody "fixes" it back to raw bytes.
 *
 * ## What could not be verified from this container
 *
 * **`docs.daily.co` is blocked by this environment's network egress proxy, so the algorithm above
 * could not be checked against Daily's own documentation by the agent that wrote it.** It is
 * implemented from the contract stated in review. Before ingestion is enabled against real
 * traffic, one genuine delivery must be verified end to end — see `SESSION-PROOF.md`. A verifier
 * that rejects everything and a provider that sends nothing look identical from the outside.
 *
 * Pure apart from `node:crypto`, so every branch is exercised without a server.
 */

/** Daily's headers. Lowercase because Node lowercases incoming header names. */
export const TIMESTAMP_HEADER = "x-webhook-timestamp";
export const SIGNATURE_HEADER = "x-webhook-signature";

/**
 * How stale a signed delivery may be.
 *
 * Without this, a signature is valid forever: anybody who captures one genuine delivery can replay
 * it indefinitely, and while the unique index stops a *duplicate* being stored twice, a replay of
 * a `participant.left` from a different class is a new row with a new id.
 *
 * Five minutes is Daily's own retry horizon for a first delivery and comfortably wider than any
 * plausible clock skew between two servers running NTP. A genuine retry that arrives later than
 * this is refused and lost, which is the right trade: the socket ledger is the primary record and
 * this is corroboration.
 */
export const REPLAY_WINDOW_SECONDS = 5 * 60;

export type SignatureFailure =
  | "missing_timestamp"
  | "bad_timestamp"
  | "stale_timestamp"
  | "missing_signature"
  | "bad_secret"
  | "signature_mismatch";

export type VerifyResult = { ok: true } | { ok: false; reason: SignatureFailure };

/**
 * The exact bytes Daily signs.
 *
 * Exported so a test can build one the same way the verifier reads one, and so the "." is written
 * down in one place instead of being implied by a template literal in two.
 */
export function signingInput(timestamp: string, body: unknown): string {
  return `${timestamp}.${JSON.stringify(body)}`;
}

/**
 * The base64 HMAC for a body, or null when the secret is not usable base64.
 *
 * Null rather than a throw: an unusable secret is a deployment mistake, and a webhook route that
 * throws on one turns a configuration error into a 500 that Daily retries for hours.
 */
export function expectedSignature(secretBase64: string, timestamp: string, body: unknown): string | null {
  const key = decodeSecret(secretBase64);
  if (key === null) return null;
  return crypto.createHmac("sha256", key).update(signingInput(timestamp, body), "utf8").digest("base64");
}

/**
 * Daily's secret is base64. Anything that is not is a configuration error, not a key.
 *
 * `Buffer.from(x, "base64")` never throws — it silently ignores characters outside the alphabet —
 * so the round trip is checked rather than trusted. A typo'd secret that quietly decoded to three
 * bytes would reject every genuine delivery, and the logs would say "signature mismatch", which is
 * the wrong thing to go and look at.
 */
function decodeSecret(secretBase64: string): Buffer | null {
  const trimmed = secretBase64.trim();
  if (trimmed.length === 0) return null;
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === 0) return null;
  // Re-encoding is normalised for padding, which Daily may or may not include.
  if (decoded.toString("base64").replace(/=+$/, "") !== trimmed.replace(/=+$/, "")) return null;
  return decoded;
}

/** Constant-time compare of two base64 strings, without leaking which one was longer than a byte. */
function sameSignature(expected: string, given: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given.trim(), "utf8");
  // timingSafeEqual throws on differing lengths, so the length is compared first. A base64 SHA-256
  // digest is always 44 characters, so this leaks nothing an attacker did not already know.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface VerifyInput {
  /** `DAILY_WEBHOOK_SECRET`, as Daily returned it: base64. */
  secret: string;
  /** The `X-Webhook-Timestamp` header, verbatim. */
  timestamp: string | undefined;
  /** The `X-Webhook-Signature` header, verbatim. */
  signature: string | undefined;
  /** The parsed JSON body. Re-serialised to build the signing input; see the note above. */
  body: unknown;
  nowMs: number;
}

/**
 * Every check a signed delivery must pass, in the order it must pass them.
 *
 * Order matters for one reason only: the timestamp is checked before the digest so a replayed but
 * correctly-signed body is refused as stale rather than accepted. The digest cannot substitute for
 * the freshness check, because the timestamp is *inside* the signed input — a replay carries a
 * perfectly valid signature over an old timestamp.
 */
export function verifyWebhookSignature(input: VerifyInput): VerifyResult {
  const { secret, timestamp, signature, body, nowMs } = input;

  if (typeof timestamp !== "string" || timestamp.trim() === "") return { ok: false, reason: "missing_timestamp" };
  if (typeof signature !== "string" || signature.trim() === "") return { ok: false, reason: "missing_signature" };

  const seconds = Number(timestamp.trim());
  if (!Number.isFinite(seconds)) return { ok: false, reason: "bad_timestamp" };

  const skewSeconds = Math.abs(nowMs / 1000 - seconds);
  if (skewSeconds > REPLAY_WINDOW_SECONDS) return { ok: false, reason: "stale_timestamp" };

  // The timestamp is signed verbatim, so the *original* string is used here rather than the number
  // parsed out of it. Re-formatting it would change the input and reject every genuine delivery.
  const expected = expectedSignature(secret, timestamp.trim(), body);
  if (expected === null) return { ok: false, reason: "bad_secret" };

  return sameSignature(expected, signature) ? { ok: true } : { ok: false, reason: "signature_mismatch" };
}

/* --------------------------------------------------------------------------- activation probe */

/**
 * Daily's endpoint-activation probe.
 *
 * When a webhook is created, Daily immediately POSTs `{"test":"test"}` and will not activate the
 * endpoint unless it answers 200. **The signing secret is returned by that same creation call**,
 * so at probe time there is nothing to verify against: a deployment that demanded a signature
 * here could never be activated at all, which is precisely the deadlock this function exists to
 * break.
 *
 * It is safe to answer an unsigned probe because answering it does nothing. Exactly this body,
 * nothing stored, nothing read, no class touched, no configuration disclosed — a deployment with
 * ingestion configured and one without answer it identically, so it is not an oracle for whether
 * this server ingests webhooks.
 *
 * Deliberately exact. Not "has a `test` key", not "is small": a body with any other key, or any
 * other value, is a real delivery and must survive the full check.
 */
export function isActivationProbe(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  const keys = Object.keys(body as Record<string, unknown>);
  return keys.length === 1 && keys[0] === "test" && (body as Record<string, unknown>).test === "test";
}
