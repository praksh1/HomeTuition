import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { sealIdentity, openIdentity } from "./identityCrypto.ts";
import { IDENTITY_MAX_BYTES } from "./identityPolicy.ts";
import { resolveEndpoint } from "./storageEndpoint.ts";

export function identityCollectionEnabled(): boolean { return process.env.IDENTITY_COLLECTION_ENABLED === "true"; }
export function identityEncryptionKey(): string {
  const key = process.env.IDENTITY_ENCRYPTION_KEY_V1 ?? "";
  if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error("Private identity storage is not configured.");
  return key;
}
function storage() {
  const bucket = process.env.IDENTITY_R2_BUCKET?.trim();
  const accessKeyId = process.env.IDENTITY_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.IDENTITY_R2_SECRET_ACCESS_KEY?.trim();
  const { endpoint } = resolveEndpoint(process.env.R2_ACCOUNT_ID ?? "", process.env.R2_ENDPOINT ?? "");
  if (!bucket || bucket === process.env.R2_BUCKET?.trim() || !accessKeyId || !secretAccessKey || !endpoint || new URL(endpoint).protocol !== "https:") throw new Error("Private identity storage is not configured.");
  identityEncryptionKey();
  return { bucket, client: new S3Client({ region: "auto", endpoint, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 2 }) };
}
export function identityStorageReady(): boolean { try { const { client } = storage(); client.destroy(); return true; } catch { return false; } }

/** Deliberately not accepted by fileStore.ownerOf or any shared attachment route. */
export function validIdentityKey(key: string): boolean { return /^identity\/[1-9]\d*\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.sealed$/.test(key); }
function assertKey(key: string) { if (!validIdentityKey(key)) throw new Error("Invalid private document key."); }

export function identityDocumentType(bytes: Buffer): "image/png" | "image/jpeg" | "application/pdf" | null {
  if (!bytes.length || bytes.length > IDENTITY_MAX_BYTES) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  return null;
}
/** Bytes encrypted before R2. Original names and legal details never enter object metadata. */
export async function putIdentityFile(key: string, bytes: Buffer): Promise<void> {
  assertKey(key);
  const contentType = identityDocumentType(bytes);
  if (!contentType) throw new Error("Choose a JPEG, PNG or PDF no larger than 8 MB.");
  const envelope = sealIdentity(JSON.stringify({ contentType, base64: bytes.toString("base64") }), identityEncryptionKey(), `file:${key}`);
  const { bucket, client } = storage();
  try { await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: envelope, ContentType: "application/octet-stream", CacheControl: "no-store" }), { abortSignal: AbortSignal.timeout(30_000) }); }
  finally { client.destroy(); }
}
/** Caller must commit its sensitive-read audit entry BEFORE calling this. No presigned public URL. */
export async function readIdentityFile(key: string): Promise<{ bytes: Buffer; contentType: string }> {
  assertKey(key);
  const { bucket, client } = storage();
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(30_000) });
    if (!result.Body || !result.ContentLength || result.ContentLength > IDENTITY_MAX_BYTES * 2) throw new Error("Invalid private document.");
    const decoded = JSON.parse(openIdentity(await result.Body.transformToString(), identityEncryptionKey(), `file:${key}`));
    const bytes = Buffer.from(decoded.base64, "base64");
    const contentType = identityDocumentType(bytes);
    if (!contentType || contentType !== decoded.contentType) throw new Error("Invalid private document.");
    return { bytes, contentType };
  } finally { client.destroy(); }
}
/** Unlike ordinary attachment cleanup, failure MUST reach the retention job. */
export async function deleteIdentityFile(key: string): Promise<void> {
  assertKey(key);
  const { bucket, client } = storage();
  try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(30_000) }); }
  finally { client.destroy(); }
}
