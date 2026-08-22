import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db, activityLogTable, usersTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Writing down what people did, and reading it back for a support agent.
 *
 * See the table's own comment in lib/db/src/schema/activityLog.ts for what this is and is not.
 * Two properties matter here and both are about not making the app worse:
 *
 * 1. **Nothing here throws, ever.** It is called from the middle of booking a class, sending a
 *    message, and suspending an account. A log that cannot be written must lose a line, never
 *    the thing it was recording. Every function swallows its own errors.
 * 2. **Nothing here is awaited by a request handler.** Recording is fire-and-forget, so a slow
 *    or unavailable database delays nobody.
 */

export interface ActivityInput {
  /** Who did it. Omit for something the server did on its own. */
  userId?: number | null;
  /** A dotted name: `session.started`, `account.suspended`, `dispute.filed`. */
  action: string;
  subjectType?: string | null;
  subjectId?: number | null;
  /** Anything else worth keeping. Never secrets — an agent reads this. */
  detail?: Record<string, unknown> | null;
  ip?: string | null;
}

/** Appends one line. Returns immediately; the write happens after the response is sent. */
export function recordActivity(input: ActivityInput): void {
  void (async () => {
    try {
      await db.insert(activityLogTable).values({
        userId: input.userId ?? null,
        action: input.action,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        detail: input.detail ?? null,
        ip: input.ip ?? null,
      });
    } catch (err) {
      // A missing table, a database asleep. The app carries on; the line is lost.
      logger.warn({ err, action: input.action }, "activity not recorded");
    }
  })();
}

export interface ActivityQuery {
  /** Everything one person did. */
  userId?: number;
  /** Everything that happened to one thing. */
  subjectType?: string;
  subjectId?: number;
  /** Only this action. */
  action?: string;
  /** Paging: return entries older than this id. */
  before?: number;
  limit?: number;
}

export interface ActivityRow {
  id: number;
  userId: number | null;
  userName: string | null;
  action: string;
  subjectType: string | null;
  subjectId: number | null;
  detail: unknown;
  ip: string | null;
  createdAt: Date;
}

/**
 * Reads the log back, newest first.
 *
 * `known: false` means the log could not be read, which an agent must be able to tell from "no
 * activity" — the same distinction the attendance register draws, and for the same reason: a
 * lookup that failed decides nothing, and an empty screen labelled "nothing happened" is a lie
 * a support decision could rest on.
 */
export async function readActivity(
  query: ActivityQuery = {},
): Promise<{ known: boolean; rows: ActivityRow[] }> {
  const limit = Math.min(200, Math.max(1, query.limit ?? 100));
  try {
    const conditions = [];
    if (query.userId !== undefined) conditions.push(eq(activityLogTable.userId, query.userId));
    if (query.subjectType !== undefined) conditions.push(eq(activityLogTable.subjectType, query.subjectType));
    if (query.subjectId !== undefined) conditions.push(eq(activityLogTable.subjectId, query.subjectId));
    if (query.action !== undefined) conditions.push(eq(activityLogTable.action, query.action));
    if (query.before !== undefined) conditions.push(lt(activityLogTable.id, query.before));

    const rows = await db
      .select({
        id: activityLogTable.id,
        userId: activityLogTable.userId,
        userName: usersTable.name,
        action: activityLogTable.action,
        subjectType: activityLogTable.subjectType,
        subjectId: activityLogTable.subjectId,
        detail: activityLogTable.detail,
        ip: activityLogTable.ip,
        createdAt: activityLogTable.createdAt,
      })
      .from(activityLogTable)
      // Left join: an entry with no person behind it, or whose account has since been deleted,
      // is still an event that happened and must not vanish from the log.
      .leftJoin(usersTable, eq(usersTable.id, activityLogTable.userId))
      .where(conditions.length ? and(...conditions) : sql`true`)
      .orderBy(desc(activityLogTable.id))
      .limit(limit);

    return { known: true, rows };
  } catch (err) {
    logger.warn({ err }, "could not read the activity log");
    return { known: false, rows: [] };
  }
}
