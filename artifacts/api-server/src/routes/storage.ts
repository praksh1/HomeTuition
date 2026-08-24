import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, disputesTable } from "@workspace/db";
import { RequestUploadUrlBody, RequestUploadUrlResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  isFileStoreConfigured,
  ownerOf,
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
    req.log.error({ err: error }, "could not sign an upload");
    res.status(500).json({ error: "Could not prepare the upload. Please try again." });
  }
});

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

  if (!allowed) { res.status(403).json({ error: "You cannot open this file." }); return; }

  try {
    const url = await signView(key);
    if (!url) { res.status(503).json({ error: "File uploads are not set up on this server yet." }); return; }
    // 302 rather than proxying: the bytes go from Cloudflare to the viewer, not through here.
    res.redirect(302, url);
  } catch (error) {
    req.log.error({ err: error, key }, "could not sign a file view");
    res.status(500).json({ error: "Could not open that file." });
  }
});

export default router;
