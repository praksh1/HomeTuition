import { logger } from "./logger.ts";

/**
 * Sending email.
 *
 * There was no email at all before this. The owner asked to be able to choose email for
 * important things — a message that arrives while the app is closed being the obvious one.
 *
 * This follows the same rule as payments (see lib/payments.ts): the mode follows from what is
 * in the environment rather than from a flag. Set either `BREVO_API_KEY` or `RESEND_API_KEY`,
 * plus `EMAIL_FROM`, and mail goes out; leave them unset and it does not, and the app *says so*
 * rather than showing a switch that quietly does nothing.
 *
 * Uses either provider's HTTP API rather than SMTP so there is no new dependency to install.
 * Resend remains supported for existing deployments; Brevo provides a permanent no-card free
 * tier suitable for the owner's production experiment.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

type MailProvider = "resend" | "brevo";

function configuredProvider(): MailProvider | null {
  // Preserve the existing provider if both were ever configured during a staged migration.
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.BREVO_API_KEY) return "brevo";
  return null;
}

export function isEmailConfigured(): boolean {
  return Boolean(configuredProvider() && process.env.EMAIL_FROM);
}

function senderFromEnvironment(): { email: string; name?: string } {
  const value = process.env.EMAIL_FROM!.trim();
  const named = /^(.*?)\s*<([^<>]+)>$/.exec(value);
  if (!named) return { email: value };
  const name = named[1].trim().replace(/^['"]|['"]$/g, "");
  return { email: named[2].trim(), ...(name ? { name } : {}) };
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

  const provider = configuredProvider()!;
  const isBrevo = provider === "brevo";

  try {
    const res = await fetch(isBrevo ? BREVO_ENDPOINT : RESEND_ENDPOINT, {
      method: "POST",
      headers: isBrevo
        ? { "api-key": process.env.BREVO_API_KEY!, Accept: "application/json", "Content-Type": "application/json" }
        : { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(isBrevo
        ? {
            sender: senderFromEnvironment(),
            to: [{ email: mail.to }],
            subject: mail.subject,
            textContent: mail.text,
            ...(mail.html ? { htmlContent: mail.html } : {}),
          }
        : {
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
      logger.warn({ provider, status: res.status, to: mail.to }, "email send rejected");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err, provider, to: mail.to }, "email send failed");
    return false;
  }
}
