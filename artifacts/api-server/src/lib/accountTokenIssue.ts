import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
/** Serialize local token signing with closure/suspension. Never hold this lock over a provider HTTP call. */
export async function issueActiveAccountToken(
  userId: number,
  role: string,
  sign: () => Promise<string | null>,
) {
  return db.transaction(async (tx) => {
    const current = await tx.execute(
      sql`SELECT role,suspended_at FROM users WHERE id=${userId} FOR SHARE`,
    );
    if (
      !current.rows[0] ||
      current.rows[0].suspended_at ||
      current.rows[0].role !== role
    )
      return null;
    return sign();
  });
}
