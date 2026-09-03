/**
 * What Sikshya may truthfully say about a verification email.
 *
 * The check-email screen defaulted to **"We sent a verification link."** whenever it lacked
 * parameters, and it arrives without parameters more often than with them: `AuthGuard` redirects an
 * unverified user there with none at all, and the login screen passes only an address. So a server
 * with no mail provider configured — which sends nothing and says so in its response — produced a
 * screen telling the person to go and look in an inbox that would never receive anything.
 *
 * Four states, kept apart because they need different things from the reader:
 *
 *  - **unknown** — nobody told this screen anything. It must not guess, and "we sent" is a guess.
 *  - **unconfigured** — the server has no mail provider. Nothing was sent and nothing will be until
 *    support finishes setup; retrying is pointless but harmless.
 *  - **failed** — mail *is* configured and the send did not go through. Retrying is worth doing.
 *    This was previously collapsed into "unconfigured", which sent people to support over a blip.
 *  - **sent** — the message was handed to the provider.
 *
 * Note what "sent" does and does not claim. Submission is not delivery: a provider can accept a
 * message and then bounce it, or a free-tier sender can land in spam. So the wording says the link
 * was sent and that it may not arrive, rather than promising an inbox.
 *
 * Pure and import-free so every branch is unit-testable without rendering a screen or running a
 * server. The screen maps `tone` to design tokens; no colour is decided here.
 */

/** `useLocalSearchParams` hands back a string, an array, or nothing. */
export type RouteParam = string | string[] | undefined;

export type VerificationTone = "sent" | "unknown" | "unconfigured" | "failed" | "verified";

export interface VerificationNotice {
  tone: VerificationTone;
  text: string;
}

/** First value of a route parameter, or undefined. Repeated params arrive as an array. */
function one(value: RouteParam): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.length > 0 ? first : undefined;
}

/**
 * A tri-state read of a "1"/"0" flag.
 *
 * Anything that is not exactly "1" or "0" is `undefined` rather than false. A malformed parameter
 * is missing information, not a negative answer, and treating it as one is how a screen ends up
 * making a confident claim from nothing.
 */
function flag(value: RouteParam): boolean | undefined {
  const raw = one(value);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return undefined;
}

/** What the screen should say when it first opens, from whatever the route carried. */
export function noticeFromParams(sent: RouteParam, configured: RouteParam): VerificationNotice {
  const wasSent = flag(sent);
  const isConfigured = flag(configured);

  // Order matters. "Not configured" explains *why* nothing was sent, so it outranks the send flag.
  if (isConfigured === false) {
    return {
      tone: "unconfigured",
      text:
        "Email delivery is not set up on this server yet, so no link could be sent. Your account " +
        "is saved. Sikshya support has to finish email setup before a link can reach you.",
    };
  }

  if (wasSent === true) {
    return {
      tone: "sent",
      text:
        "A verification link has been sent to this address and is valid for 24 hours. Delivery can " +
        "take a few minutes and is not guaranteed — if it has not arrived, check spam or junk, or " +
        "send another link.",
    };
  }

  // Configured, and the send did not go through. Different from "not configured", and previously
  // shown as it: a person was told to contact support when trying again would have worked.
  if (wasSent === false) {
    return {
      tone: "failed",
      text:
        "Your account is saved, but the verification email could not be sent just now. Try Send " +
        "another link. If it keeps failing, contact Sikshya support.",
    };
  }

  /*
    Worded to avoid the phrase "has been sent" even inside a negation.

    The first draft said "we cannot confirm whether a verification email has already been sent to
    this address". True, and still wrong for this screen: somebody scanning a paragraph takes the
    verb, not the qualifier, and the whole point here is that a person in a hurry must not come
    away believing an email is on its way.
  */
  return {
    tone: "unknown",
    text:
      "Your account is saved. Sikshya cannot confirm that a verification email went out to this " +
      "address. Use Send another link to request one now.",
  };
}

/**
 * What the screen should say after a resend that the server accepted.
 *
 * `POST /auth/verification/resend` answers `{ verified: true, sent: false }` with **status 200**
 * when the address is already verified — a success status for a request that deliberately sent
 * nothing. The screen treated any 200 as proof and announced "A new verification link has been
 * sent", which was false in exactly the case the server was being careful about.
 */
export function noticeFromResend(body: unknown): VerificationNotice {
  const result = (body ?? {}) as { verified?: unknown; sent?: unknown };

  if (result.verified === true) {
    return {
      tone: "verified",
      text:
        "This email address is already verified, so no new link was sent. You can continue to your " +
        "account.",
    };
  }

  if (result.sent === true) {
    return {
      tone: "sent",
      text:
        "A new verification link has been sent. Delivery can take a few minutes — check spam or " +
        "junk if it does not arrive.",
    };
  }

  // A 200 that reports neither. The route does not currently produce this, but a screen that
  // assumes a shape it did not check is how the original defect happened.
  return {
    tone: "failed",
    text:
      "The server accepted the request but did not confirm that an email was sent. Try again, and " +
      "contact Sikshya support if this continues.",
  };
}

/** What to say when the resend request itself failed. Prefers the server's own explanation. */
export function noticeFromResendError(error: unknown): VerificationNotice {
  const message = error instanceof Error ? error.message.trim() : "";
  return {
    tone: "failed",
    text: message.length > 0 ? message : "The email could not be sent. Please try again.",
  };
}
