/** Real R2 transport test. Uses only a one-pixel synthetic PNG and a random ephemeral key.
 * railway run --service <verified-staging-id> -- node scripts/identity-storage/run.mjs
 * Requires bucket-scoped staging credentials. NEVER enables identity collection.
 */
import { build } from "esbuild";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
if(process.env.RAILWAY_SERVICE_ID!=="cc10a94f-b24b-47bc-ae5c-ec2a9307cfa0"
  ||process.env.PUBLIC_APP_URL!=="https://hometuition-preview.praksh-dhakal.workers.dev"
  ||process.env.IDENTITY_COLLECTION_ENABLED==='true') throw Error('Refusing non-isolated or collection-enabled target');
if(!process.env.IDENTITY_R2_ACCESS_KEY_ID||!process.env.IDENTITY_R2_SECRET_ACCESS_KEY) throw Error('Dedicated staging credentials are required');
const temp=await mkdtemp(path.join(os.tmpdir(),'fadko-identity-storage-'));
try {
  const outfile=path.join(temp,'checks.mjs');
  await build({entryPoints:[path.join(here,'checks.ts')],outfile,bundle:true,platform:'node',format:'esm',logLevel:'silent',
    banner:{js:"import { createRequire } from 'node:module'; const require=createRequire(import.meta.url);"}});
  const result=spawnSync(process.execPath,[outfile],{stdio:'inherit',timeout:180000,env:{
    PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,
    R2_ACCOUNT_ID:process.env.R2_ACCOUNT_ID,R2_ENDPOINT:process.env.R2_ENDPOINT,R2_BUCKET:process.env.R2_BUCKET,
    IDENTITY_R2_BUCKET:'fadko-staging-private-identity',
    IDENTITY_R2_ACCESS_KEY_ID:process.env.IDENTITY_R2_ACCESS_KEY_ID,
    IDENTITY_R2_SECRET_ACCESS_KEY:process.env.IDENTITY_R2_SECRET_ACCESS_KEY,
    // Not the actual application's encryption key. Only synthetic bytes use this discarded key.
    IDENTITY_ENCRYPTION_KEY_V1:randomBytes(32).toString('hex'),
  }});
  if(result.status!==0) process.exitCode=1;
}finally{await rm(temp,{recursive:true,force:true});}
