import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { recordIdentityAccountClosure } from "./identityAccountClosure";
import { ensureIdentitySchema } from "./identitySchema";
import { mayCompleteClosure, type ClosureCommitments } from "./accountClosurePolicy";
import { readAccountClosureCommitments } from "./accountClosureCommitments";
import { closureMediaDDL, enqueueClosureMedia } from "./accountClosureMedia";
import { installAccountClosureGuards } from "./accountClosureGuards";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ClosureCommitmentReader = (tx: Transaction, userId: number) => Promise<ClosureCommitments>;

const DDL = [
  closureMediaDDL,
  `CREATE TABLE IF NOT EXISTS account_closure_worker_health (id integer PRIMARY KEY CHECK(id=1),checked_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS account_closure_requests (
    user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
    status text NOT NULL CHECK(status IN ('requested','cancelled','closed')),
    version integer NOT NULL DEFAULT 0, requested_at timestamptz NOT NULL,
    cancelled_at timestamptz, closed_at timestamptz,
    reviewed_by integer REFERENCES users(id) ON DELETE RESTRICT
  )`,
  `CREATE TABLE IF NOT EXISTS account_closure_events (
    id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    actor_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action text NOT NULL, at timestamptz NOT NULL DEFAULT now()
  )`,
];
let ready: Promise<void> | undefined;
export function ensureAccountClosureSchema() {
  return ready ??= (async()=>{ for (const statement of DDL) await db.execute(sql.raw(statement)); await installAccountClosureGuards(); })()
    .catch(error=>{ready=undefined;throw error;});
}

/** Only for administrative recovery paths. Never treats a plain suspension as closure.
 * The presence check lets older deployments without this additive feature keep working.
 */
export async function accountClosureCompleted(userId: number, source: Pick<typeof db,"execute"> = db): Promise<boolean> {
  const exists = await source.execute(sql`SELECT to_regclass('account_closure_requests') AS table_name`);
  if (!exists.rows[0]?.table_name) return false;
  const result = await source.execute(sql`SELECT 1 FROM account_closure_requests WHERE user_id=${userId} AND status='closed'`);
  return result.rows.length > 0;
}

/** Requesting/cancelling closure leaves classes, sign-in, money and retention dates untouched. */
export async function requestAccountClosure(userId: number) {
  await ensureAccountClosureSchema();
  return db.transaction(async tx=>{
    const account=await tx.execute(sql`SELECT role,suspended_at FROM users WHERE id=${userId} FOR UPDATE`);
    if (!account.rows[0] || !['teacher','student'].includes(String(account.rows[0].role)) || account.rows[0].suspended_at)
      throw Error('This account cannot request closure here.');
    const existing=await tx.execute(sql`SELECT status,version FROM account_closure_requests WHERE user_id=${userId} FOR UPDATE`);
    if (existing.rows[0]?.status==='closed') throw Error('Account already closed.');
    if (existing.rows[0]?.status==='requested') return existing.rows[0];
    const result=await tx.execute(sql`INSERT INTO account_closure_requests(user_id,status,requested_at)
      VALUES(${userId},'requested',now()) ON CONFLICT(user_id) DO UPDATE SET
      status='requested',requested_at=now(),cancelled_at=null,version=account_closure_requests.version+1
      RETURNING status,version`);
    await tx.execute(sql`INSERT INTO account_closure_events(user_id,actor_id,action) VALUES(${userId},${userId},'requested')`);
    return result.rows[0];
  });
}

export async function cancelAccountClosure(userId: number, version: number) {
  await ensureAccountClosureSchema();
  return db.transaction(async tx=>{
    await tx.execute(sql`SELECT id FROM users WHERE id=${userId} FOR UPDATE`);
    const result=await tx.execute(sql`UPDATE account_closure_requests SET status='cancelled',cancelled_at=now(),version=version+1
      WHERE user_id=${userId} AND status='requested' AND version=${version} RETURNING status,version`);
    if (!result.rows.length) return false;
    await tx.execute(sql`INSERT INTO account_closure_events(user_id,actor_id,action) VALUES(${userId},${userId},'cancelled')`);
    return true;
  });
}

/** Internal completion service, deliberately NOT exposed as a route until the obligation reader
 * covers every active commerce source and provider revocation is integrated. Never accept a
 * browser-supplied "all clear" object: evidence must be read from the DB under this transaction.
 */
export async function completeAccountClosure(input: {userId:number;operatorId:number;version:number;confirmed:boolean},
  readCommitments: ClosureCommitmentReader = readAccountClosureCommitments) {
  await ensureAccountClosureSchema(); await ensureIdentitySchema();
  return db.transaction(async tx=>{
    // Canonical user lock serializes request/cancel/complete with private identity preparation.
    const account=await tx.execute(sql`SELECT role FROM users WHERE id=${input.userId} FOR UPDATE`);
    if (!account.rows[0] || !['teacher','student'].includes(String(account.rows[0].role))) throw Error('Invalid closure account.');
    const operator=await tx.execute(sql`SELECT u.id FROM users u JOIN operator_accounts o ON o.user_id=u.id
      WHERE u.id=${input.operatorId} AND u.role='admin' AND u.suspended_at IS NULL
      AND o.disabled_at IS NULL AND o.must_change_password=false FOR SHARE OF u,o`);
    if (!operator.rows.length || input.operatorId===input.userId) throw Error('Independent operator review required.');
    const request=await tx.execute(sql`SELECT status,version,closed_at FROM account_closure_requests WHERE user_id=${input.userId} FOR UPDATE`);
    const row=request.rows[0];
    if (!row) return {closed:false,blockers:['request_missing']};
    if(row.status==='closed') return {closed:true,closedAt:row.closed_at};
    const verdict=mayCompleteClosure({status:String(row.status),version:Number(row.version),expectedVersion:input.version,
      requestedBy:input.userId,reviewedBy:input.operatorId,confirmed:input.confirmed,
      commitments:await readCommitments(tx,input.userId)});
    if(!verdict.allowed) return {closed:false,blockers:verdict.blockers};
    const closedAt=new Date();
    await enqueueClosureMedia(tx,input.userId);
    await recordIdentityAccountClosure(tx,input.userId,closedAt);
    await tx.execute(sql`UPDATE users SET suspended_at=${closedAt},suspended_reason='Account closed at your request.',suspended_by=${input.operatorId} WHERE id=${input.userId}`);
    await tx.execute(sql`UPDATE account_tokens SET used_at=${closedAt} WHERE user_id=${input.userId} AND used_at IS NULL`);
    await tx.execute(sql`UPDATE password_resets SET used_at=${closedAt} WHERE user_id=${input.userId} AND used_at IS NULL`);
    await tx.execute(sql`UPDATE account_closure_requests SET status='closed',closed_at=${closedAt},reviewed_by=${input.operatorId},version=version+1 WHERE user_id=${input.userId}`);
    await tx.execute(sql`INSERT INTO account_closure_events(user_id,actor_id,action) VALUES(${input.userId},${input.operatorId},'closed')`);
    return {closed:true,closedAt};
  });
}
