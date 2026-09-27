import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import { pool } from "./database";
import router from "../../src/routes/identityVerification";
import { signToken } from "../../src/lib/auth";
import { failures, writes } from "./storage";
import { isLegacyIdentityFile } from "../../src/lib/legacyIdentityFiles";
import { signView, verifyUpload } from "../../src/lib/fileStore";
import { requireAuth, attachUserIfPresent } from "../../src/middlewares/requireAuth";
import { attachClassroomHub } from "../../src/ws/classroomHub";
import { WebSocket } from "ws";

/** Actual router/auth/crypto/DB with synthetic accounts and in-memory file storage. */
export async function runHttpChecks(test: (name:string, fn:()=>Promise<void>)=>Promise<void>) {
  await pool.query(`ALTER TABLE users ADD COLUMN role text, ADD COLUMN suspended_at timestamptz, ADD COLUMN name text;
    INSERT INTO users(id,role,name) VALUES (101,'teacher','Synthetic teacher'),(102,'student','Synthetic student'),
      (103,'student','Other synthetic student'),(104,'student','Unverified synthetic student'),
      (201,'admin','Synthetic reviewer'),(202,'admin','Unlisted operator'),(203,'admin','Password change required'),
      (204,'admin','Disabled operator'),(205,'student','Demoted operator');
    CREATE TABLE account_security(user_id integer PRIMARY KEY,email_verified_at timestamptz);
    INSERT INTO account_security VALUES (101,now()),(102,now()),(103,now());
    CREATE TABLE operator_accounts(id serial PRIMARY KEY,user_id integer,login_id text,is_administrator boolean DEFAULT false,
      must_change_password boolean DEFAULT false,disabled_at timestamptz,last_sign_in_at timestamptz,created_at timestamptz DEFAULT now());
    INSERT INTO operator_accounts(user_id,login_id,must_change_password,disabled_at) VALUES
      (201,'synthetic-reviewer',false,null),(203,'synthetic-password',true,null),(204,'synthetic-disabled',false,now());
    CREATE TABLE user_notification_events(id serial PRIMARY KEY,user_id integer,event jsonb,created_at timestamptz DEFAULT now());
    CREATE TABLE disputes(id integer PRIMARY KEY,user_id integer,session_id integer,status text);
    INSERT INTO disputes VALUES(1,102,null,'open'),(2,103,null,'open'),(3,102,null,'resolved');
    UPDATE identity_retention_job SET last_cycle_at=now(),failure_count=0;`);
  process.env.IDENTITY_COLLECTION_ENABLED="true"; process.env.IDENTITY_RETENTION_ENABLED="true";
  process.env.IDENTITY_REVIEWER_USER_IDS="201,203,204,205";
  const tokens=new Map<number,string>();
  for(const id of [101,102,103,104,201,202,203,204,205]) tokens.set(id,signToken({userId:id,email:`synthetic-${id}@example.invalid`,role:id>=201?'admin':id===101?'teacher':'student'}));
  const app=express(); app.use(express.json()); app.use('/api',router);
  app.get('/api/test-access',requireAuth,(req,res)=>res.json({role:req.user!.role}));
  app.get('/api/test-public',attachUserIfPresent,(req,res)=>res.json({signedIn:Boolean(req.user)}));
  const server=app.listen(0,'127.0.0.1'); await new Promise<void>(resolve=>server.once('listening',resolve));
  attachClassroomHub(server);
  const address=server.address(); if(!address||typeof address==='string') throw Error('No local test listener');
  const base=`http://127.0.0.1:${address.port}/api`;
  async function socketStatus(id:number,session=false):Promise<number> {
    return new Promise((resolve,reject)=>{
      const ws=new WebSocket(`${base.replace('http:','ws:')}/ws?token=${tokens.get(id)}${session?'&sessionId=1':''}`);
      const timer=setTimeout(()=>{ws.terminate();reject(Error('Socket test timed out'));},5000);
      ws.on('error',()=>{});
      ws.once('open',()=>{clearTimeout(timer);ws.close();ws.once('close',()=>resolve(101));});
      ws.once('unexpected-response',(_req,res)=>{clearTimeout(timer);res.resume();ws.terminate();resolve(res.statusCode??0);});
    });
  }
  async function call(path:string,id?:number,body?:unknown,method=body===undefined?'GET':'POST',token?:string) {
    const response=await fetch(base+path,{method,headers:{...(id?{Authorization:`Bearer ${token??tokens.get(id)}`} : {}),
      'Content-Type':Buffer.isBuffer(body)?'application/octet-stream':'application/json'},
      body:body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body)});
    const bytes=Buffer.from(await response.arrayBuffer());
    return {status:response.status,headers:response.headers,body:response.headers.get('content-type')?.includes('json')?JSON.parse(bytes.toString()):null,bytes};
  }
  const details={holder:'self',documentType:'citizenship',legalName:'Synthetic Test Person',documentNumber:'TEST-NOT-A-REAL-ID',
    dateOfBirth:'1990-01-01',issuingDistrict:'Test district',issuingMunicipality:'Test municipality',consent:true};
  const png=Buffer.from([137,80,78,71,13,10,26,10]); // Signature-only test bytes; not an identity image.
  let submission=0; let key=''; let count=0;
  async function check(name:string,fn:()=>Promise<void>){await test(name,fn);count++;}
  try {
    await check('HTTP existing token uses fresh role and refuses suspended or missing accounts',async()=>{
      assert.equal((await call('/test-access',205)).body.role,'student');
      await pool.query('UPDATE users SET suspended_at=now() WHERE id=103');
      try {
        assert.equal((await call('/test-access',103)).status,403);
        assert.equal((await call('/test-public',103)).body.signedIn,false);
      } finally { await pool.query('UPDATE users SET suspended_at=null WHERE id=103'); }
      const missing=signToken({userId:999999,email:'missing@example.invalid',role:'student'});
      assert.equal((await call('/test-access',102,undefined,'GET',missing)).status,403);
      assert.equal((await call('/test-access',103)).status,200);
    });
    await check('HTTP account lookup failure fails closed without breaking public browsing',async()=>{
      await pool.query('ALTER TABLE users RENAME COLUMN suspended_at TO test_unavailable');
      try {
        assert.equal((await call('/test-access',103)).status,503);
        assert.equal((await call('/test-public',103)).body.signedIn,false);
      } finally { await pool.query('ALTER TABLE users RENAME COLUMN test_unavailable TO suspended_at'); }
    });
    await check('WebSocket notification and classroom handshakes deny suspended accounts',async()=>{
      assert.equal(await socketStatus(103),101);
      await pool.query('UPDATE users SET suspended_at=now() WHERE id=103');
      try {
        assert.equal(await socketStatus(103),403);
        assert.equal(await socketStatus(103,true),403);
      } finally { await pool.query('UPDATE users SET suspended_at=null WHERE id=103'); }
    });
    await check('already-open notification socket is revoked after suspension',async()=>{
      const ws=new WebSocket(`${base.replace('http:','ws:')}/ws?token=${tokens.get(103)}`);
      ws.on('error',()=>{});
      try {
        await new Promise<void>((resolve,reject)=>{
          const timer=setTimeout(()=>reject(Error('Socket did not open')),5000);
          ws.once('open',()=>{clearTimeout(timer);resolve();});
        });
        const closed=new Promise<void>((resolve,reject)=>{
          const timer=setTimeout(()=>reject(Error('Suspended socket stayed open')),22000);
          ws.once('close',()=>{clearTimeout(timer);resolve();});
        });
        await pool.query('UPDATE users SET suspended_at=now() WHERE id=103');
        await closed;
        assert.equal((await call('/test-access',103)).status,403);
      } finally { ws.terminate(); await pool.query('UPDATE users SET suspended_at=null WHERE id=103'); }
    });
    await check('HTTP missing/expired token rejected',async()=>{
      assert.equal((await call('/identity-verification/me')).status,401);
      const expired=jwt.sign({userId:102,role:'student'},process.env.SESSION_SECRET!,{expiresIn:-1});
      assert.equal((await call('/identity-verification/me',102,undefined,'GET',expired)).status,401);
    });
    await check('HTTP reviewer role, allowlist, password and disable restrictions',async()=>{
      for(const id of [102,202,203,204,205]) assert.equal((await call('/identity-review',id)).status,403,`restricted fixture ${id}`);
      assert.equal((await call('/identity-review',201)).status,200);
    });
    await check('HTTP unverified email cannot prepare identity',async()=>{
      const result=await call('/identity-verification/prepare',104,details); assert.equal(result.status,403);
      assert.equal(result.body.code,'EMAIL_VERIFICATION_REQUIRED');
    });
    await check('HTTP invalid fields remain specific and teacher cannot submit parent identity',async()=>{
      const invalid=await call('/identity-verification/prepare',102,{...details,legalName:''});
      assert.equal(invalid.status,400); assert.deepEqual(Object.keys(invalid.body.fields),['legalName']);
      assert.equal((await call('/identity-verification/prepare',101,{...details,holder:'parent',parentRelationship:'Mother'})).status,400);
    });
    await check('HTTP concurrent preparation reuses one encrypted record',async()=>{
      const result=await Promise.all([call('/identity-verification/prepare',102,details),call('/identity-verification/prepare',102,details)]);
      assert.ok(result.every(r=>r.status===200)); assert.equal(result[0].body.id,result[1].body.id); submission=result[0].body.id;
      const row=(await pool.query('SELECT * FROM identity_verifications WHERE id=$1',[submission])).rows[0]; key=row.file_key;
      assert.ok(!row.details_ciphertext.includes(details.legalName)); assert.ok(!row.details_ciphertext.includes(details.documentNumber));
    });
    await check('HTTP another account cannot upload into the prepared record',async()=>{
      assert.equal((await call(`/identity-verification/${submission}/document`,103,png,'PUT')).status,404);
    });
    await check('HTTP failed upload is retryable; concurrent retries store only once',async()=>{
      failures.add(key); assert.equal((await call(`/identity-verification/${submission}/document`,102,png,'PUT')).status,503); failures.delete(key);
      const results=await Promise.all([call(`/identity-verification/${submission}/document`,102,png,'PUT'),call(`/identity-verification/${submission}/document`,102,png,'PUT')]);
      assert.ok(results.every(r=>r.status===200)); assert.equal(writes.get(key),1);
    });
    await check('HTTP own status is no-store and excludes private fields',async()=>{
      const result=await call('/identity-verification/me',102); assert.equal(result.status,200); assert.equal(result.headers.get('cache-control'),'no-store');
      assert.equal(result.body.verification.status,'submitted');
      const output=JSON.stringify(result.body); for(const secret of [details.legalName,details.documentNumber,key,'detailsCiphertext']) assert.ok(!output.includes(secret));
      assert.equal((await call('/identity-verification/me',103)).body.verification,null);
    });
    await check('HTTP no decision without completed sensitive reads',async()=>{
      assert.equal((await call(`/identity-review/${submission}/decision`,201,{decision:'approved'})).status,409);
    });
    await check('HTTP audit failure prevents private metadata response',async()=>{
      await pool.query(`CREATE FUNCTION fail_http_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='metadata_access_requested' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
      await pool.query('CREATE TRIGGER fail_http BEFORE INSERT ON identity_access_events FOR EACH ROW EXECUTE FUNCTION fail_http_audit()');
      try { const r=await call(`/identity-review/${submission}/open`,201,{}); assert.equal(r.status,503); assert.ok(!r.bytes.toString().includes(details.legalName)); }
      finally { await pool.query('DROP TRIGGER fail_http ON identity_access_events'); }
      assert.equal((await call(`/identity-review/${submission}/open`,201,{})).body.details.legalName,details.legalName);
    });
    await check('HTTP successful-document audit failure prevents file delivery',async()=>{
      await pool.query(`CREATE OR REPLACE FUNCTION fail_http_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='document_opened' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
      await pool.query('CREATE TRIGGER fail_http BEFORE INSERT ON identity_access_events FOR EACH ROW EXECUTE FUNCTION fail_http_audit()');
      try { const r=await call(`/identity-review/${submission}/document`,201,{}); assert.equal(r.status,503); assert.ok(!r.bytes.equals(png)); }
      finally { await pool.query('DROP TRIGGER fail_http ON identity_access_events'); }
      assert.equal((await call(`/identity-review/${submission}/decision`,201,{decision:'approved'})).status,409);
      const opened=await call(`/identity-review/${submission}/document`,201,{}); assert.equal(opened.status,200); assert.deepEqual(opened.bytes,png);
    });
    await check('HTTP concurrent decisions commit once with one generic notification',async()=>{
      const decisions=await Promise.all([call(`/identity-review/${submission}/decision`,201,{decision:'approved'}),call(`/identity-review/${submission}/decision`,201,{decision:'rejected',rejectionCode:'unreadable'})]);
      assert.deepEqual(decisions.map(r=>r.status).sort(),[200,409]);
      const notices=await pool.query('SELECT event FROM user_notification_events WHERE user_id=102'); assert.equal(notices.rowCount,1);
      assert.deepEqual(Object.keys(notices.rows[0].event).sort(),['at','kind']);
    });
    await check('HTTP case-linked holds reject unrelated/closed cases and stale versions',async()=>{
      const path=`/identity-review/${submission}/hold`; const body={action:'place',caseId:2,version:0,confirmed:true};
      assert.equal((await call(path,201,body)).status,409); assert.equal((await call(path,201,{...body,caseId:3})).status,409);
      assert.equal((await call(path,201,{...body,caseId:1})).status,200);
      assert.equal((await call(path,201,{action:'release',caseId:1,version:0,confirmed:true})).status,409);
      process.env.IDENTITY_COLLECTION_ENABLED='false';
      assert.equal((await call(path,201,{action:'release',caseId:1,version:1,confirmed:true})).status,200);
      assert.equal((await call('/identity-verification/prepare',103,details)).status,503);
      process.env.IDENTITY_COLLECTION_ENABLED='true';
    });
    await check('HTTP suspended reviewer loses access despite existing valid token',async()=>{
      await pool.query('UPDATE users SET suspended_at=now() WHERE id=201');
      assert.equal((await call(`/identity-review/${submission}/document`,201,{})).status,403);
    });
    await check('legacy citizenship stays quarantined after rejection or withdrawal',async()=>{
      await pool.query(`CREATE TABLE teacher_credentials(id serial PRIMARY KEY,file_key text,document_type text,status text);
        INSERT INTO teacher_credentials(file_key,document_type,status) VALUES
        ('evidence/101/synthetic-old-id','citizenship','withdrawn'),('evidence/101/synthetic-rejected-id','citizenship','rejected'),
        ('evidence/101/synthetic-qualification','degree','approved');`);
      assert.equal(await isLegacyIdentityFile('evidence/101/synthetic-old-id'),true);
      assert.equal(await isLegacyIdentityFile('evidence/101/synthetic-rejected-id'),true);
      assert.equal(await isLegacyIdentityFile('evidence/101/synthetic-qualification'),false);
    });
    await check('ordinary signing and upload reuse refuse known identity files before storage access',async()=>{
      // Syntactically configured but deliberately non-routable; neither denial may make an S3 request.
      process.env.R2_ACCESS_KEY_ID='synthetic'; process.env.R2_SECRET_ACCESS_KEY='synthetic';
      process.env.R2_BUCKET='synthetic-ordinary'; process.env.R2_ENDPOINT='https://storage.example.invalid';
      await assert.rejects(signView('evidence/101/synthetic-old-id'),/Private identity/);
      const verdict=await verifyUpload('evidence/101/synthetic-old-id',101); assert.equal(verdict.ok,false);
    });
    console.log(`${count} actual HTTP authorization/workflow checks passed with PostgreSQL; file transport simulated.`);
  } finally { await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())); }
}
