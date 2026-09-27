import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { RoomServiceClient } from "livekit-server-sdk";
import {
  revokeCloudParticipant,
  type RevocationResult,
} from "./video/revokeAccess";
import { videoRoomPrefix } from "./video/roomName";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const closureMediaDDL = `CREATE TABLE IF NOT EXISTS account_closure_media_jobs (
  id serial PRIMARY KEY,user_id integer NOT NULL REFERENCES users(id),session_id integer NOT NULL,
  host text NOT NULL,namespace text NOT NULL,status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token text,lease_until timestamptz,completed_at timestamptz,last_error text,
  UNIQUE(user_id,session_id,host,namespace)
)`;

/** Same transaction as closure: a successful closure cannot lose its disconnection work on restart. */
export async function enqueueClosureMedia(tx: Transaction, userId: number) {
  const sessions =
    await tx.execute(sql`SELECT s.id FROM sessions s WHERE s.teacher_id=${userId}
    OR EXISTS(SELECT 1 FROM session_enrollments e WHERE e.session_id=s.id AND e.student_id=${userId}) LIMIT 1`);
  if (!sessions.rows.length) return;
  // Native clients can still select Daily in this build. Cloud-only jobs cannot revoke those tokens.
  if (process.env.DAILY_API_KEY?.trim())
    throw Error(
      "Mixed video providers require separate access-revocation review.",
    );
  const url = process.env.LIVEKIT_URL?.trim() ?? "";
  const namespace = process.env.VIDEO_ROOM_NAMESPACE ?? "";
  let host: URL;
  try {
    host = new URL(url);
  } catch {
    throw Error("Media revocation configuration unavailable.");
  }
  if (
    host.protocol !== "wss:" ||
    !host.hostname.endsWith(".livekit.cloud") ||
    host.username ||
    host.password ||
    process.env.VIDEO_PROVIDER !== "livekit"
  )
    throw Error(
      "Cloud media revocation is required before completing closure.",
    );
  videoRoomPrefix(namespace);
  // One statement even for a long teaching history; newest room IDs enter the queue first.
  await tx.execute(sql`INSERT INTO account_closure_media_jobs(user_id,session_id,host,namespace)
    SELECT ${userId},s.id,${url},${namespace} FROM sessions s WHERE s.teacher_id=${userId}
      OR EXISTS(SELECT 1 FROM session_enrollments e WHERE e.session_id=s.id AND e.student_id=${userId})
    ORDER BY s.id DESC ON CONFLICT DO NOTHING`);
}
export type ClosureMediaJob = {
  id: number;
  user_id: number;
  session_id: number;
  host: string;
  namespace: string;
  lease_token: string;
};
export async function closureMediaReady() {
  if (
    process.env.ACCOUNT_CLOSURE_MEDIA_ENABLED !== "true" ||
    process.env.VIDEO_PROVIDER !== "livekit" ||
    process.env.DAILY_API_KEY?.trim() ||
    !process.env.LIVEKIT_API_KEY ||
    !process.env.LIVEKIT_API_SECRET
  )
    return false;
  try {
    const endpoint = new URL(process.env.LIVEKIT_URL ?? "");
    if (
      endpoint.protocol !== "wss:" ||
      !endpoint.hostname.endsWith(".livekit.cloud") ||
      endpoint.username ||
      endpoint.password
    )
      return false;
    const health =
      await db.execute(sql`SELECT 1 FROM account_closure_worker_health WHERE id=1 AND checked_at>now()-interval '30 seconds'
      AND NOT EXISTS(SELECT 1 FROM account_closure_media_jobs WHERE status='pending' AND last_error IS NOT NULL)`);
    return health.rows.length === 1;
  } catch {
    return false;
  }
}
export async function claimClosureMedia(): Promise<ClosureMediaJob | null> {
  const token = randomUUID();
  const result = await db.execute(sql`WITH candidate AS (
    SELECT j.id FROM account_closure_media_jobs j JOIN account_closure_requests r ON r.user_id=j.user_id
    JOIN users u ON u.id=j.user_id WHERE j.status='pending' AND r.status='closed' AND u.suspended_at IS NOT NULL
      AND j.next_attempt_at<=now() AND (j.lease_until IS NULL OR j.lease_until<now())
    ORDER BY j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED
  ) UPDATE account_closure_media_jobs j SET lease_token=${token},lease_until=now()+interval '30 seconds',attempts=attempts+1
    FROM candidate c WHERE j.id=c.id RETURNING j.id,j.user_id,j.session_id,j.host,j.namespace,j.lease_token`);
  return (result.rows[0] as ClosureMediaJob | undefined) ?? null;
}
export async function finishClosureMedia(
  job: ClosureMediaJob,
  result: RevocationResult,
) {
  const updated = await db.execute(sql`UPDATE account_closure_media_jobs SET
    status=${result.revoked ? "completed" : "pending"},completed_at=${result.revoked ? new Date() : null},
    last_error=${result.revoked ? null : result.reason},next_attempt_at=now()+interval '1 minute',lease_token=null,lease_until=null
    WHERE id=${job.id} AND lease_token=${job.lease_token} AND lease_until>now() RETURNING id`);
  return updated.rows.length === 1;
}
/** Host and namespace frozen at closure prevent a later environment change targeting another deployment. */
export async function disconnectClosureMedia(
  job: ClosureMediaJob,
): Promise<RevocationResult> {
  const url = process.env.LIVEKIT_URL?.trim();
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (
    url !== job.host ||
    (process.env.VIDEO_ROOM_NAMESPACE ?? "") !== job.namespace ||
    !key ||
    !secret ||
    process.env.VIDEO_PROVIDER !== "livekit"
  )
    return { revoked: false, reason: "unsupported_host" };
  const client = new RoomServiceClient(
    url.replace(/^wss:/, "https:"),
    key,
    secret,
    { requestTimeout: 8, failover: false },
  );
  return revokeCloudParticipant(
    {
      sessionId: job.session_id,
      userId: job.user_id,
      url,
      namespace: job.namespace,
    },
    client,
  );
}
/** Small, restartable worker; no unbounded loops or global database migration. Start only after schema readiness. */
export function startClosureMediaWorker(onFailure: () => void) {
  let stopped = false,
    busy = false,
    retryAfter = 0;
  const tick = async () => {
    if (stopped || busy || Date.now() < retryAfter) return;
    busy = true;
    try {
      const job = await claimClosureMedia();
      if (job) await finishClosureMedia(job, await disconnectClosureMedia(job));
      await db.execute(
        sql`INSERT INTO account_closure_worker_health(id,checked_at) VALUES(1,now()) ON CONFLICT(id) DO UPDATE SET checked_at=now()`,
      );
    } catch {
      retryAfter = Date.now() + 60000;
      onFailure();
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), 5000);
  timer.unref();
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
