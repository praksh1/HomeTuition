import { pool } from "@workspace/db";
import { DEFAULT_SETTINGS } from "./policy";
import type { CostHealthSettings, CostSnapshot } from "./types";

const DDL = [
  `CREATE TABLE IF NOT EXISTS owner_cost_health (id integer PRIMARY KEY CHECK(id=1), settings jsonb NOT NULL, snapshot jsonb,
    last_attempt_at timestamptz, last_success_at timestamptz, lease_id text, lease_until timestamptz,
    last_email_at timestamptz, last_email_status text, updated_by integer REFERENCES users(id) ON DELETE SET NULL)`,
  `CREATE TABLE IF NOT EXISTS owner_cost_health_history (id bigserial PRIMARY KEY, checked_at timestamptz NOT NULL, known_spend_usd numeric)`,
  `CREATE INDEX IF NOT EXISTS owner_cost_health_history_time ON owner_cost_health_history(checked_at)`,
  `CREATE TABLE IF NOT EXISTS owner_cost_health_alerts (key text PRIMARY KEY, state text NOT NULL, attempts integer NOT NULL DEFAULT 1, attempted_at timestamptz NOT NULL, accepted_at timestamptz)`,
];
let ready: Promise<void> | undefined;
export function ensureCostHealthSchema(): Promise<void> {
  return (ready ??= (async () => {
    for (const ddl of DDL) await pool.query(ddl);
    await pool.query(
      `INSERT INTO owner_cost_health(id,settings) VALUES(1,$1) ON CONFLICT(id) DO NOTHING`,
      [JSON.stringify(DEFAULT_SETTINGS)],
    );
  })().catch((e) => {
    ready = undefined;
    throw e;
  }));
}
export async function getCostState() {
  await ensureCostHealthSchema();
  const { rows } = await pool.query(
    `SELECT settings,snapshot,last_attempt_at,last_success_at,lease_until,last_email_at,last_email_status FROM owner_cost_health WHERE id=1`,
  );
  const r = rows[0];
  return {
    settings: r.settings as CostHealthSettings,
    snapshot: r.snapshot as CostSnapshot | null,
    lastAttemptAt: r.last_attempt_at?.toISOString() ?? null,
    lastSuccessAt: r.last_success_at?.toISOString() ?? null,
    refreshing: !!r.lease_until && r.lease_until.getTime() > Date.now(),
    lastEmailAt: r.last_email_at?.toISOString() ?? null,
    lastEmailStatus: r.last_email_status as "accepted" | "failed" | null,
  };
}
export async function saveCostSettings(
  settings: CostHealthSettings,
  actorId: number,
) {
  await ensureCostHealthSchema();
  await pool.query(
    `UPDATE owner_cost_health SET settings=$1,updated_by=$2 WHERE id=1`,
    [JSON.stringify(settings), actorId],
  );
}
export async function claimCheck(
  leaseId: string,
  minIntervalMs: number,
): Promise<boolean> {
  await ensureCostHealthSchema();
  const result = await pool.query(
    `UPDATE owner_cost_health SET lease_id=$1,lease_until=now()+interval '3 minutes',last_attempt_at=now()
    WHERE id=1 AND (lease_until IS NULL OR lease_until<now()) AND (last_attempt_at IS NULL OR last_attempt_at<now()-($2 * interval '1 millisecond')) RETURNING id`,
    [leaseId, minIntervalMs],
  );
  return result.rowCount === 1;
}
export async function completeCheck(
  leaseId: string,
  snapshot: CostSnapshot,
  knownSpend: number | null,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE owner_cost_health SET snapshot=$2,last_success_at=now(),lease_id=NULL,lease_until=NULL WHERE id=1 AND lease_id=$1 RETURNING id`,
      [leaseId, JSON.stringify(snapshot)],
    );
    if (result.rowCount === 1)
      await client.query(
        `INSERT INTO owner_cost_health_history(checked_at,known_spend_usd) VALUES($1,$2)`,
        [snapshot.checkedAt, knownSpend],
      );
    await client.query(
      `DELETE FROM owner_cost_health_history WHERE checked_at<now()-interval '90 days'`,
    );
    await client.query(
      `DELETE FROM owner_cost_health_alerts WHERE attempted_at<now()-interval '90 days'`,
    );
    await client.query("COMMIT");
    return result.rowCount === 1;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function releaseCheck(leaseId: string) {
  await pool.query(
    `UPDATE owner_cost_health SET lease_id=NULL,lease_until=NULL WHERE id=1 AND lease_id=$1`,
    [leaseId],
  );
}
export async function getCostHistory() {
  const { rows } = await pool.query(
    `SELECT checked_at,known_spend_usd FROM owner_cost_health_history ORDER BY checked_at DESC LIMIT 48`,
  );
  return rows
    .reverse()
    .map((r) => ({
      checkedAt: r.checked_at.toISOString(),
      knownSpendUsd:
        r.known_spend_usd === null ? null : Number(r.known_spend_usd),
    }));
}
export async function claimAlert(key: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO owner_cost_health_alerts(key,state,attempted_at) VALUES($1,'sending',now())
    ON CONFLICT(key) DO UPDATE SET state='sending',attempted_at=now(),attempts=owner_cost_health_alerts.attempts+1
    WHERE owner_cost_health_alerts.state<>'accepted' AND owner_cost_health_alerts.attempted_at<now()-interval '30 minutes' AND owner_cost_health_alerts.attempts<3 RETURNING key`,
    [key],
  );
  return rowCount === 1;
}
export async function claimTestEmail(): Promise<boolean> {
  const { rowCount } =
    await pool.query(`INSERT INTO owner_cost_health_alerts(key,state,attempted_at) VALUES('test-email','sending',now())
    ON CONFLICT(key) DO UPDATE SET state='sending',attempted_at=now(),attempts=owner_cost_health_alerts.attempts+1
    WHERE owner_cost_health_alerts.attempted_at<now()-interval '15 minutes' RETURNING key`);
  return rowCount === 1;
}
export async function finishAlert(key: string, accepted: boolean) {
  await pool.query(
    `UPDATE owner_cost_health_alerts SET state=$2,accepted_at=CASE WHEN $3 THEN now() ELSE NULL END WHERE key=$1`,
    [key, accepted ? "accepted" : "failed", accepted],
  );
  await pool.query(
    `UPDATE owner_cost_health SET last_email_at=now(),last_email_status=$1 WHERE id=1`,
    [accepted ? "accepted" : "failed"],
  );
}
