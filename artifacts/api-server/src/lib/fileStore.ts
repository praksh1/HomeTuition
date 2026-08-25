import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "./logger";
import { describeStorageFailure, type StorageFailure } from "./storageErrors";
import { resolveEndpoint } from "./storageEndpoint";

// Re-exported so callers have one place to import storage things from.
export { describeStorageFailure, type StorageFailure };

/**
 * Where uploaded files go: Cloudflare R2.
 *
 * The app was born on Replit and its storage code talked to a credential sidecar on
 * `127.0.0.1:1106`. That does not exist on Railway, so **attaching a file to a support report
 * has never once worked** — see ISSUES.md F1. This replaces it.
 *
 * R2 speaks the S3 API, so this is the ordinary AWS SDK pointed at Cloudflare. Two reasons it
 * was chosen over S3 itself: there are no egress charges ever, which is the line item that
 * surprises people, and the account is already there for the web app.
 *
 * **The server never touches the bytes.** It signs a URL and the phone uploads straight to
 * Cloudflare. A teacher on a slow connection in Nepal uploading a photo of a marked exam paper
 * should not have it travel to a server in Europe and back out again, and this box should not
 * fall over because six people attached videos at once.
 *
 * ### Configured or not, decided by the environment
 *
 * Like payments and email in this codebase, the mode follows from what exists rather than from
 * a flag. With no credentials, uploads are *unavailable* and every caller is told so plainly —
 * which is what happens today, except that today nobody is told.
 */

/** The largest file anybody may attach. Ten megabytes is a long photo of a page. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * What may be uploaded.
 *
 * Deliberately short. This exists for evidence in a dispute — a photo of a page, a screenshot,
 * a PDF — and an open-ended list on a platform used by children is a liability rather than a
 * feature. HEIC is here because it is what an iPhone produces by default.
 */
export const ALLOWED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;

/** How long an upload link is good for. Long enough for a slow phone, short enough to be useless later. */
const UPLOAD_URL_MINUTES = 15;
/** How long a view link is good for. Short: it is handed out per view, not stored. */
const VIEW_URL_MINUTES = 10;

export interface FileStoreConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Overridable so the tests can point this at a local stand-in. */
  endpoint: string;
  /** Set when a setting had to be interpreted rather than taken as given. */
  note?: string | null;
}

export function fileStoreConfig(): FileStoreConfig | null {
  const accountId = (process.env.R2_ACCOUNT_ID ?? "").trim();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY ?? "").trim();
  const bucket = (process.env.R2_BUCKET ?? "").trim();
  if (!accessKeyId || !secretAccessKey || !bucket) return null;

  /**
   * Where the bucket is, worked out rather than concatenated. See `storageEndpoint.ts`.
   *
   * This used to be `https://${accountId}.r2.cloudflarestorage.com`, which is right only if
   * what is in the setting is a bare account id. Cloudflare's bucket page shows an S3 API URL
   * — the obvious thing to copy — and pasting that built `https://https://…`, a URL whose
   * hostname is the literal string `https`. That is absorbed now instead of being fatal.
   */
  const resolved = resolveEndpoint(accountId, process.env.R2_ENDPOINT ?? "");
  if (!resolved.endpoint) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint: resolved.endpoint, note: resolved.note };
}

/**
 * Say once, at boot, if a setting had to be interpreted.
 *
 * Silently correcting somebody's configuration and never mentioning it is how a typo survives
 * for months: everything works, nobody knows the value is wrong, and the day it matters the
 * message makes no sense.
 */
let notedOnce = false;
export function noteStorageConfig(): void {
  if (notedOnce) return;
  notedOnce = true;
  const config = fileStoreConfig();
  if (!config) {
    logger.info("file uploads are switched off — R2 is not configured");
    return;
  }
  if (config.note) logger.warn({ endpoint: config.endpoint }, config.note);
  else logger.info({ endpoint: config.endpoint }, "file storage is configured");
}

export function isFileStoreConfigured(): boolean {
  return fileStoreConfig() !== null;
}

let cached: { client: S3Client; config: FileStoreConfig } | null = null;

function client(): { client: S3Client; config: FileStoreConfig } | null {
  const config = fileStoreConfig();
  if (!config) return null;
  // Rebuilt if the environment changed under us, which only happens in tests.
  if (!cached || cached.config.endpoint !== config.endpoint || cached.config.bucket !== config.bucket) {
    cached = {
      config,
      client: new S3Client({
        // R2 has one region and calls it "auto". The SDK still requires the field.
        region: "auto",
        endpoint: config.endpoint,
        // R2 serves buckets by path, not by subdomain.
        forcePathStyle: true,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      }),
    };
  }
  return cached;
}

