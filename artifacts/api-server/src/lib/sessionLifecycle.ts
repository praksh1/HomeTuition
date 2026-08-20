import { and, eq, sql } from "drizzle-orm";
import { db, sessionsTable } from "@workspace/db";
import { broadcastSessionStatus } from "../ws/classroomHub";
import { isLeftOver, type LiveSessionRow } from "./sessionStaleness";

export { isLeftOver, type LiveSessionRow } from "./sessionStaleness";

/**
 * When a live class is over, and what happens to a teacher's other classes.
 *
 * This lived in two places and the two disagreed, which is how a teacher ended up able to run
 * three classes at once while their students were told the first had ended. It lives here now,
 * for the same reason access control lives in `membership.ts`: a rule about who is in a class
 * that is written twice will eventually be written differently twice.
 */

/**
 * Closes classes that are only nominally live — a browser that crashed, seed data, a teacher
 * who closed the tab — and tells anyone still in the room.
 *
 * Returns the ids it closed, so a caller can tell "nothing was running" from "something was
 * running and is now tidied up".
 */
export async function expireLeftOverSessions(rows: LiveSessionRow[]): Promise<number[]> {
  const staleIds = rows.filter((row) => isLeftOver(row)).map((row) => row.id);
  if (staleIds.length === 0) return [];

  await db
    .update(sessionsTable)
    .set({ status: "completed" })
    .where(sql`${sessionsTable.id} = ANY(ARRAY[${sql.join(staleIds.map((id) => sql`${id}`), sql`,`)}]::int[])`);

  for (const id of staleIds) broadcastSessionStatus(String(id), "completed");
  return staleIds;
}

/**
 * The teacher's other classes that are genuinely still running, after tidying up the left-over
 * ones. A non-empty result is a reason to refuse a new class, not to end the old one.
 *
 * Ending it silently is what used to happen, and it is the wrong trade every time: a teacher
 * opening a second window is far more likely to have made a mistake than to have intended to
 * throw a room full of students out of a lesson in progress.
 */
export async function otherRunningSessions(teacherId: number, exceptId: number) {
  const others = await db
    .select({
      id: sessionsTable.id,
      topic: sessionsTable.topic,
      date: sessionsTable.date,
      startedAt: sessionsTable.startedAt,
      duration: sessionsTable.duration,
    })
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.teacherId, teacherId),
        eq(sessionsTable.status, "live"),
        sql`${sessionsTable.id} != ${exceptId}`,
      ),
    );

  const expired = new Set(await expireLeftOverSessions(others));
  return others.filter((row) => !expired.has(row.id));
}
