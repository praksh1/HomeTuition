import { pool } from "@workspace/db";
import { ensureIdentitySchema } from "./identitySchema";
import type { RetentionJobStore } from "./identityRetentionJob";

const name = "private_identity_v1";
/** Shared PostgreSQL protocol, exercised by the isolated database integration suite. */
export const identityRetentionJobStore: RetentionJobStore = {
  async claim(owner) {
    await ensureIdentitySchema();
    await pool.query("INSERT INTO identity_retention_job (name) VALUES ($1) ON CONFLICT DO NOTHING", [name]);
    const result = await pool.query(`UPDATE identity_retention_job SET lease_owner=$2,
      lease_until=now()+interval '10 minutes', last_attempt_at=now()
      WHERE name=$1 AND next_run_at<=now() AND (lease_until IS NULL OR lease_until<now()) RETURNING cursor_id`, [name, owner]);
    return result.rows[0]?.cursor_id ?? null;
  },
  async finish(owner, result) {
    const updated = await pool.query(`UPDATE identity_retention_job SET cursor_id=$3,
      lease_owner=NULL, lease_until=NULL,
      next_run_at=now()+CASE WHEN $4 THEN interval '5 minutes' WHEN $5 THEN interval '24 hours' ELSE interval '1 minute' END,
      failure_count=CASE WHEN $4 THEN failure_count+1 ELSE 0 END,
      last_success_at=CASE WHEN $4 THEN last_success_at ELSE now() END,
      last_cycle_at=CASE WHEN $5 THEN now() ELSE last_cycle_at END
      WHERE name=$1 AND lease_owner=$2 AND lease_until>now()`, [name, owner, result.cursor, result.failed, result.cycleComplete]);
    return updated.rowCount === 1;
  },
};
