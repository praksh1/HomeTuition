import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, testTeachingGrantsTable } from "@workspace/db";

/**
 * Temporary operator-granted permission to teach without paying.
 *
 * Read `lib/db/src/schema/testTeachingGrants.ts` first — it explains what this bypasses (payment,
 * and only payment) and why it is a table rather than a column.
 *
 * This module answers two questions and holds no policy of its own about *who* deserves a grant.
 * That judgement stays in `teachingAccess.ts`, which checks email verification and operator
 * approval before it ever asks here. Keeping it that way is the point: there is one place that
 * decides whether somebody may teach, and this is a clause inside it rather than a second door
 * beside it.
 */

/**
 * The environment kill switch. Default **off**.
 *
 * Off means no grant works, whatever the table says — so switching it off before launch closes
 * every outstanding grant at once, without having to find them. On means only explicit, unexpired,
 * unrevoked grants work; it does not by itself let anybody teach for free.
 *
 * Read on every call rather than cached at import, so flipping it takes effect on the next request
 * instead of the next deploy.
 */
export function testTeachingAllowed(): boolean {
  const raw = (process.env.ALLOW_TEST_TEACHING_ACCESS ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1";
}

export interface TestTeachingGrant {
  id: number;
  tier: string;
  reason: string;
  grantedAt: Date;
  validUntil: Date;
}

/**
 * The live grant for a teacher, or null.
 *
 * Live means not revoked and not yet expired, decided by the database's clock inside the query
 * rather than by comparing timestamps in Node. Two servers with drifting clocks would otherwise
 * disagree about whether a grant that lapsed a minute ago still counts.
 */
export async function liveTestGrant(teacherId: number): Promise<TestTeachingGrant | null> {
  if (!testTeachingAllowed()) return null;

  const [row] = await db
    .select({
      id: testTeachingGrantsTable.id,
      tier: testTeachingGrantsTable.tier,
      reason: testTeachingGrantsTable.reason,
      grantedAt: testTeachingGrantsTable.grantedAt,
      validUntil: testTeachingGrantsTable.validUntil,
    })
    .from(testTeachingGrantsTable)
    .where(
      and(
        eq(testTeachingGrantsTable.teacherId, teacherId),
        isNull(testTeachingGrantsTable.revokedAt),
        gt(testTeachingGrantsTable.validUntil, sql`now()`),
      ),
    )
    .orderBy(desc(testTeachingGrantsTable.validUntil))
    .limit(1);

  return row ?? null;
}

/** Seven days. Short on purpose: a grant nobody has to renew is a grant nobody remembers to end. */
export const DEFAULT_GRANT_DAYS = 7;

/** The longest an operator may grant in one go, so "temporary" stays temporary. */
export const MAX_GRANT_DAYS = 30;
