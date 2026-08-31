import { execFileSync } from "node:child_process";

const PGURL = process.env.PGURL
  ?? process.env.DATABASE_URL
  ?? "postgres://postgres@127.0.0.1:55432/ht";

const sql = (statement) =>
  execFileSync("psql", [PGURL, "-v", "ON_ERROR_STOP=1", "-tAc", statement], {
    encoding: "utf8",
  }).trim();

/**
 * Make a registered teacher an explicit, paid, operator-approved integration-test fixture.
 *
 * Production registration must leave all three gates closed. Older classroom suites are about
 * boards, calls, payments, or notifications rather than onboarding, so they open the gates in
 * their throwaway database instead of weakening the application when NODE_ENV happens to be
 * `test`.
 */
export function prepareTeacherForClass(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("A valid teacher user id is required");
  sql(`
    UPDATE account_security
       SET email_verified_at = now(), updated_at = now()
     WHERE user_id = ${id};
    UPDATE teacher_profiles
       SET approval_status = 'approved', subscription_active = true
     WHERE user_id = ${id};
  `);
}
