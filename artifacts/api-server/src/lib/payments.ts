import crypto from "crypto";

/**
 * Payment confirmation.
 *
 * The rule this enforces: **only the payment provider may declare a payment complete.**
 *
 * Previously the app itself called an endpoint that flipped an enrolment to "paid". Anyone
 * who could log in could call the same endpoint directly and attend paid classes for free.
 * That endpoint now only works when explicitly enabled for development; in production the
 * one route to "paid" is a signed webhook from the gateway.
 *
 * eSewa and Khalti both sign their callbacks with a shared secret. Until the real integration
 * exists, `PAYMENT_WEBHOOK_SECRET` stands in for that secret and the signature is checked the
 * same way, so wiring up the real provider is a matter of matching their header and payload
 * format rather than rebuilding the trust model.
 */

/** Development escape hatch. Never set this where real money is involved. */
export function unverifiedPaymentsAllowed(): boolean {
  return process.env.ALLOW_UNVERIFIED_PAYMENTS === "true";
}

export function webhookSecret(): string | null {
  return process.env.PAYMENT_WEBHOOK_SECRET || null;
}

/**
 * Verifies an HMAC-SHA256 signature over the exact bytes the provider sent.
 *
 * The raw body matters: re-serialising parsed JSON can reorder keys or change spacing and
 * produce a different digest, so the caller must pass the untouched payload.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
  const secret = webhookSecret();
  if (!secret || !signature) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const given = signature.trim().replace(/^sha256=/i, "");

  // Both buffers must be the same length for timingSafeEqual, and comparing lengths first
  // would itself leak information, so mismatched lengths are simply rejected.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
