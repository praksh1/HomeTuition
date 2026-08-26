import { eq } from "drizzle-orm";
import { db, sessionMessageAttachmentsTable, sessionMessagesTable } from "@workspace/db";
import { getSessionMembership } from "./membership";
import { portalAccess } from "./portalAccess";

/**
 * May this person open a file sent in a class conversation?
 *
 * The third caller of `GET /storage/file`'s fixed list, and written for the same reason the
 * second and fourth were: that route refuses by default, so a new place that stores a file key
 * is refused until somebody writes its check. See
 * `.agents/memory/attachment-access-is-per-feature.md`.
 *
 * ### Neither rule is re-implemented here
 *
 * A class thread hangs off **either** a single class or a monthly course, and each already has
 * one place that answers "may this person be in it": `membership.ts` for a class,
 * `portalAccess.ts` for a course. Both are called rather than copied. CLAUDE.md's first rule
 * exists because those two doors once disagreed and an unenrolled student watched a lesson.
 *
 * ### Reading is not writing
 *
 * Somebody whose month has ended, or who was refunded when a teacher was suspended, may still
 * open what was sent in the class they were in. That record matters most *after* they leave,
 * because that is when there is an argument about money — the same reason the thread itself
 * stays readable to them. So this asks whether they were ever in it, not whether they are now.
 */
export async function mayOpenClassMessageFile(key: string, userId: number): Promise<boolean> {
  const rows = await db
    .select({
      sessionId: sessionMessagesTable.sessionId,
      recurringId: sessionMessagesTable.recurringId,
    })
    .from(sessionMessageAttachmentsTable)
    .innerJoin(sessionMessagesTable, eq(sessionMessagesTable.id, sessionMessageAttachmentsTable.messageId))
    .where(eq(sessionMessageAttachmentsTable.fileKey, key));

  for (const row of rows) {
    if (row.sessionId !== null) {
      const m = await getSessionMembership(row.sessionId, userId);
      // The same test the thread itself uses: the teacher, a paying student, or somebody who
      // paid and was refunded. Not the join window — a file from last week's class is still
      // theirs to open.
      if (m && (m.isSessionTeacher || m.hasPaid || m.wasRefunded)) return true;
    } else if (row.recurringId !== null) {
      const access = await portalAccess(row.recurringId, userId);
      if (access && (access.isTeacher || access.wasEverStudent)) return true;
    }
  }
  return false;
}
