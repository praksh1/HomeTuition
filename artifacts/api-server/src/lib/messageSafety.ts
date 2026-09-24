import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { admitsTestEnrolment } from "./testStudentAccess";

let ready: Promise<void> | undefined;
export function ensureMessageSafety(): Promise<void> {
  // Additive and fail closed: a database outage must never turn off blocking.
  return ready ??= db.execute(sql`CREATE TABLE IF NOT EXISTS message_blocks (
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id, blocked_user_id)
  )`).then(() => undefined).catch(error => { ready = undefined; throw error; });
}

type Connection = Pick<typeof db, "execute">;
export async function lockMessagePair(connection: Connection, a: number, b: number) {
  await connection.execute(sql`SELECT pg_advisory_xact_lock(${Math.min(a, b)}, ${Math.max(a, b)})`);
}

export async function messageAccess(connection: Connection, userId: number, otherId: number) {
  const people = await connection.execute(sql`SELECT id, role, suspended_at FROM users WHERE id IN (${userId}, ${otherId})`);
  const sender = people.rows.find(p => p.id === userId);
  const recipient = people.rows.find(p => p.id === otherId);
  const blocks = await connection.execute(sql`SELECT user_id FROM message_blocks
    WHERE (user_id = ${userId} AND blocked_user_id = ${otherId})
       OR (user_id = ${otherId} AND blocked_user_id = ${userId})`);
  const blockedByYou = blocks.rows.some(p => p.user_id === userId);
  let reason: string | null = null;
  if (!sender || !recipient || sender.suspended_at || recipient.suspended_at) reason = "This conversation is not available.";
  else if (blocks.rows.length) reason = blockedByYou ? "You blocked this person. Unblock to send messages." : "You cannot send messages in this conversation.";
  else if (sender.role === "student" && recipient.role === "student") {
    // Classmates only. Refunded places, cancelled classes and disabled test access do not
    // provide a relationship. Never authorize this from a caller-supplied session or user role.
    const shared = await connection.execute(sql`SELECT 1 FROM session_enrollments a
      JOIN session_enrollments b ON a.session_id = b.session_id
      JOIN sessions s ON s.id = a.session_id
      WHERE a.student_id = ${userId} AND b.student_id = ${otherId} AND s.status <> 'cancelled'
        AND a.payment_status <> 'refunded' AND b.payment_status <> 'refunded'
        AND (a.payment_status = 'paid' OR (a.payment_status = 'test' AND ${admitsTestEnrolment("test")}) OR (s.price <= 0 AND a.payment_status <> 'test'))
        AND (b.payment_status = 'paid' OR (b.payment_status = 'test' AND ${admitsTestEnrolment("test")}) OR (s.price <= 0 AND b.payment_status <> 'test')) LIMIT 1`);
    if (!shared.rows.length) reason = "Private student messages are available only between classmates with an active enrollment.";
  }
  return { canSend: reason === null, blockedByYou, reason };
}