/** The extension for a type we accept, so a downloaded file opens in the right thing. */
function extensionFor(contentType: string): string {
  switch (contentType) {
    case "image/jpeg": return ".jpg";
    case "image/png": return ".png";
    case "image/webp": return ".webp";
    case "image/heic": return ".heic";
    case "image/heif": return ".heif";
    case "application/pdf": return ".pdf";
    default: return "";
  }
}

export type UploadKind = "evidence";

/**
 * The name a file is stored under.
 *
 * `evidence/{userId}/{uuid}.{ext}`. The owner is in the path on purpose: it makes "may this
 * person see this file" answerable from the key alone, without trusting a database row that
 * may have been edited. The uuid means no two uploads can collide and nobody can guess
 * somebody else's file by trying names.
 *
 * The original filename is deliberately **not** used. People name files things like
 * `passport-scan.jpg`, and a name that travels into a URL is a name that leaks.
 */
export function makeKey(kind: UploadKind, userId: number, contentType: string): string {
  return `${kind}/${userId}/${randomUUID()}${extensionFor(contentType)}`;
}

/** Who a key belongs to, read back out of it. Null when the key is not one of ours. */
export function ownerOf(key: string): number | null {
  const match = /^evidence\/(\d+)\//.exec(key);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) ? id : null;
}

export interface SignedUpload {
  uploadURL: string;
  key: string;
}

/**
 * A link the phone can PUT one file to, and nothing else.
 *
 * The content type is part of the signature, so a link issued for a JPEG cannot be used to
 * upload an executable. The size is checked when the file is *attached* rather than here —
 * see `verifyUpload` — because a presigned PUT that pins Content-Length has to match the
 * client's byte count exactly, and a phone that reports a file's size as 0 would then be
 * unable to upload at all.
 */
export async function signUpload(args: {
  kind: UploadKind;
  userId: number;
  contentType: string;
}): Promise<SignedUpload | null> {
  const c = client();
  if (!c) return null;

  const key = makeKey(args.kind, args.userId, args.contentType);
  const uploadURL = await getSignedUrl(
    c.client,
    new PutObjectCommand({ Bucket: c.config.bucket, Key: key, ContentType: args.contentType }),
    {
      expiresIn: UPLOAD_URL_MINUTES * 60,
      /**
       * `content-type` has to be named here or it is **not signed**.
       *
       * Passing ContentType to the command sets the header but the presigner signs only `host`
       * by default, so the link would happily accept an executable. A test caught it: the same
       * link uploaded an `application/x-msdownload` and the stand-in said 200.
       *
       * With it signed, the client must send exactly this type or the signature fails — which
       * is what makes the check at the top of the route worth anything.
       */
      signableHeaders: new Set(["content-type"]),
    },
  );
  return { uploadURL, key };
}

/**
 * Put a file into the bucket from here, rather than from the phone.
 *
 * The slower path, and the one that always works. A browser uploading straight to R2 needs the
 * bucket to allow its origin — and a bucket with no CORS rule simply refuses, which a browser
 * reports as "Load failed" and nothing more. That is what happened on the live site the first
 * time somebody attached a photo.
 *
 * So this exists as a fallback the app reaches for when the direct upload is refused. It costs
 * a round trip through this server, which on a Nepali connection is real, and it is bounded by
 * the same size cap. The direct path stays the default because phone-to-Cloudflare beats
 * phone-to-Railway-to-Cloudflare every time — this is only the safety net.
 *
 * It also means the product does not quietly break the day the domain changes, which it will:
 * the name is not settled, and a CORS rule naming the old origin would stop working silently.
 */
export async function putObject(args: {
  kind: UploadKind;
  userId: number;
  contentType: string;
  body: Buffer;
}): Promise<string | null> {
  const c = client();
  if (!c) return null;
  const key = makeKey(args.kind, args.userId, args.contentType);
  await c.client.send(new PutObjectCommand({
    Bucket: c.config.bucket,
    Key: key,
    Body: args.body,
    ContentType: args.contentType,
  }));
  return key;
}

/** A short-lived link to look at one file. Handed out per view, never stored. */
export async function signView(key: string): Promise<string | null> {
  const c = client();
  if (!c) return null;
  return getSignedUrl(
    c.client,
    new GetObjectCommand({ Bucket: c.config.bucket, Key: key }),
    { expiresIn: VIEW_URL_MINUTES * 60 },
  );
}

export interface UploadFacts {
  exists: boolean;
  size: number;
  contentType: string;
}

/** What is actually in the bucket under this key. */
export async function describeUpload(key: string): Promise<UploadFacts | null> {
  const c = client();
  if (!c) return null;
  try {
    const head = await c.client.send(new HeadObjectCommand({ Bucket: c.config.bucket, Key: key }));
    return {
      exists: true,
      size: Number(head.ContentLength ?? 0),
      contentType: String(head.ContentType ?? ""),
    };
  } catch {
    return { exists: false, size: 0, contentType: "" };
  }
}

