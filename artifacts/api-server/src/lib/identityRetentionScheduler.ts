import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { ensureIdentitySchema } from "./identitySchema";
import { identityStorageReady } from "./identityFiles";
import { runIdentityRetentionJob } from "./identityRetentionJob";
import { identityRetentionJobStore as store } from "./identityRetentionJobStore";
import { sweepIdentityRetention } from "./identityRetentionStore";
import { logger } from "./logger";

const name = "private_identity_v1";

/** Separate opt-in: turning off new collection must NOT stop deletion of existing records. */
export function startIdentityRetentionScheduler(): () => void {
  if (process.env.IDENTITY_RETENTION_ENABLED !== "true") return () => {};
  let running = false; let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      if (!identityStorageReady()) throw Error("Private storage unavailable");
      const result = await runIdentityRetentionJob(store, randomUUID(), sweepIdentityRetention);
      if (result.state !== "busy") logger.info({ state: result.state, counts: result.counts }, "Identity retention batch");
    } catch { logger.error("Identity retention failed; inspect private retention health. No legal data is logged."); }
    finally {
      running = false;
      if (!stopped) { timer = setTimeout(() => void tick(), 60_000); timer.unref(); }
    }
  };
  timer = setTimeout(() => void tick(), 5_000); timer.unref();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

export async function identityRetentionHealth() {
  await ensureIdentitySchema();
  const result = await pool.query("SELECT last_attempt_at, last_success_at, last_cycle_at, failure_count FROM identity_retention_job WHERE name=$1", [name]);
  const row = result.rows[0];
  const enabled = process.env.IDENTITY_RETENTION_ENABLED === "true";
  const healthy = enabled && !!row?.last_cycle_at && Number(row.failure_count) === 0 && Date.now() - new Date(row.last_cycle_at).getTime() < 48 * 3_600_000;
  return { enabled, healthy, lastAttemptAt: row?.last_attempt_at ?? null, lastCompletedCycleAt: row?.last_cycle_at ?? null, failures: Number(row?.failure_count ?? 0) };
}
