import { execFileSync } from "node:child_process";

const PGURL = process.env.PGURL
  ?? process.env.DATABASE_URL
  ?? "postgres://postgres@127.0.0.1:55432/ht";

const sql = (statement) =>
  execFileSync("psql", [PGURL, "-v", "ON_ERROR_STOP=1", "-tAc", statement], {
    encoding: "utf8",
  }).trim();

/**
 * Open only the account gates that an unrelated real-browser test is not exercising.
 *
 * Registration must leave email verification and onboarding incomplete in production. The
 * navigation, notifications, calendar, refund, and upload suites need an account that can
 * reach the screen they are actually testing, so their disposable database marks those two
 * steps complete explicitly. Teacher approval and payment stay separate: suites that need
 * them must opt into those states themselves so a plan-purchase test cannot pass by accident.
 */
export function prepareBrowserAccount(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("A valid user id is required");
  sql(`
    UPDATE account_security
       SET email_verified_at = now(), updated_at = now()
     WHERE user_id = ${id};
    UPDATE user_onboarding
       SET completed_at = now(), updated_at = now()
     WHERE user_id = ${id};
  `);
}