export async function deleteUpload(key: string): Promise<void> {
  const c = client();
  if (!c) return;
  try {
    await c.client.send(new DeleteObjectCommand({ Bucket: c.config.bucket, Key: key }));
  } catch (err) {
    // A file we could not delete is litter, not a failure the caller can do anything about.
    logger.warn({ err, key }, "could not delete an upload");
  }
}

export type UploadVerdict =
  | { ok: true; size: number; contentType: string }
  | { ok: false; reason: string };

/**
 * Check a file that has actually landed, before it is allowed to become evidence.
 *
 * This is where the size and the type are truly enforced, rather than at the point of signing.
 * Anything the client said before uploading was a claim; this reads what is really in the
 * bucket. A file that is too big or of the wrong type is deleted rather than left to sit in
 * somebody's bucket costing them money.
 */
export async function verifyUpload(key: string, userId: number): Promise<UploadVerdict> {
  if (ownerOf(key) !== userId) {
    return { ok: false, reason: "That file does not belong to you." };
  }
  const facts = await describeUpload(key);
  if (!facts) return { ok: false, reason: "File uploads are not set up on this server." };
  if (!facts.exists) return { ok: false, reason: "That file did not finish uploading." };

  if (facts.size > MAX_UPLOAD_BYTES) {
    await deleteUpload(key);
    return {
      ok: false,
      reason: `That file is larger than ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
    };
  }
  if (!ALLOWED_UPLOAD_TYPES.includes(facts.contentType as (typeof ALLOWED_UPLOAD_TYPES)[number])) {
    await deleteUpload(key);
    return { ok: false, reason: "Only photos and PDFs can be attached." };
  }
  return { ok: true, size: facts.size, contentType: facts.contentType };
}

export type StorageCheck =
  | { ok: true; bucket: string; steps: string[]; endpoint: string; note: string | null }
  | { ok: false; failedAt: string; failure: StorageFailure; steps: string[]; endpoint?: string; note?: string | null };

/**
 * Actually write, read and delete a small object, and report which step failed.
 *
 * Configuration that merely *exists* proves nothing — every variable can be present and the
 * token still be read-only. This is the difference between "the settings look right" and "a
 * file can be stored", and only the second one matters to somebody attaching a photo.
 */
export async function checkStorage(): Promise<StorageCheck> {
  const steps: string[] = [];
  const c = client();
  if (!c) {
    return {
      ok: false,
      failedAt: "configuration",
      steps,
      failure: {
        code: "NotConfigured",
        detail: "",
        advice:
          "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_ACCOUNT_ID must all be set " +
          "on the API service. Uploads are switched off until they are.",
        publicMessage: "File uploads are not set up on this server yet.",
      },
    };
  }

  const key = `health/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  const body = Buffer.from("storage check");

  try {
    await c.client.send(new PutObjectCommand({
      Bucket: c.config.bucket, Key: key, Body: body, ContentType: "text/plain",
    }));
    steps.push("write");
  } catch (err) {
    return {
      ok: false, failedAt: "write", failure: describeStorageFailure(err), steps,
      endpoint: c.config.endpoint, note: c.config.note ?? null,
    };
  }

  try {
    const head = await c.client.send(new HeadObjectCommand({ Bucket: c.config.bucket, Key: key }));
    if (Number(head.ContentLength ?? 0) !== body.length) {
      return {
        ok: false, failedAt: "read", steps,
        failure: {
          code: "SizeMismatch", detail: `wrote ${body.length}, read back ${head.ContentLength}`,
          advice: "The bucket accepted the file but read it back at a different size.",
          publicMessage: "We could not save that file just now. Please try again in a moment.",
        },
      };
    }
    steps.push("read");
  } catch (err) {
    return { ok: false, failedAt: "read", failure: describeStorageFailure(err), steps };
  }

  try {
    await c.client.send(new DeleteObjectCommand({ Bucket: c.config.bucket, Key: key }));
    steps.push("delete");
  } catch (err) {
    // Writing and reading is what uploads need; a bucket that cannot delete still works, but
    // the failed cleanups become litter that costs money, so it is reported rather than hidden.
    return { ok: false, failedAt: "delete", failure: describeStorageFailure(err), steps };
  }

  return { ok: true, bucket: c.config.bucket, steps, endpoint: c.config.endpoint, note: c.config.note ?? null };
}

/** Which R2 settings are present. Names and presence only — never a value. */
export function storageSettingsPresent(): Record<string, boolean> {
  return {
    R2_ACCOUNT_ID: !!process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: !!process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: !!process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: !!process.env.R2_BUCKET,
    R2_ENDPOINT: !!process.env.R2_ENDPOINT,
  };
}
