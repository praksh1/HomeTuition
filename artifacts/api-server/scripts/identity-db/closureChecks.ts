import assert from 'node:assert/strict';
import { pool,db } from './database';
import { readAccountClosureCommitments } from '../../src/lib/accountClosureCommitments';
import { requestAccountClosure, cancelAccountClosure, completeAccountClosure, accountClosureCompleted } from '../../src/lib/accountClosureStore';
import { activeAccount } from '../../src/lib/activeAccount';
import { runClosureHttpChecks } from './closureHttpChecks';
import { claimClosureMedia, finishClosureMedia, disconnectClosureMedia, closureMediaReady } from '../../src/lib/accountClosureMedia';
import { issueActiveAccountToken } from '../../src/lib/accountTokenIssue';
export async function runClosureChecks(test:(name:string,fn:()=>Promise<void>)=>Promise<void>) {
  await pool.query(`ALTER TABLE users ADD COLUMN suspended_reason text, ADD COLUMN suspended_by integer;
    INSERT INTO users(id,role,name) VALUES(401,'student','Closure fixture'),(402,'admin','Closure reviewer');
    INSERT INTO operator_accounts(user_id,login_id,must_change_password) VALUES(402,'closure-reviewer',false);
    CREATE TABLE account_tokens(user_id integer,used_at timestamptz);
    CREATE TABLE password_resets(user_id integer,used_at timestamptz);
    INSERT INTO account_tokens VALUES(401,null); INSERT INTO password_resets VALUES(401,null);
    INSERT INTO identity_verifications(user_id,holder,status,policy_version,details_ciphertext,encryption_key_version,consent_at,hold_started_at)
      VALUES(401,'self','submitted','synthetic','opaque','v1',now(),now());`);
  await pool.query(`CREATE TABLE sessions(id integer PRIMARY KEY,teacher_id integer,status text);
    CREATE TABLE session_enrollments(session_id integer,student_id integer,payment_status text);
    CREATE TABLE learning_programs(id integer PRIMARY KEY,teacher_id integer);
    CREATE TABLE learning_program_enrollments(id integer PRIMARY KEY,program_id integer,student_id integer);
    CREATE TABLE learning_program_allocations(enrollment_id integer,state text);
    CREATE TABLE learning_program_batches(id integer PRIMARY KEY,program_id integer,status text);
    CREATE TABLE learning_program_batch_lessons(batch_id integer,starts_at timestamptz,duration_minutes integer);
    CREATE TABLE batch_test_bookings(id integer PRIMARY KEY,batch_id integer,student_id integer);
    CREATE TABLE batch_test_payments(booking_id integer PRIMARY KEY,receipt jsonb);
    CREATE TABLE batch_test_ledger_entries(id serial PRIMARY KEY,booking_id integer,position integer,to_state text);
    CREATE TABLE batch_test_sessions(session_id integer);
    CREATE TABLE recurring_sessions(id integer PRIMARY KEY,teacher_id integer,status text);
    CREATE TABLE recurring_enrollments(recurring_id integer,student_id integer,status text,cycle_index integer);
    CREATE TABLE recurring_days(recurring_id integer,kind text,status text,cycle_index integer);
    CREATE TABLE refunds(student_id integer,session_id integer,recurring_id integer,status text);`);
  const clear=async()=>({complete:true,upcomingLessons:0,pendingPayments:0,openDisputes:0,pendingMakeups:0});
  await runClosureHttpChecks(test);
  await test('real closure preflight distinguishes empty, unsettled and resolved batch obligations',async()=>{
    assert.deepEqual(await readAccountClosureCommitments(db,401),await clear());
    await pool.query(`INSERT INTO sessions VALUES(901,101,'upcoming'); INSERT INTO session_enrollments VALUES(901,401,'test');
      INSERT INTO learning_programs VALUES(901,101); INSERT INTO learning_program_batches VALUES(901,901,'closed');
      INSERT INTO batch_test_bookings VALUES(901,901,401);
      INSERT INTO batch_test_payments VALUES(901,'{"allocations":[{"position":0}]}');
      INSERT INTO refunds VALUES(401,901,null,'owed');
      INSERT INTO disputes VALUES(901,401,901,'open');`);
    const blocked=await readAccountClosureCommitments(db,401);
    assert.equal(blocked.upcomingLessons,1); assert.equal(blocked.pendingPayments,2); assert.equal(blocked.openDisputes,1);
    await pool.query(`UPDATE sessions SET status='completed' WHERE id=901; UPDATE refunds SET status='paid';
      UPDATE disputes SET status='resolved' WHERE id=901;
      INSERT INTO batch_test_ledger_entries(booking_id,position,to_state) VALUES(901,0,'refunded');`);
    assert.deepEqual(await readAccountClosureCommitments(db,401),await clear());
  });
  await test('missing batch receipt and untracked legacy payments cannot look settled',async()=>{
    await pool.query('INSERT INTO learning_program_enrollments VALUES(999,901,401)');
    assert.equal((await readAccountClosureCommitments(db,401)).complete,false);
    await pool.query('DELETE FROM learning_program_enrollments WHERE id=999');
    await pool.query("UPDATE batch_test_payments SET receipt='{}' WHERE booking_id=901");
    assert.equal((await readAccountClosureCommitments(db,401)).complete,false);
    await pool.query(`UPDATE batch_test_payments SET receipt='{"allocations":[{"position":0}]}' WHERE booking_id=901;
      UPDATE session_enrollments SET payment_status='paid' WHERE student_id=401;`);
    assert.equal((await readAccountClosureCommitments(db,401)).complete,false);
    await pool.query("UPDATE session_enrollments SET payment_status='test' WHERE student_id=401");
  });
  await test('ended published offers do not block closure forever; future or missing schedules still block',async()=>{
    await pool.query("UPDATE learning_program_batches SET status='published' WHERE id=901");
    assert.equal((await readAccountClosureCommitments(db,101)).upcomingLessons,1);
    await pool.query("INSERT INTO learning_program_batch_lessons VALUES(901,now()-interval '2 days',60)");
    assert.equal((await readAccountClosureCommitments(db,101)).upcomingLessons,0);
    await pool.query("UPDATE learning_program_batch_lessons SET starts_at=now()+interval '1 day' WHERE batch_id=901");
    assert.equal((await readAccountClosureCommitments(db,101)).upcomingLessons,1);
    await pool.query("UPDATE learning_program_batches SET status='closed' WHERE id=901");
  });
  let version=0;
  process.env.VIDEO_PROVIDER='livekit';process.env.LIVEKIT_URL='wss://synthetic.livekit.cloud';
  await test('malformed receipt allocations block closure without casting or array errors',async()=>{
    for(const receipt of [{allocations:{}},{allocations:[{}]},{allocations:[{position:'invalid'}]},
      {allocations:[{position:'999999999999999999999'}]}]) {
      await pool.query('UPDATE batch_test_payments SET receipt=$1::jsonb WHERE booking_id=901',[JSON.stringify(receipt)]);
      assert.equal((await readAccountClosureCommitments(db,401)).complete,false);
    }
    await pool.query(`UPDATE batch_test_payments SET receipt='{"allocations":[{"position":0}]}' WHERE booking_id=901`);
  });
  await test('closure requests and retries leave account access and retention unchanged',async()=>{
    const first=await requestAccountClosure(401); version=Number(first?.version);
    assert.equal((await requestAccountClosure(401))?.version,version);
    assert.ok(await activeAccount({userId:401,email:'fixture@example.invalid',role:'student'}));
    assert.equal((await pool.query('SELECT account_closed_at FROM identity_verifications WHERE user_id=401')).rows[0].account_closed_at,null);
  });
  await test('closure cancellation invalidates the old operator review',async()=>{
    assert.equal(await cancelAccountClosure(401,version),true);
    assert.equal((await completeAccountClosure({userId:401,operatorId:402,version,confirmed:true},clear)).closed,false);
    version=Number((await requestAccountClosure(401))?.version);
  });
  await test('unsettled or unavailable obligations prevent closure and keep account usable',async()=>{
    for(const evidence of [{...(await clear()),pendingPayments:1},{...(await clear()),complete:false}]){
      const result=await completeAccountClosure({userId:401,operatorId:402,version,confirmed:true},async()=>evidence);
      assert.equal(result.closed,false);
      assert.ok(await activeAccount({userId:401,email:'fixture@example.invalid',role:'student'}));
    }
    await assert.rejects(completeAccountClosure({userId:401,operatorId:401,version,confirmed:true},clear));
  });
  await test('closure audit failure rolls back access revocation, tokens and retention together',async()=>{
    await pool.query(`CREATE FUNCTION fail_completion_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='closed' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
    await pool.query('CREATE TRIGGER fail_completion BEFORE INSERT ON account_closure_events FOR EACH ROW EXECUTE FUNCTION fail_completion_audit()');
    try { await assert.rejects(completeAccountClosure({userId:401,operatorId:402,version,confirmed:true},clear)); }
    finally { await pool.query('DROP TRIGGER fail_completion ON account_closure_events'); }
    assert.equal(await accountClosureCompleted(401),false);
    assert.equal((await pool.query('SELECT used_at FROM account_tokens WHERE user_id=401')).rows[0].used_at,null);
    assert.equal((await pool.query('SELECT account_closed_at FROM identity_verifications WHERE user_id=401')).rows[0].account_closed_at,null);
    assert.ok(await activeAccount({userId:401,email:'fixture@example.invalid',role:'student'}));
  });
  await test('completed closure revokes old access and reset codes, stamps ID retention and preserves holds',async()=>{
    process.env.VIDEO_PROVIDER='livekit';process.env.LIVEKIT_URL='wss://synthetic.livekit.cloud';
    const result=await completeAccountClosure({userId:401,operatorId:402,version,confirmed:true});
    assert.equal(result.closed,true); assert.equal(await accountClosureCompleted(401),true);
    assert.equal(await activeAccount({userId:401,email:'fixture@example.invalid',role:'student'}),null);
    const identity=(await pool.query('SELECT * FROM identity_verifications WHERE user_id=401')).rows[0];
    assert.ok(identity.account_closed_at); assert.ok(identity.hold_started_at); assert.equal(identity.details_ciphertext,'opaque');
    assert.ok((await pool.query('SELECT used_at FROM account_tokens WHERE user_id=401')).rows[0].used_at);
    assert.ok((await pool.query('SELECT used_at FROM password_resets WHERE user_id=401')).rows[0].used_at);
    const retried=await completeAccountClosure({userId:401,operatorId:402,version,confirmed:true},clear);
    assert.equal(new Date(retried.closedAt as Date).toISOString(),identity.account_closed_at.toISOString());
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM account_closure_events WHERE user_id=401 AND action='closed'")).rows[0].n,1);
  });
  await test('closure media work survives completion and failed delivery; stale workers cannot finish it',async()=>{
    const first=await claimClosureMedia();assert.ok(first);assert.equal(first.user_id,401);assert.equal(first.session_id,901);
    assert.equal(await claimClosureMedia(),null);
    assert.deepEqual(await disconnectClosureMedia(first),{revoked:false,reason:'unsupported_host'}); // no credentials in synthetic runner
    await pool.query("UPDATE account_closure_media_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[first.id]);
    const second=await claimClosureMedia();assert.ok(second);assert.notEqual(second.lease_token,first.lease_token);
    assert.equal(await finishClosureMedia(first,{revoked:true}),false);
    assert.equal(await finishClosureMedia(second,{revoked:false,reason:'provider_failed'}),true);
    Object.assign(process.env,{ACCOUNT_CLOSURE_MEDIA_ENABLED:'true',LIVEKIT_API_KEY:'synthetic',LIVEKIT_API_SECRET:'synthetic'});
    await pool.query('UPDATE account_closure_worker_health SET checked_at=now() WHERE id=1');
    assert.equal(await closureMediaReady(),false);
    assert.equal(await claimClosureMedia(),null);
    await pool.query("UPDATE account_closure_media_jobs SET next_attempt_at=now()-interval '1 second' WHERE id=$1",[first.id]);
    const retry=await claimClosureMedia();assert.ok(retry);assert.equal(await finishClosureMedia(retry,{revoked:true}),true);
    assert.equal(await claimClosureMedia(),null);
    assert.equal(await closureMediaReady(),true);
    await pool.query("UPDATE account_closure_worker_health SET checked_at=now()-interval '1 minute' WHERE id=1");
    assert.equal(await closureMediaReady(),false);
    delete process.env.ACCOUNT_CLOSURE_MEDIA_ENABLED;delete process.env.LIVEKIT_API_KEY;delete process.env.LIVEKIT_API_SECRET;
    delete process.env.VIDEO_PROVIDER;delete process.env.LIVEKIT_URL;
  });
  await test('closed accounts cannot gain commitments even through direct legacy database writes',async()=>{
    let signed=false;
    assert.equal(await issueActiveAccountToken(401,'student',async()=>{signed=true;return 'synthetic';}),null);
    assert.equal(signed,false);
    assert.equal(await issueActiveAccountToken(402,'student',async()=> 'synthetic'),null);
    await assert.rejects(pool.query("INSERT INTO session_enrollments VALUES(901,401,'test')"));
    await assert.rejects(pool.query("INSERT INTO batch_test_bookings VALUES(902,901,401)"));
    await assert.rejects(pool.query("INSERT INTO learning_program_enrollments VALUES(902,901,401)"));
    await assert.rejects(pool.query("INSERT INTO sessions VALUES(902,401,'upcoming')"));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM batch_test_bookings WHERE id=902')).rows[0].n,0);
  });
  await test('a concurrent booking commits before closure review or is rejected after closure, never stranded',async()=>{
    await pool.query("INSERT INTO users(id,role,name) VALUES(403,'student','Race booking first'),(404,'student','Race closure first'); INSERT INTO sessions VALUES(903,101,'upcoming')");
    const request=await requestAccountClosure(403);
    const connection=await pool.connect();
    try{
      await connection.query('BEGIN');
      await connection.query("INSERT INTO session_enrollments VALUES(903,403,'test')");
      const closing=completeAccountClosure({userId:403,operatorId:402,version:Number(request?.version),confirmed:true});
      await connection.query('COMMIT');
      const result=await closing;assert.equal(result.closed,false);assert.ok(result.blockers?.includes('upcoming_lessons'));
      const second=await requestAccountClosure(404);
      assert.equal((await completeAccountClosure({userId:404,operatorId:402,version:Number(second?.version),confirmed:true})).closed,true);
      await assert.rejects(pool.query("INSERT INTO session_enrollments VALUES(903,404,'test')"));
    }finally{await connection.query('ROLLBACK');connection.release();}
  });
  await test('a booking already waiting on the closure lock rechecks closed state after the commit',async()=>{
    await pool.query("INSERT INTO users(id,role,name) VALUES(406,'student','Waiting booking fixture')");
    await requestAccountClosure(406);
    const closing=await pool.connect(),booking=await pool.connect();
    try{
      const pid=(await booking.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await closing.query('BEGIN');await closing.query('SELECT id FROM users WHERE id=406 FOR UPDATE');
      const waiting=booking.query("INSERT INTO session_enrollments VALUES(903,406,'test')").then(()=>true,()=>false);
      let blocked=false;
      for(let i=0;i<30;i++){
        blocked=(await pool.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[pid])).rows[0].blocked;
        if(blocked)break;await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(blocked,true);
      await closing.query("UPDATE account_closure_requests SET status='closed',closed_at=now() WHERE user_id=406");
      await closing.query('COMMIT');assert.equal(await waiting,false);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM session_enrollments WHERE student_id=406')).rows[0].n,0);
    }finally{await closing.query('ROLLBACK');closing.release();booking.release();}
  });
}
