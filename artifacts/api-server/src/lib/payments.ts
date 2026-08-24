import crypto from "crypto";

/**
 * Payment confirmation.
 *
 * Two rules shape this file, and they pull against each other:
 *
 *  1. **Only the payment provider may declare a payment complete.** A client saying "I paid"
 *     is not evidence of payment. If the app could mark its own enrolments paid, any student
 *     who could log in could attend every paid class for free.
 *
 *  2. **A booking is never half-done.** Either the student is enrolled and paid and can walk
 *     into the class, or nothing happened and they are told to try another method. An
 *     enrolment stuck at "pending" is the worst outcome: the class shows up in the student's
 *     list, the money question is unresolved, and the door refuses them at the last moment.
 *
 * Rule 1 alone leaves nothing working until a gateway is integrated. So payments run in one
 * of two modes, and the mode is chosen by what is configured rather than by a flag someone
 * has to remember to flip:
 *
 *   - **gateway** — a real provider is configured. Payment is settled only by a signed
 *     callback from that provider.
 *   - **simulated** — no provider is configured yet. The server approves the charge itself so
 *     the product can be tested end to end, and says so loudly in the log every time.
 *
 * The important property is that this **tightens itself**. The moment gateway credentials
 * exist in the environment, simulated mode stops being available — there is no way to connect
 * a real provider and accidentally leave the free door open, because the presence of the
 * provider is what closes it.
 */

export type PaymentMode = "gateway" | "simulated";

/** Set when a real provider is wired up. Any one of these means "we take real money now". */
function gatewayConfigured(): boolean {
  return !!(
    process.env.PAYMENT_WEBHOOK_SECRET ||
    process.env.ESEWA_MERCHANT_ID ||
    process.env.KHALTI_SECRET_KEY
  );
}

/**
 * Which mode we are in.
 *
 * Note the asymmetry: configuring a gateway forces gateway mode, and no environment variable
 * can override that. `PAYMENT_MODE=simulated` is honoured only while no provider exists.
 */
export function paymentMode(): PaymentMode {
  if (gatewayConfigured()) return "gateway";
  return "simulated";
}

export function webhookSecret(): string | null {
  return process.env.PAYMENT_WEBHOOK_SECRET || null;
}

export interface ChargeResult {
  ok: boolean;
  /** Provider's reference for a successful charge; stored against the enrolment. */
  reference?: string;
  /** Shown to the student verbatim when the charge fails, so it must be plain language. */
  message?: string;
  /** Where to send the student to complete payment, in gateway mode. */
  redirectUrl?: string;
}

/**
 * Attempts to take payment for a session.
 *
 * In simulated mode this succeeds immediately. In gateway mode it does **not** — settling a
 * real payment needs the provider's own redirect-and-callback dance, and pretending otherwise
 * would recreate exactly the hole this file exists to close. Wiring eSewa or Khalti means
 * implementing the branch below and returning their redirect URL; the state machine around it
 * already handles the rest.
 */
export async function chargeForSession(args: {
  sessionId: number;
  studentId: number;
  amount: number;
  method: string;
  log?: { warn: (o: object, m: string) => void };
}): Promise<ChargeResult> {
  if (paymentMode() === "simulated") {
    args.log?.warn(
      { sessionId: args.sessionId, studentId: args.studentId, amount: args.amount },
      "SIMULATED PAYMENT approved — no money moved. Configure a payment provider before launch.",
    );
    return { ok: true, reference: `SIM-${Date.now()}-${args.sessionId}-${args.studentId}` };
  }

  return {
    ok: false,
    message:
      "Online payment isn't available yet. Please contact your teacher to arrange payment for this class.",
  };
}

/**
 * Attempts to take payment for something in the monthly tier — a teacher's tier subscription
 * or a student's place in a recurring class.
 *
 * A sibling of `chargeForSession` rather than a generalisation of it, because the thing being
 * bought is genuinely different and the log line a human reads when a simulated payment goes
 * through should say which. The mode rule is identical and deliberately not re-derived here:
 * both call `paymentMode()`, so configuring a real provider disables the free door for the
 * monthly tier at exactly the same moment it disables it for ordinary classes. There is no way
 * to end up with one switched on and the other not.
 */
export async function chargeForMonthly(args: {
  purpose: "teacher-plan" | "student-place";
  /** The plan or recurring class being paid for; only for the audit trail. */
  referenceId: number;
  userId: number;
  amount: number;
  method: string;
  log?: { warn: (o: object, m: string) => void };
}): Promise<ChargeResult> {
  if (paymentMode() === "simulated") {
    args.log?.warn(
      { purpose: args.purpose, referenceId: args.referenceId, userId: args.userId, amount: args.amount },
      "SIMULATED PAYMENT approved for the monthly tier — no money moved. " +
        "Configure a payment provider before launch.",
    );
    return { ok: true, reference: `SIM-M-${Date.now()}-${args.referenceId}-${args.userId}` };
  }

  return {
    ok: false,
    message:
      args.purpose === "teacher-plan"
        ? "Online payment isn't available yet, so the monthly plan can't be bought here. Please contact Sikshya to arrange it."
        : "Online payment isn't available yet. Please contact your teacher to arrange payment for this class.",
  };
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

/** Logged once at boot so the operating mode is never a surprise. */
export function describePaymentMode(): string {
  return paymentMode() === "simulated"
    ? "PAYMENTS: SIMULATED — bookings are approved without taking money. Do not launch like this."
    : "PAYMENTS: gateway mode — only signed provider callbacks can settle a booking.";
}
