import { logger } from "./logger";

/**
 * Sending email.
 *
 * There was no email at all before this. The owner asked to be able to choose email for
 * important things — a message that arrives while the app is closed being the obvious one.
 *
 * This follows the same rule as payments (see lib/payments.ts): the mode follows from what is
 * in the environment rather than from a flag. Set `RESEND_API_KEY` and `EMAIL_FROM` and mail
 * goes out; leave them unset and it does not, and the app *says so* rather than showing a
 * switch that quietly does nothing.
 *
 * Uses Resend's HTTP API rather than SMTP so there is no new dependency to install and nothing
 * to configure beyond two environment variables. Any provider with a send-one-email endpoint
 * would drop in here.
 */

const ENDPOINT = "https://api.resend.com/emails";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  /** Plain text is always present, including for clients that suppress HTML. */
  text: string;
  /** Optional, intentionally simple HTML. Never the only version of an important message. */
  html?: string;
}

/**
 * Sends one email, or does nothing if email is not configured.
 *
 * Never throws. A notification failing must not fail the thing it was notifying about — a
 * message must still be delivered when the mail provider is down.
 */
export async function sendEmail(mail: OutgoingEmail): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        ...(mail.html ? { html: mail.html } : {}),
      }),
      // A slow mail provider must not hold a request open. The caller does not wait on us
      // anyway, but an unbounded fetch would still pin a socket.
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      logger.warn({ status: res.status, to: mail.to }, "email send rejected");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err, to: mail.to }, "email send failed");
    return false;
  }
}
