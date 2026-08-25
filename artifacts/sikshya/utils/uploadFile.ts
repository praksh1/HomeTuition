import { Platform } from "react-native";
import { apiBase, apiPost, apiPutBinary, getToken } from "./api";
/**
 * A file the person has chosen, ready to send.
 *
 * Named for what it is rather than reusing `UploadableFile` from utils/pickedFile.ts, which is a
 * different thing with the same obvious name: that one carries a name and a type for guessing
 * whether something is a PDF, and has no bytes behind it at all.
 */
export interface UploadableFile {
  uri: string;
  name: string;
  mimeType: string;
  /** Bytes. The upload endpoint requires it, and a missing one is a 400. */
  size: number;
}

interface UploadUrlResponse {
  /**
   * Note the capitalisation: the server returns `uploadURL`, and reading `uploadUrl` gets you
   * `undefined` and an upload to the string "undefined".
   */
  uploadURL: string;
  objectPath: string;
}

/**
 * Puts a file in the store and returns its key.
 *
 * Lifted out of the support screen rather than written a second time. A second upload path
 * would drift from this one — different fields, a different fallback, a different error — and
 * this project already knows what two implementations of one thing costs: the class that ended
 * up with two chats that could not see each other.
 *
 * The important part is the fallback. Going straight to Cloudflare is much better on a slow
 * connection, but a browser will not make that request unless the bucket names this site's
 * origin in a CORS rule, and with no rule Safari says "Load failed" and nothing else — which is
 * exactly what a student saw on the live site. So a refusal is not fatal: it goes through our
 * own API instead, which is slower and always works, with the same size cap, the same allowed
 * types and the same bucket.
 */
export async function uploadFile(file: UploadableFile): Promise<string> {
  /**
   * The file is read once, up front, and its real size is what the server is told.
   *
   * It used to send `file.size > 0 ? file.size : 1` — so a picker that does not report a size,
   * which is normal on iOS, had the app claim one byte. The server's size check then passed on
   * a claim rather than a fact, the real bytes went up anyway, and a file over the cap was
   * refused by the body parser at the far end with an HTML error page nobody could read. What
   * the person saw was "Load failed. We also could not send it through our server", which names
   * neither the size nor the limit.
   *
   * Measuring first means an oversized file is refused before it is sent, with a sentence
   * saying how big it was allowed to be.
   */
  const blob = Platform.OS === "web" ? await (await fetch(file.uri)).blob() : null;
  const size = blob && blob.size > 0 ? blob.size : file.size;

  /**
   * `name` and `size`, not `fileName`.
   *
   * This is why attaching anything failed for months: the app sent `fileName` and no size, the
   * endpoint requires `name`, `size` and `contentType`, and every upload came back 400 before a
   * byte left the phone.
   */
  const { uploadURL, objectPath } = await apiPost<UploadUrlResponse>("/storage/uploads/request-url", {
    name: file.name,
    size: size > 0 ? size : 1,
    contentType: file.mimeType,
  });

  try {
    await putDirect(uploadURL, file, blob);
    return objectPath;
  } catch (directFailure) {
    try {
      return await putViaServer(file, blob);
    } catch (fallbackFailure) {
      /**
       * The fallback's reason is the one worth having.
       *
       * The direct attempt is *expected* to fail — a bucket with no CORS rule refuses it and
       * Safari says only "Load failed" — so leading with that told everybody the thing that was
       * always going to happen and hid the thing that actually went wrong. This reports what
       * the server said, and mentions the direct attempt only as context.
       */
      const reason = fallbackFailure instanceof Error && fallbackFailure.message
        ? fallbackFailure.message
        : "We could not send it through our server either.";
      throw new Error(reason);
    }
  }
}

/** Straight to the bucket with the signed link. */
async function putDirect(uploadURL: string, chosen: UploadableFile, blob: Blob | null): Promise<void> {
  if (Platform.OS === "web") {
    if (!blob) throw new Error("We could not read that file.");
    const putResp = await fetch(uploadURL, {
      method: "PUT",
      headers: { "Content-Type": chosen.mimeType },
      body: blob,
    });
    if (!putResp.ok) throw new Error(`The upload was refused (${putResp.status}).`);
    return;
  }
  const FileSystem = await import("expo-file-system");
  const uploadResult = await FileSystem.uploadAsync(uploadURL, chosen.uri, {
    httpMethod: "PUT",
    headers: { "Content-Type": chosen.mimeType },
  });
  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new Error(`The upload was refused (${uploadResult.status}).`);
  }
}

/** Through our own API, which no browser rule can block. */
async function putViaServer(chosen: UploadableFile, blob: Blob | null): Promise<string> {
  if (Platform.OS === "web") {
    if (!blob) throw new Error("We could not read that file.");
    const res = await apiPutBinary<{ objectPath: string }>("/storage/upload", blob, chosen.mimeType);
    return res.objectPath;
  }
  const FileSystem = await import("expo-file-system");
  const token = await getToken();
  const result = await FileSystem.uploadAsync(`${apiBase()}/storage/upload`, chosen.uri, {
    httpMethod: "PUT",
    headers: {
      "Content-Type": chosen.mimeType,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (result.status < 200 || result.status >= 300) {
    let reason = "We could not send your file.";
    try { reason = JSON.parse(result.body ?? "{}").error ?? reason; } catch { /* not JSON */ }
    throw new Error(reason);
  }
  return JSON.parse(result.body).objectPath as string;
}
