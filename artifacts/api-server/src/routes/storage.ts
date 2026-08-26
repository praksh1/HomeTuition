import express, { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, disputesTable } from "@workspace/db";
import { RequestUploadUrlBody, RequestUploadUrlResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { mayOpenHomeworkFile } from "../lib/homeworkAccess";
import { mayOpenMessageFile } from "../lib/messageAccess";
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  describeStorageFailure,
  isFileStoreConfigured,
  ownerOf,
  putObject,
  signUpload,
  signView,
} from "../lib/fileStore";

/**
 * Getting a file into the product, and back out of it.
 *
 * Two endpoints and no bytes. The phone asks for a link, uploads straight to Cloudflare R2,
 * and hands us back the key; later, somebody entitled to see the file is redirected to a
 * short-lived link. The server never carries the file, which matters on a platform whose users
 * are on slow connections and whose backend is one small box.
 *
 * The Replit code that used to live here is gone. It asked a credential sidecar on
 * `127.0.0.1:1106` for a token, which exists on Replit and nowhere else — so on Railway every
 * attachment failed, and had failed since the day the app moved.
 */

const router: IRouter = Router();

/**
 * Ask for somewhere to put one file.
 *
 * Signed in only, and signed for one content type: a link issued for a JPEG cannot be used to
 * upload something else. The key comes back in `objectPath`, which is what the caller stores.
 */
router.post("/storage/uploads/request-url", requireAuth, async (req: Request, res: Response) => {
  /**
   * The request is judged before the server's own configuration is.
   *
   * A malformed request is the caller's to fix and the answer is the same whether or not a
   * bucket exists, so it must not change to 503 the day one is added — a test caught exactly
   * that, guarding the field names that made every attachment fail for months.
   */
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A file name, size and type are all required." });
    return;
  }

  const { name, size, contentType } = parsed.data;

  if (!isFileStoreConfigured()) {
    /**
     * Said plainly rather than failing obscurely.
     *
     * 503 and not 500: nothing is broken, the bucket simply has not been set up. The app shows
     * this to the person, so "my photo would not attach" has an answer instead of being a
     * mystery — which is exactly what it was before.
     */
    res.status(503).json({
      error: "File uploads are not set up on this server yet.",
      unavailable: true,
    });
    return;
  }

  if (!ALLOWED_UPLOAD_TYPES.includes(contentType as (typeof ALLOWED_UPLOAD_TYPES)[number])) {
    res.status(400).json({
      error: "Only photos and PDFs can be attached.",
      allowed: ALLOWED_UPLOAD_TYPES,
    });
    return;
  }

  /**
   * The size the client claims, refused early as a courtesy.
   *
   * It is only a claim — the real check happens once the file has landed, in `verifyUpload`,
   * because that reads what is actually in the bucket. Refusing here saves somebody on a poor
   * connection from spending four minutes uploading something that will be rejected.
   */
  if (size > MAX_UPLOAD_BYTES) {
    res.status(400).json({
      error: `That file is larger than ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
      maxBytes: MAX_UPLOAD_BYTES,
    });
    return;
  }

  try {
    const signed = await signUpload({ kind: "evidence", userId: req.user!.userId, contentType });
    if (!signed) {
      res.status(503).json({ error: "File uploads are not set up on this server yet.", unavailable: true });
      return;
    }
    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL: signed.uploadURL,
        objectPath: signed.key,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    const failure = describeStorageFailure(error);
    req.log.error(
      { err: error, code: failure.code, advice: failure.advice },
      "could not sign an upload",
    );
    res.status(500).json({ error: failure.publicMessage, code: failure.code });
  }
});

/**
 * Upload through this server, when the phone cannot reach the bucket directly.
 *
 * The browser refuses a cross-origin PUT to R2 unless the bucket names the site's origin in a
 * CORS rule, and reports the refusal as "Load failed" with no further detail. That is what a
 * student saw the first time they attached a photo to a report on the live site.
 *
 * Adding the CORS rule is the right fix and makes the fast path work. This is the path that
 * works regardless — including after the app is renamed, which is coming, and which would
 * otherwise silently break a rule naming the old domain.
 *
 * Bounded deliberately: one file, at most `MAX_UPLOAD_BYTES`, of a type on the list, from
 * somebody signed in. Express refuses anything larger before it reaches this handler.
 */
router.put(
  "/storage/upload",
  requireAuth,
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  async (req: Request, res: Response) => {
    const contentType = String(req.headers["content-type"] ?? "").split(";")[0].trim();
    if (!ALLOWED_UPLOAD_TYPES.includes(contentType as (typeof ALLOWED_UPLOAD_TYPES)[number])) {
      res.status(400).json({ error: "Only photos and PDFs can be attached." });
      return;
    }

    if (!isFileStoreConfigured()) {
      res.status(503).json({ error: "File uploads are not set up on this server yet.", unavailable: true });
      return;
    }

    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "That file arrived empty." });
      return;
    }
    if (body.length > MAX_UPLOAD_BYTES) {
      res.status(400).json({
        error: `That file is larger than ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
      });
      return;
    }

    try {
      const key = await putObject({ kind: "evidence", userId: req.user!.userId, contentType, body });
      if (!key) {
        res.status(503).json({ error: "File uploads are not set up on this server yet.", unavailable: true });
        return;
      }
      res.status(201).json({ objectPath: key });
    } catch (error) {
      /**
       * Say which failure this is, rather than "please try again".
       *
       * Trying again does not fix a read-only API token, and the owner met exactly that on the
       * live site with no way to tell a missing bucket from a wrong key. The reason goes to the
       * log with the code that names it; the reporter gets a sentence that does not mention
       * configuration, because a student attaching a photo cannot act on it either way.
       */
      const failure = describeStorageFailure(error);
      req.log.error(
        { err: error, code: failure.code, advice: failure.advice },
        "could not store an upload sent through the server",
      );
      res.status(502).json({ error: failure.publicMessage, code: failure.code });
    }
  },
);

