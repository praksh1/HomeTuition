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
   * `name` and `size`, not `fileName`.
   *
   * This is why attaching anything failed for months: the app sent `fileName` and no size, the
   * endpoint requires `name`, `size` and `contentType`, and every upload came back 400 before a
   * byte left the phone.
   */
  const { uploadURL, objectPath } = await apiPost<UploadUrlResponse>("/storage/uploads/request-url", {
    name: file.name,
    size: file.size > 0 ? file.size : 1,
    contentType: file.mimeType,
  });

  try {
    await putDirect(uploadURL, file);
    return objectPath;
  } catch (directFailure) {
    try {
      return await putViaServer(file);
    } catch (fallbackFailure) {
      // The direct failure is the more informative of the two, so it is the one reported —
      // unless the server gave a real reason, which beats a network shrug.
      throw fallbackFailure instanceof Error && /larger than|photos and PDFs/i.test(fallbackFailure.message)
        ? fallbackFailure
        : new Error(
            directFailure instanceof Error && directFailure.message
              ? `${directFailure.message}. We also could not send it through our server.`
              : "We could not upload your file.",
          );
    }
  }
}

/** Straight to the bucket with the signed link. */
async function putDirect(uploadURL: string, chosen: UploadableFile): Promise<void> {
  if (Platform.OS === "web") {
    const fileResp = await fetch(chosen.uri);
    const blob = await fileResp.blob();
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
async function putViaServer(chosen: UploadableFile): Promise<string> {
  if (Platform.OS === "web") {
    const fileResp = await fetch(chosen.uri);
    const blob = await fileResp.blob();
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
