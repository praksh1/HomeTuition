import assert from "node:assert/strict";
import { pool } from "./database";
import { ensureIdentitySchema } from "../../src/lib/identitySchema";
import { retainIdentityRecord } from "../../src/lib/identityRetentionStore";
import { identityRetentionJobStore as jobs } from "../../src/lib/identityRetentionJobStore";
import { runIdentityRetentionJob } from "../../src/lib/identityRetentionJob";
import { deleted, failures } from "./storage";
import { runHttpChecks } from "./httpChecks";
import { db } from "./database";
import { recordIdentityAccountClosure } from "../../src/lib/identityAccountClosure";
import { runClosureChecks } from "./closureChecks";

let passed = 0;
async function test(name: string, fn: () => Promise<void>) { await fn(); passed++; console.log(`PASS ${name}`); }
async function record(extra = "", args: unknown[] = []) {
  const result = await pool.query(`INSERT INTO identity_verifications
    (user_id,holder,status,policy_version,details_ciphertext,encryption_key_version,file_key,consent_at,reviewed_at)
    VALUES (1,'self','approved','synthetic','opaque-test-content','v1','synthetic-key-'||nextval('identity_verifications_id_seq'),now(),now()-interval '91 days') RETURNING id`);
  const id = result.rows[0].id;
  if (extra) await pool.query(`UPDATE identity_verifications SET ${extra} WHERE id=$1`, [id,...args]);
  return id;
}
async function row(id: number) { return (await pool.query("SELECT * FROM identity_verifications WHERE id=$1",[id])).rows[0]; }
try {
  await test("additive DDL is repeatable inside isolated schema", async () => {
    await ensureIdentitySchema(); await ensureIdentitySchema();
    assert.equal((await pool.query("SELECT current_schema() AS name")).rows[0].name, process.env.IDENTITY_TEST_SCHEMA);
  });
  await test("approved document expires but reference details remain", async () => {
    const id = await record(); const before = await row(id);
    assert.equal(await retainIdentityRecord(id), "delete_file");
    const after = await row(id); assert.equal(after.file_key,null); assert.ok(after.file_deleted_at);
    assert.equal(after.details_ciphertext,"opaque-test-content"); assert.equal(deleted.get(before.file_key),1);
  });
  await test("storage failure cannot commit a deletion receipt", async () => {
    const id = await record(); const before = await row(id); failures.add(before.file_key);
    await assert.rejects(retainIdentityRecord(id)); const after = await row(id);
    assert.equal(after.file_key,before.file_key); assert.equal(after.file_deleted_at,null);
    failures.delete(before.file_key); await retainIdentityRecord(id);
    assert.ok((await row(id)).file_deleted_at);
  });
  await test("overdue preservation holds keep data and deduplicate review events", async () => {
    const id = await record("hold_started_at=now()-interval '100 days',hold_reviewed_at=now()-interval '100 days'");
    assert.equal(await retainIdentityRecord(id),"review_hold"); await retainIdentityRecord(id);
    const kept=await row(id); assert.ok(kept.file_key); assert.equal(kept.file_deleted_at,null);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM identity_access_events WHERE verification_id=$1 AND action='hold_review_requested'",[id])).rows[0].n,1);
  });
  await test("closure deadline purges private reference details", async () => {
    const id=await record("account_closed_at=now()-interval '2 years'"); await retainIdentityRecord(id);
    const after=await row(id); assert.equal(after.details_ciphertext,null); assert.ok(after.details_deleted_at);
  });
  await test("concurrent retention workers delete a record only once", async () => {
    const id=await record(); const before=await row(id);
    await Promise.all([retainIdentityRecord(id),retainIdentityRecord(id)]);
    assert.equal(deleted.get(before.file_key),1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM identity_access_events WHERE verification_id=$1 AND action='document_deleted'",[id])).rows[0].n,1);
  });
  await test("shared reader lock blocks cleanup until sensitive read completes", async () => {
    const id=await record(); const before=await row(id); const reader=await pool.connect();
    let work: Promise<string> | undefined;
    try {
      await reader.query("BEGIN"); await reader.query("SELECT id FROM identity_verifications WHERE id=$1 FOR SHARE",[id]);
      work=retainIdentityRecord(id); let blocked=false;
      for(let n=0;n<30;n++) {
        const locks=await pool.query("SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%identity_verifications%' LIMIT 1");
        if(locks.rowCount) { blocked=true; break; }
        await new Promise(r=>setTimeout(r,50));
      }
      assert.ok(blocked,"cleanup must be waiting for the row lock"); assert.equal(deleted.has(before.file_key),false);
    } finally { await reader.query("ROLLBACK"); reader.release(); if(work) await work; }
    assert.equal(deleted.get(before.file_key),1);
  });
  await test("audit failure rolls back receipt; subsequent storage retry succeeds", async () => {
    const id=await record(); const before=await row(id);
    await pool.query(`CREATE FUNCTION fail_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.verification_id=${id} THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await pool.query("CREATE TRIGGER fail_audit BEFORE INSERT ON identity_access_events FOR EACH ROW EXECUTE FUNCTION fail_test_audit()");
    try { await assert.rejects(retainIdentityRecord(id)); assert.equal((await row(id)).file_deleted_at,null); }
    finally { await pool.query("DROP TRIGGER fail_audit ON identity_access_events"); }
    await retainIdentityRecord(id); assert.ok((await row(id)).file_deleted_at); assert.equal(deleted.get(before.file_key),2);
  });
  await test("two replicas cannot claim the same retention lease", async () => {
    const claims=await Promise.all([jobs.claim("replica-a"),jobs.claim("replica-b")]);
    assert.equal(claims.filter(v=>v===0).length,1); assert.equal(claims.filter(v=>v===null).length,1);
  });
  await test("expired worker cannot finish after restart claims its checkpoint", async () => {
    const old=(await pool.query("SELECT lease_owner FROM identity_retention_job")).rows[0].lease_owner;
    await pool.query("UPDATE identity_retention_job SET lease_until=now()-interval '1 second',cursor_id=42");
    assert.equal(await jobs.claim("restarted"),42);
    assert.equal(await jobs.finish(old,{cursor:999,failed:false,cycleComplete:true}),false);
    assert.equal(await jobs.finish("restarted",{cursor:42,failed:true,cycleComplete:false}),true);
    const r=(await pool.query("SELECT * FROM identity_retention_job")).rows[0];
    assert.equal(r.cursor_id,42); assert.equal(r.failure_count,1); assert.equal(r.last_cycle_at,null);
  });
  await test("failed batches preserve retry cursor and completed cycles reset it", async () => {
    await pool.query("UPDATE identity_retention_job SET next_run_at=now()-interval '1 second',cursor_id=0");
    const retry=await runIdentityRetentionJob(jobs,"retry-worker",async()=>({counts:{},failedIds:[7],nextCursor:10}));
    assert.equal(retry.state,"retry"); assert.equal((await pool.query("SELECT cursor_id FROM identity_retention_job")).rows[0].cursor_id,6);
    await pool.query("UPDATE identity_retention_job SET next_run_at=now()-interval '1 second'");
    const done=await runIdentityRetentionJob(jobs,"healthy-worker",async cursor=>{assert.equal(cursor,6);return {counts:{},failedIds:[],nextCursor:null};});
    assert.equal(done.state,"complete"); const r=(await pool.query("SELECT * FROM identity_retention_job")).rows[0];
    assert.equal(r.cursor_id,0); assert.equal(r.failure_count,0); assert.ok(r.last_cycle_at);
  });
  console.log(`${passed} real PostgreSQL checks passed; R2 adapter simulated.`);
  await test("closure stamps every retained record without releasing holds; retries do not extend retention",async()=>{
    const id=await record("hold_started_at=now(),hold_reviewed_at=now()");
    const when=new Date('2026-01-01T00:00:00.000Z');
    // Earlier fixture exercises retention using a historic closure date; isolate this workflow's actor.
    await pool.query('INSERT INTO users(id) VALUES (3)');
    await pool.query('UPDATE identity_verifications SET user_id=3 WHERE id=$1',[id]);
    const other=await record(); await pool.query('UPDATE identity_verifications SET user_id=3 WHERE id=$1',[other]);
    assert.deepEqual(await db.transaction(tx=>recordIdentityAccountClosure(tx,3,when)),{stamped:2});
    assert.equal((await row(id)).account_closed_at.toISOString(),when.toISOString());
    assert.ok((await row(id)).hold_started_at); assert.ok((await row(id)).file_key);
    assert.deepEqual(await db.transaction(tx=>recordIdentityAccountClosure(tx,3,when)),{stamped:0});
    await assert.rejects(db.transaction(tx=>recordIdentityAccountClosure(tx,3,new Date('2026-02-01T00:00:00Z'))));
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM identity_access_events WHERE verification_id IN ($1,$2) AND action='account_closed'",[id,other])).rows[0].n,2);
  });
  await test("closure audit failure rolls back all timestamps; caller rollback also rolls back stamping",async()=>{
    await pool.query('INSERT INTO users(id) VALUES (4)');
    const id=await record(); await pool.query('UPDATE identity_verifications SET user_id=4 WHERE id=$1',[id]);
    const when=new Date('2026-01-01T00:00:00Z');
    await pool.query(`CREATE FUNCTION fail_closure_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='account_closed' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
    await pool.query('CREATE TRIGGER fail_closure BEFORE INSERT ON identity_access_events FOR EACH ROW EXECUTE FUNCTION fail_closure_audit()');
    try { await assert.rejects(db.transaction(tx=>recordIdentityAccountClosure(tx,4,when))); }
    finally { await pool.query('DROP TRIGGER fail_closure ON identity_access_events'); }
    assert.equal((await row(id)).account_closed_at,null);
    await assert.rejects(db.transaction(async tx=>{await recordIdentityAccountClosure(tx,4,when);throw Error('Closure completion failed');}));
    assert.equal((await row(id)).account_closed_at,null);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM identity_access_events WHERE verification_id=$1 AND action='account_closed'",[id])).rows[0].n,0);
  });
  await runHttpChecks(test);
  await runClosureChecks(test);
  console.log(`${passed} total isolated integration checks passed.`);
} catch(error) {
  const e = error as {name?:string;code?:string;cause?:{code?:string;message?:string}};
  console.error("FAIL",error instanceof assert.AssertionError ? error.message : {name:e.name,code:e.code,causeCode:e.cause?.code,
    cause:e.cause?.message?.replace(/postgres(?:ql)?:\/\/\S+/g,"[database redacted]")}); process.exitCode=1;
}
finally { await pool.end(); }
