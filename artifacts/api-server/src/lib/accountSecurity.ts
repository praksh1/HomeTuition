import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import {
  accountSecurityTable,
  accountTokensTable,
  db,
  externalIdentitiesTable,
  usersTable,
} from "@workspace/db";

import { sendEmail } from "./mailer";

export const EMAIL_VERIFY_HOURS = 24;
export const PASSWORD_RESET_MINUTES = 30;
const RESEND_AFTER_MS = 60_000;

type TokenPurpose = "verify_email" | "reset_password";

export function hashAccountToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function appOrigin(): string {
  return (process.env.PUBLIC_APP_URL ?? "https://hometuition.praksh-dhakal.workers.dev").replace(/\/+$/, "");
}

function safeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Accounts created before verification existed have no row and are grandfathered as verified.
 * New registrations always create the row in the same transaction as the user.
 */
export async function emailVerifiedFor(userId: number): Promise<boolean> {
  const [state] = await db
    .select({ verifiedAt: accountSecurityTable.emailVerifiedAt })
    .from(accountSecurityTable)
    .where(eq(accountSecurityTable.userId, userId))
    .limit(1);
  return state ? state.verifiedAt !== null : true;
}

export async function passwordAuthFor(userId: number): Promise<boolean> {
  const [state] = await db
    .select({ enabled: accountSecurityTable.passwordAuthEnabled })
    .from(accountSecurityTable)
    .where(eq(accountSecurityTable.userId, userId))
    .limit(1);
  return state?.enabled ?? true;
}

async function mayIssue(userId: number, purpose: TokenPurpose): Promise<boolean> {
  const [recent] = await db
    .select({ createdAt: accountTokensTable.createdAt })
    .from(accountTokensTable)
    .where(
      and(
        eq(accountTokensTable.userId, userId),
        eq(accountTokensTable.purpose, purpose),
        isNull(accountTokensTable.usedAt),
        gte(accountTokensTable.createdAt, new Date(Date.now() - RESEND_AFTER_MS)),
      ),
    )
    .orderBy(desc(accountTokensTable.id))
    .limit(1);
  return !recent;
}

async function issueToken(userId: number, purpose: TokenPurpose, lifetimeMs: number): Promise<string | null> {
  if (!(await mayIssue(userId, purpose))) return null;
  const token = randomBytes(32).toString("hex");
  await db.transaction(async (tx) => {
    await tx
      .update(accountTokensTable)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(accountTokensTable.userId, userId),
          eq(accountTokensTable.purpose, purpose),
          isNull(accountTokensTable.usedAt),
        ),
      );
    await tx.insert(accountTokensTable).values({
      userId,
      purpose,
      tokenHash: hashAccountToken(token),
      expiresAt: new Date(Date.now() + lifetimeMs),
    });
  });
  return token;
}

function buttonHtml(label: string, url: string, explanation: string): string {
  const escaped = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">` +
    `<p>${explanation}</p>` +
    `<p><a href="${escaped}" style="display:inline-block;padding:12px 18px;background:#123C8C;color:white;text-decoration:none;border-radius:8px">${label}</a></p>` +
    `<p style="font-size:12px;color:#6b7280">If the button does not open, copy this address:<br>${escaped}</p>` +
    `</div>`;
}

export async function sendVerificationEmail(user: { id: number; email: string; name: string }): Promise<{
  sent: boolean;
  rateLimited: boolean;
}> {
  if (await emailVerifiedFor(user.id)) return { sent: true, rateLimited: false };
  const token = await issueToken(user.id, "verify_email", EMAIL_VERIFY_HOURS * 60 * 60_000);
  if (!token) return { sent: false, rateLimited: true };
  const url = `${appOrigin()}/verify-email?token=${encodeURIComponent(token)}`;
  const sent = await sendEmail({
    to: safeEmail(user.email),
    subject: "Verify your Sikshya email",
    text:
      `Hello ${user.name},\n\nOpen this link to verify your Sikshya email address:\n${url}\n\n` +
      `The link expires in ${EMAIL_VERIFY_HOURS} hours. If you did not create this account, ignore this message.`,
    html: buttonHtml(
      "Verify email",
      url,
      `Hello ${user.name}. Verify your email before your Sikshya account can teach or book classes.`,
    ),
  });
  return { sent, rateLimited: false };
}

export async function consumeVerificationToken(token: string): Promise<number | null> {
  const hash = hashAccountToken(token);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: accountTokensTable.id, userId: accountTokensTable.userId })
      .from(accountTokensTable)
      .where(
        and(
          eq(accountTokensTable.tokenHash, hash),
          eq(accountTokensTable.purpose, "verify_email"),
          isNull(accountTokensTable.usedAt),
          gte(accountTokensTable.expiresAt, new Date()),
        ),
      )
      .limit(1)
      .for("update");
    if (!row) return null;
    await tx.update(accountTokensTable).set({ usedAt: new Date() }).where(eq(accountTokensTable.id, row.id));
    await tx
      .update(accountSecurityTable)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(accountSecurityTable.userId, row.userId));
    return row.userId;
  });
}

export async function requestPasswordReset(email: string): Promise<void> {
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.email, safeEmail(email)))
    .limit(1);
  if (!user || !(await passwordAuthFor(user.id))) return;

  const token = await issueToken(user.id, "reset_password", PASSWORD_RESET_MINUTES * 60_000);
  if (!token) return;
  const url = `${appOrigin()}/reset-password?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: user.email,
    subject: "Reset your Sikshya password",
    text:
      `Hello ${user.name},\n\nOpen this link to choose a new Sikshya password:\n${url}\n\n` +
      `The link expires in ${PASSWORD_RESET_MINUTES} minutes. If you did not request this, ignore this message.`,
    html: buttonHtml(
      "Choose a new password",
      url,
      `Hello ${user.name}. A password reset was requested for your Sikshya account.`,
    ),
  });
}

export async function consumePasswordReset(token: string, passwordHash: string): Promise<boolean> {
  const hash = hashAccountToken(token);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: accountTokensTable.id, userId: accountTokensTable.userId })
      .from(accountTokensTable)
      .where(
        and(
          eq(accountTokensTable.tokenHash, hash),
          eq(accountTokensTable.purpose, "reset_password"),
          isNull(accountTokensTable.usedAt),
          gte(accountTokensTable.expiresAt, new Date()),
        ),
      )
      .limit(1)
      .for("update");
    if (!row) return false;
    await tx.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, row.userId));
    await tx
      .update(accountTokensTable)
      .set({ usedAt: new Date() })
      .where(and(eq(accountTokensTable.userId, row.userId), isNull(accountTokensTable.usedAt)));
    return true;
  });
}

export async function externalProvidersFor(userId: number): Promise<string[]> {
  const rows = await db
    .select({ provider: externalIdentitiesTable.provider })
    .from(externalIdentitiesTable)
    .where(eq(externalIdentitiesTable.userId, userId));
  return rows.map((row) => row.provider);
}