/**
 * Look at a file somebody attached.
 *
 * Two people may: whoever uploaded it, and a support agent — which is the whole point of an
 * attachment on a support report. Anybody else is refused, including a teacher who happens to
 * be named in the ticket, because a photo attached to a complaint is not theirs to browse.
 *
 * The reply is a redirect to a link that dies in ten minutes. Nothing durable is handed out, so
 * a URL that ends up in a screenshot or a chat log stops working almost immediately.
 */
router.get("/storage/file", requireAuth, async (req: Request, res: Response) => {
  const key = String(req.query.key ?? "");
  if (!key) { res.status(400).json({ error: "Which file?" }); return; }

  if (!isFileStoreConfigured()) {
    res.status(503).json({ error: "File uploads are not set up on this server yet.", unavailable: true });
    return;
  }

  const user = req.user!;
  const uploader = ownerOf(key);
  if (uploader === null) { res.status(400).json({ error: "That is not a file we hold." }); return; }

  let allowed = uploader === user.userId || user.role === "admin";

  /**
   * And the teacher a report is *about* is still not allowed.
   *
   * Checked against the ticket rather than assumed, so that if attachments are ever used
   * somewhere other than a dispute, this refuses by default rather than guessing.
   */
  if (!allowed) {
    const [attached] = await db
      .select({ id: disputesTable.id })
      .from(disputesTable)
      .where(and(eq(disputesTable.evidenceUrl, key), eq(disputesTable.userId, user.userId)))
      .limit(1);
    allowed = !!attached;
  }

  /**
   * Homework, which is the second thing to keep files here and needed its own answer.
   *
   * A student has to be able to open the question sheet their teacher uploaded, and a teacher
   * has to be able to open the answers their students hand in — neither of them is the
   * uploader of the other's file. Kept in `lib/homeworkAccess.ts` rather than inlined here so
   * the rule sits with the tables it is about, and so this route keeps refusing by default.
   */
  if (!allowed) allowed = await mayOpenHomeworkFile(key, user.userId);

  /**
   * A file sent in a conversation, which is the third thing to keep files here.
   *
   * Somebody sending a photo to their teacher is not the teacher, so nothing above lets the
   * teacher open it. Without this the bubble appeared and the file did not — and it would
   * have looked fine to whoever tested it, because a sender can always open their own upload.
   */
  if (!allowed) allowed = await mayOpenMessageFile(key, user.userId);

  if (!allowed) { res.status(403).json({ error: "You cannot open this file." }); return; }

  try {
    const url = await signView(key);
    if (!url) { res.status(503).json({ error: "File uploads are not set up on this server yet." }); return; }
    /**
     * The link comes back as JSON, not as a 302.
     *
     * A redirect reads well in a browser address bar and is useless to the app: `fetch` with
     * `redirect: "manual"` gives a browser an opaque response with no readable Location, so the
     * agent's "Open the attachment" would have failed on web while passing in Node — where
     * manual redirects *are* readable. A test that only ever ran in Node would have missed it.
     *
     * The bytes still never pass through here. The app opens this link itself, and it dies in
     * ten minutes.
     */
    res.json({ url });
  } catch (error) {
    req.log.error({ err: error, key }, "could not sign a file view");
    res.status(500).json({ error: "Could not open that file." });
  }
});

export default router;
