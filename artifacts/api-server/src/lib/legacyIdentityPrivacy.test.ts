import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

// Execute the real file signer and storage handler. Only DB/AWS/Express boundaries are
// replaced: no secrets, object bytes, accounts or provider requests are used by these tests.
const stubs: Record<string, string> = {
  "@workspace/db": `
    export const usersTable={name:"users",id:"users.id",role:"users.role",suspendedAt:"users.suspendedAt"};
    export const teacherCredentialsTable={name:"credentials",id:"credentials.id",fileKey:"credentials.fileKey",documentType:"credentials.documentType"};
    export const operatorAccountsTable={name:"operators",userId:"operators.userId",disabledAt:"operators.disabledAt",mustChangePassword:"operators.mustChangePassword"};
    export const disputesTable={name:"disputes",id:"disputes.id",evidenceUrl:"disputes.evidenceUrl",userId:"disputes.userId"};
    export const db={select(fields){return{from(table){return{where(predicate){return{limit(){return globalThis.fixture.query(table,fields,predicate)}}}}}}}};
  `,
  "drizzle-orm": `export const eq=(column,value)=>({column,value});export const and=(...parts)=>parts;`,
  "@aws-sdk/client-s3": `
    export class S3Client { async send(command){globalThis.fixture.objectCalls.push(command);return{ContentLength:10,ContentType:"image/jpeg"}} }
    export class GetObjectCommand { constructor(input){this.input=input} }
    export class PutObjectCommand { constructor(input){this.input=input} }
    export class HeadObjectCommand { constructor(input){this.input=input} }
    export class DeleteObjectCommand { constructor(input){this.input=input} }
  `,
  "@aws-sdk/s3-request-presigner": `export async function getSignedUrl(client,command,options){globalThis.fixture.signatures.push({input:command.input,expiresIn:options.expiresIn});return "https://synthetic.invalid/review";}`,
  "express": `export const Router=()=>({post(){},put(){},get(path,...handlers){globalThis.fixture.handlers.set(path,handlers.at(-1))}});export default{raw(){return()=>{}}};`,
  "@workspace/api-zod": `export const RequestUploadUrlBody={safeParse(){throw Error("Unexpected upload")}};export const RequestUploadUrlResponse={parse:x=>x};`,
  "auth": `export const requireAuth=()=>{};`,
  "access": `export const mayOpenHomeworkFile=async()=>false;export const mayOpenMessageFile=async()=>false;export const mayOpenClassMessageFile=async()=>false;export const mayOpenClassMaterialFile=async()=>false;`,
  "logger": `export const logger={info(){},warn(){},error(){}};`,
};
const compilation = build({
  stdin: { contents: 'export * from "./fileStore"; import "../routes/storage";',
    resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "ts" },
  bundle: true, write: false, platform: "node", format: "cjs",
  plugins: [{ name: "private-review-boundaries", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      const key = args.path in stubs ? args.path : /(^|\/)logger$/.test(args.path) ? "logger"
        : /\/requireAuth$/.test(args.path) ? "auth"
        : /\/(homeworkAccess|messageAccess|classMessageAccess|classMaterialAccess)$/.test(args.path) ? "access" : null;
      return key ? { path: key, namespace: "fixture" } : undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "js" }));
  } }],
});

type User = { id: number; role: string; suspendedAt: Date | null };
type Credential = { id: number; fileKey: string; documentType: string; status?: string };
type Operator = { userId: number; disabledAt: Date | null; mustChangePassword: boolean };
type Predicate = { column: string; value: unknown } | Predicate[];
type Signature = { input: { Key: string; Bucket: string; ResponseContentDisposition?: string }; expiresIn: number };
type Handler = (req: unknown, res: unknown) => Promise<void>;
type FileStore = {
  signView(key: string, name?: string): Promise<string | null>;
  signProfilePhoto(key: string): Promise<string | null>;
  signLegacyIdentityReview(key: string, userId: number): Promise<string | null>;
  verifyUpload(key: string, userId: number): Promise<{ ok: boolean; reason?: string }>;
};
const idKey = "evidence/7/citizenship.pdf";
const photoKey = "evidence/7/photo.jpg";

