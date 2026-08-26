import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db, sessionParticipationTable, sessionsTable } from "@workspace/db";
import { monthWindow } from "./videoCost";

// Re-exported so a caller needs one import, not two.
export { costAt, egressGbAt, monthWindow } from "./videoCost";

/**
 * What the video actually costs, counted in the unit providers bill in.
 *
 * Every SFU vendor prices per **participant-minute**: one person in one call for one minute.
 * Daily bills that way, so does LiveKit Cloud, so does everyone else. Self-hosting swaps that
 * for bandwidth, which is a different unit but the same driver — this number is what both are
 * computed from.
 *
 * ### It costs nothing to collect, because it is already collected
 *
 * `session_participation.present_ms` has been written on every classroom socket disconnect
 * since the attendance work: who was in which class, and for how long. That was built to answer
 * "who actually turned up" for refunds. It answers this too, and no new table, no new writes and
 * no client change are needed for it.
 *
 * ### What it is a proxy for, honestly
 *
 * Time on the **classroom socket**, not time in the video room. Somebody with the app open and
 * their camera off still counts. So this is an upper bound: real video minutes are this or
 * fewer. That is the right direction to be wrong in when the number is being used to decide
 * whether a provider is affordable — better to over-estimate the bill than under-estimate it.
 *
 * Getting the true figure would mean trusting the client to report its own video minutes, and a
 * client that crashes mid-lesson reports nothing at all. This is a number the server owns.
 */

export interface UsageWindow {
  /** Inclusive. */
  from: Date;
  /** Exclusive. */
  to: Date;
}

export interface UsageTotals {
  from: string;
  to: string;
  /** Classes that had at least one person in them. */
  sessions: number;
  /** Distinct people across those classes. */
  people: number;
  /**
   * The billable unit. One person in one class for one minute.
   *
   * Rounded to whole minutes at the end rather than per row: rounding 200 people up individually
   * invents hours that nobody sat through.
   */
  participantMinutes: number;
  /** The longest single presence, as a sanity check on the number above. */
  longestPresenceMinutes: number;
}

/**
 * Add up a window's participant-minutes.
 *
 * Joined to `sessions` on the class's scheduled date, so a month means the classes held that
 * month rather than the rows written that month — a class that ran past midnight belongs to the
 * day it started.
 */
export async function usageIn(window: UsageWindow): Promise<UsageTotals> {
  const [row] = await db
    .select({
      sessions: sql<number>`count(distinct ${sessionParticipationTable.sessionId})::int`,
      people: sql<number>`count(distinct ${sessionParticipationTable.userId})::int`,
      totalMs: sql<number>`coalesce(sum(${sessionParticipationTable.presentMs}), 0)::bigint`,
      longestMs: sql<number>`coalesce(max(${sessionParticipationTable.presentMs}), 0)::bigint`,
    })
    .from(sessionParticipationTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, sessionParticipationTable.sessionId))
    .where(and(gte(sessionsTable.date, window.from), lt(sessionsTable.date, window.to)));

  return {
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    sessions: row?.sessions ?? 0,
    people: row?.people ?? 0,
    participantMinutes: Math.round(Number(row?.totalMs ?? 0) / 60_000),
    longestPresenceMinutes: Math.round(Number(row?.longestMs ?? 0) / 60_000),
  };
}
