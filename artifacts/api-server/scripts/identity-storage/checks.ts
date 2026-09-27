import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { S3Client, GetObjectCommand, HeadObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { identityStorageReady,putIdentityFile,readIdentityFile,deleteIdentityFile } from '../../src/lib/identityFiles.ts';
import { resolveEndpoint } from '../../src/lib/storageEndpoint.ts';
const bucket=process.env.IDENTITY_R2_BUCKET!;
assert.equal(bucket,'fadko-staging-private-identity');
assert.notEqual(bucket,process.env.R2_BUCKET);
assert.ok(identityStorageReady());
const {endpoint}=resolveEndpoint(process.env.R2_ACCOUNT_ID??'',process.env.R2_ENDPOINT??'');
const client=new S3Client({region:'auto',endpoint,forcePathStyle:true,maxAttempts:1,credentials:{
  accessKeyId:process.env.IDENTITY_R2_ACCESS_KEY_ID!,secretAccessKey:process.env.IDENTITY_R2_SECRET_ACCESS_KEY!}});
const key=`identity/999999999/${randomUUID()}.sealed`;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jg9sAAAAASUVORK5CYII=','base64');
let attempted=false;
try {
  // Read-only HEAD on ordinary staging bucket verifies the key is not broad account access.
  assert.ok(process.env.R2_BUCKET);
  await assert.rejects(client.send(new HeadBucketCommand({Bucket:process.env.R2_BUCKET}),{abortSignal:AbortSignal.timeout(15000)}),
    (e:any)=>e.$metadata?.httpStatusCode===403,'private key must be forbidden from ordinary bucket');
  console.log('PASS bucket-scoped credentials deny access to ordinary staging storage');
  attempted=true; await putIdentityFile(key,png);
  const raw=await client.send(new GetObjectCommand({Bucket:bucket,Key:key}),{abortSignal:AbortSignal.timeout(15000)});
  assert.equal(raw.ContentType,'application/octet-stream');
  const envelope=await raw.Body!.transformToString();
  assert.ok(!envelope.includes(png.toString('base64'))); assert.ok(!envelope.includes('image/png'));
  console.log('PASS stored object is an encrypted envelope without plaintext image data');
  const restored=await readIdentityFile(key); assert.deepEqual(restored.bytes,png); assert.equal(restored.contentType,'image/png');
  console.log('PASS real private adapter upload/read decrypts exact synthetic image');
  const original=process.env.IDENTITY_ENCRYPTION_KEY_V1;
  try {process.env.IDENTITY_ENCRYPTION_KEY_V1=randomBytes(32).toString('hex');await assert.rejects(readIdentityFile(key));}
  finally {process.env.IDENTITY_ENCRYPTION_KEY_V1=original;}
  console.log('PASS incorrect encryption key cannot read the object');
}catch(e:any){console.error('FAIL private R2 integration',e.name??'unknown',e.$metadata?.httpStatusCode??'');process.exitCode=1;}
finally {
  if(attempted) {
    try {
      await deleteIdentityFile(key); await deleteIdentityFile(key);
      await assert.rejects(client.send(new HeadObjectCommand({Bucket:bucket,Key:key}),{abortSignal:AbortSignal.timeout(15000)}),(e:any)=>e.$metadata?.httpStatusCode===404);
      console.log('PASS deletion is confirmed and safe to retry; synthetic object removed');
    }catch{console.error(`Cleanup required for synthetic object ${bucket}/${key}`);process.exitCode=1;}
  }
  client.destroy();
}