async function isolate(mutate?: (source: string) => string) {
  const users: User[] = [{ id: 7, role: "teacher", suspendedAt: null }, { id: 10, role: "admin", suspendedAt: null }];
  const credentials: Credential[] = [{ id: 1, fileKey: idKey, documentType: "citizenship", status: "submitted" }];
  const operators: Operator[] = [];
  const env: Record<string, string> = { R2_ENDPOINT: "https://synthetic.invalid", R2_BUCKET: "synthetic-private", R2_ACCESS_KEY_ID: "not-a-key", R2_SECRET_ACCESS_KEY: "not-a-secret" };
  const fixture = {
    users, credentials, operators, env, failDb: false, queries: 0, queryTables: [] as string[],
    signatures: [] as Signature[], objectCalls: [] as unknown[], handlers: new Map<string, Handler>(),
    async query(table: { name: string }, fields: Record<string, string>, predicate: Predicate) {
      this.queries++;
      this.queryTables.push(table.name);
      if (this.failDb) throw new Error("Synthetic database outage");
      const matches = (row: Record<string, unknown>, filter: Predicate): boolean => Array.isArray(filter)
        ? filter.every(part => matches(row, part)) : row[filter.column.split(".").at(-1)!] === filter.value;
      const rows = table.name === "users" ? users : table.name === "credentials" ? credentials : table.name === "operators" ? operators : [];
      return rows.filter(row => matches(row as unknown as Record<string, unknown>, predicate)).slice(0, 1)
        .map(row => Object.fromEntries(Object.entries(fields).map(([name, column]) => [name, (row as unknown as Record<string, unknown>)[column.split(".").at(-1)!]])));
    },
  };
  const module = { exports: {} };
  const compiled = (await compilation).outputFiles![0].text;
  runInNewContext(mutate ? mutate(compiled) : compiled, {
    module, exports: module.exports, require: createRequire(import.meta.url), Buffer, URL, Date,
    process: { env }, fixture,
  });
  const files = module.exports as FileStore;
  async function open(key: string, userId: number, role = "admin") {
    const response = { statusCode: 200, body: undefined as unknown, headers: {} as Record<string, string>,
      status(value: number) { this.statusCode = value; return this; }, json(value: unknown) { this.body = value; return this; },
      setHeader(name: string, value: string) { this.headers[name] = value; } };
    await fixture.handlers.get("/storage/file")!({ query: { key }, user: { userId, role }, log: { error() {} } }, response);
    return response;
  }
  return { fixture, files, open };
}

test("citizenship files cannot be shared as attachments, avatars or uploaded-message reuse", async () => {
  const { fixture, files } = await isolate();
  await assert.rejects(files.signView(idKey), /Private identity files/);
  await assert.rejects(files.signProfilePhoto(idKey), /Private identity files/);
  assert.equal((await files.verifyUpload(idKey, 7)).ok, false);
  assert.equal(fixture.signatures.length, 0);
  assert.equal(fixture.objectCalls.length, 0);
});

