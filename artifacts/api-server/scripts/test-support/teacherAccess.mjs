import { execFileSync } from "node:child_process";

const PGURL = process.env.PGURL
  ?? process.env.DATABASE_URL
  ?? "postgres://postgres@127.0.0.1:55432/ht";

const sql = (statement) =>
  execFileSync("psql", [PGURL, "-v", "ON_ERROR_STOP=1", "-tAc", statement], {
    encoding: "utf8",
  }).trim();

const fixtureId = (userId) => {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("A valid fixture user id is required");
  return id;
};

const profileSql = (id, completed) => `
  INSERT INTO user_onboarding (user_id, phone, profile_photo_key, completed_at)
  VALUES (${id}, '9800000000', 'synthetic/profile-${id}.jpg', ${completed ? "now()" : "null"})
  ON CONFLICT (user_id) DO UPDATE
     SET phone = EXCLUDED.phone, profile_photo_key = EXCLUDED.profile_photo_key,
         completed_at = EXCLUDED.completed_at;
`;

/** Synthetic metadata only: no image upload, identity document or outbound phone/email call. */
export function prepareProfileForClass(userId, { completed = true } = {}) {
  sql(profileSql(fixtureId(userId), completed));
}

/** Positive booking fixtures are verified; negative email/unfinished-profile fixtures opt out. */
export function prepareReadyAccountForClass(userId) {
  const id = fixtureId(userId);
  sql(`
    UPDATE account_security SET email_verified_at=now(), updated_at=now() WHERE user_id=${id};
    ${profileSql(id, true)}
  `);
}

/**
 * Make a registered teacher an explicit, historically paid, operator-approved test fixture.
 *
 * Production registration must leave all three gates closed. Older classroom suites are about
 * boards, calls, payments, or notifications rather than onboarding, so they open the gates in
 * their throwaway database instead of weakening the application when NODE_ENV happens to be
 * `test`.
 */
export function prepareTeacherForClass(userId) {
  const id = fixtureId(userId);
  sql(`
    UPDATE account_security
       SET email_verified_at = now(), updated_at = now()
     WHERE user_id = ${id};
    UPDATE teacher_profiles
       SET approval_status = 'approved', subscription_active = true
     WHERE user_id = ${id};
    ${profileSql(id, true)}
  `);
}
