import { Platform } from "react-native";
import { apiBase, apiPutBinary, getToken } from "./api";
import type { UploadableFile } from "./uploadFile";

import type { IdentitySummary } from "./identityStatus";
export { rejectionExplanation, type IdentitySummary, type IdentityStatusResponse } from "./identityStatus";

/** Never pass private documents through the general attachment/presigned-link service. */
export async function uploadIdentityDocument(id: number, file: UploadableFile): Promise<{ verification: IdentitySummary }> {
  if (Platform.OS === "web") {
    const blob = await (await fetch(file.uri)).blob();
    if (!blob.size || blob.size > 8 * 1024 * 1024) throw Error("Choose a document no larger than 8 MB.");
    return apiPutBinary(`/identity-verification/${id}/document`, blob, "application/octet-stream");
  }
  const fs = await import("expo-file-system/legacy");
  const info = await fs.getInfoAsync(file.uri);
  if (!info.exists || !info.size || info.size > 8 * 1024 * 1024) throw Error("Choose a readable document no larger than 8 MB.");
  const token = await getToken();
  if (!token) throw Error("Sign in again before uploading your document.");
  const result = await fs.uploadAsync(`${apiBase()}/identity-verification/${id}/document`, file.uri, {
    httpMethod: "PUT", uploadType: fs.FileSystemUploadType.BINARY_CONTENT,
    headers: { "Content-Type": "application/octet-stream", Authorization: `Bearer ${token}` },
  });
  if (result.status < 200 || result.status >= 300) throw Error("Your document was not submitted. Please try again.");
  return JSON.parse(result.body);
}
