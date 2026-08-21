import { and, eq, sql } from "drizzle-orm";
import { db, sessionActivityTable, sessionsTable } from "@workspace/db";
import { broadcastSessionStatus } from "../ws/classroomHub";
import { isLeftOver, type LiveSessionRow } from "./sessionStaleness";
import { teacherHasGone } from "./sessionStart";

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
  const stillRunning = others.filter((row) => !expired.has(row.id));
  if (stillRunning.length === 0) return [];

  /**
   * A class whose teacher is not in it is not a class in progress.
   *
   * This is the force-close case, reported from a real session: the browser was killed, the
   * class stayed "live" with nobody in it, and the teacher could then neither start anything
   * new — "you still have an active session" — nor get back to the old one. Waiting for the
   * class's own length to run out was the only way through.
   */
  const abandoned: number[] = [];
  const running = [];
  for (const row of stillRunning) {
    const activity = await activityFor(row.id);
    if (teacherHasGone(row, activity.teacherLastSeenAt)) abandoned.push(row.id);
    else running.push(row);
  }

  if (abandoned.length > 0) {
    await db
      .update(sessionsTable)
      .set({ status: "completed" })
      .where(sql`${sessionsTable.id} = ANY(ARRAY[${sql.join(abandoned.map((id) => sql`${id}`), sql`,`)}]::int[])`);
    for (const id of abandoned) {
      await markSessionEnded(id);
      broadcastSessionStatus(String(id), "completed");
    }
  }

  return running;
}


/**
 * Note that the teacher's classroom connection is alive.
 *
 * Called when their socket opens and on its heartbeat. This is the only thing that tells a
 * lesson in progress apart from a browser that was force-quit — without it, a teacher who
 * force-closed could not start another class, and had no way back into the one still marked
 * live.
 *
 * Never throws: losing a heartbeat must not break a classroom.
 */
export async function markTeacherPresent(sessionId: number): Promise<void> {
  try {
    const now = new Date();
    await db
      .insert(sessionActivityTable)
      .values({ sessionId, teacherLastSeenAt: now })
      .onConflictDoUpdate({
        target: sessionActivityTable.sessionId,
        set: { teacherLastSeenAt: now },
      });
  } catch {
    // A class that cannot record presence still runs; it just expires on the older rule.
  }
}

/** Record when a class ended, so the restart window is measured from what happened. */
export async function markSessionEnded(sessionId: number): Promise<void> {
  try {
    const now = new Date();
    await db
      .insert(sessionActivityTable)
      .values({ sessionId, endedAt: now })
      .onConflictDoUpdate({ target: sessionActivityTable.sessionId, set: { endedAt: now } });
  } catch {
    // Falls back to the scheduled end, which is the behaviour that existed before this.
  }
}

/** What actually happened to a class, for the rules that need it. Empty when nothing has. */
export async function activityFor(sessionId: number) {
  const [row] = await db
    .select({
      teacherLastSeenAt: sessionActivityTable.teacherLastSeenAt,
      endedAt: sessionActivityTable.endedAt,
    })
    .from(sessionActivityTable)
    .where(eq(sessionActivityTable.sessionId, sessionId));
  return row ?? { teacherLastSeenAt: null, endedAt: null };
}