test("only a current, unsuspended DB operator can get an exact-key short review link", async () => {
  const { fixture, files } = await isolate();
  assert.ok(await files.signLegacyIdentityReview(idKey, 10));
  assert.equal(fixture.signatures[0].input.Key, idKey);
  assert.equal(fixture.signatures[0].expiresIn, 120);
  assert.equal(fixture.signatures[0].input.ResponseContentDisposition, undefined);
  for (const userId of [7, 999, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(await files.signLegacyIdentityReview(idKey, userId), null);
  }
  assert.equal(await files.signLegacyIdentityReview(photoKey, 10), null);
  assert.equal(await files.signLegacyIdentityReview(`${idKey}/changed`, 10), null);
  fixture.users[1].role = "student";
  assert.equal(await files.signLegacyIdentityReview(idKey, 10), null);
  fixture.users[1].role = "admin";
  fixture.users[1].suspendedAt = new Date();
  assert.equal(await files.signLegacyIdentityReview(idKey, 10), null);
  assert.equal(fixture.signatures.length, 1);
});

test("withdrawn and rejected citizenship remains private but reviewable, other credentials do not", async () => {
  for (const status of ["withdrawn", "rejected"]) {
    const { fixture, files } = await isolate();
    fixture.credentials[0].status = status;
    await assert.rejects(files.signView(idKey), /Private identity files/);
    assert.ok(await files.signLegacyIdentityReview(idKey, 10));
  }
  const { fixture, files } = await isolate();
  fixture.credentials[0].documentType = "qualification";
  assert.equal(await files.signLegacyIdentityReview(idKey, 10), null);
  assert.ok(await files.signView(idKey));
  assert.equal(fixture.signatures[0].expiresIn, 600);
});

test("cached avatars stop being returned if the same key becomes citizenship evidence", async () => {
  const { fixture, files } = await isolate();
  assert.ok(await files.signProfilePhoto(photoKey));
  assert.ok(await files.signProfilePhoto(photoKey));
  assert.equal(fixture.signatures.length, 1);
  fixture.credentials.push({ id: 2, fileKey: photoKey, documentType: "citizenship" });
  await assert.rejects(files.signProfilePhoto(photoKey), /Private identity files/);
  await assert.rejects(files.signView(photoKey), /Private identity files/);
  assert.equal(fixture.signatures.length, 1);
});

test("ordinary files retain ten-minute links while DB failures issue no identity or cached avatar links", async () => {
  const { fixture, files } = await isolate();
  assert.ok(await files.signView(photoKey, "Class handout.jpg"));
  assert.equal(fixture.signatures[0].expiresIn, 600);
  assert.match(fixture.signatures[0].input.ResponseContentDisposition!, /Class handout/);
  await files.signProfilePhoto(photoKey);
  fixture.failDb = true;
  await assert.rejects(files.signView(idKey), /database outage/);
  await assert.rejects(files.signLegacyIdentityReview(idKey, 10), /database outage/);
  await assert.rejects(files.signProfilePhoto(photoKey), /database outage/);
  await assert.rejects(files.verifyUpload(idKey, 7), /database outage/);
  assert.equal(fixture.signatures.length, 2);
  assert.equal(fixture.objectCalls.length, 0);
});

test("legacy operator storage preview works and bypasses neither revoked role nor outage", async () => {
  const { fixture, open } = await isolate();
  const preview = await open(idKey, 10);
  assert.equal(preview.statusCode, 200);
  assert.equal((preview.body as { url: string }).url, "https://synthetic.invalid/review");
  assert.equal(preview.headers["Cache-Control"], "private, no-store");
  assert.equal(preview.headers["Referrer-Policy"], "no-referrer");
  assert.equal((await open(idKey, 7, "teacher")).statusCode, 403); // Even the uploader cannot share an ID.
  fixture.users[1].role = "teacher";
  assert.equal((await open(idKey, 10, "admin")).statusCode, 403); // Stale admin JWT.
  fixture.users[1].role = "admin";
  fixture.users[1].suspendedAt = new Date();
  assert.equal((await open(idKey, 10)).statusCode, 403);
  fixture.failDb = true;
  assert.equal((await open(idKey, 10)).statusCode, 503);
  assert.equal(fixture.signatures.length, 1);
});

test("disabled and first-password operators cannot review IDs even with a valid admin JWT", async () => {
  for (const account of [
    { userId: 10, disabledAt: new Date(), mustChangePassword: false },
    { userId: 10, disabledAt: null, mustChangePassword: true },
  ]) {
    const { fixture, files, open } = await isolate();
    fixture.env.OPERATOR_SITE_ENFORCEMENT_ENABLED = "true";
    fixture.operators.push(account);
    assert.equal(await files.signLegacyIdentityReview(idKey, 10), null);
    assert.equal((await open(idKey, 10, "admin")).statusCode, 403);
    fixture.env.OPERATOR_SITE_ENFORCEMENT_ENABLED = "false";
    assert.equal(await files.signLegacyIdentityReview(idKey, 10), null); // Record restrictions never depend on a flag.
    assert.equal(fixture.signatures.length, 0);
  }
});

test("strict operator enforcement refuses missing accounts but allows an active password-rotated operator", async () => {
  const { fixture, files, open } = await isolate();
  fixture.env.OPERATOR_SITE_ENFORCEMENT_ENABLED = "true";
  assert.equal(await files.signLegacyIdentityReview(idKey, 10), null);
  assert.equal((await open(idKey, 10)).statusCode, 403);
  fixture.operators.push({ userId: 10, disabledAt: null, mustChangePassword: false });
  assert.ok(await files.signLegacyIdentityReview(idKey, 10));
  assert.equal((await open(idKey, 10)).statusCode, 200);
  assert.equal(fixture.signatures.length, 2);
});

test("ordinary participant attachment reads never enter operator-account authorization", async () => {
  const { fixture, open } = await isolate();
  fixture.env.OPERATOR_SITE_ENFORCEMENT_ENABLED = "true";
  fixture.operators.push({ userId: 7, disabledAt: new Date(), mustChangePassword: true });
  assert.equal((await open(photoKey, 7, "teacher")).statusCode, 200);
  assert.equal(fixture.signatures[0].expiresIn, 600);
  assert.equal(fixture.queryTables.includes("operators"), false);
});

test("the ordinary-link privacy assertion goes red if its guard is deliberately removed in memory", async () => {
  const { files } = await isolate(source => {
    const broken = source.replace(/if \(await isLegacyIdentityFile\(key\)\) throw new Error\("Private identity files cannot use ordinary attachment links\."\);/, "");
    assert.notEqual(broken, source, "Mutation must remove the actual signer guard");
    return broken;
  });
  await assert.rejects(assert.rejects(files.signView(idKey), /Private identity files/), /Missing expected rejection/);
});
