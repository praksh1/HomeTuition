export { rejectionExplanation } from "../../utils/identityStatus";
export async function uploadIdentityDocument(id, file) {
  window.identityUploadAttempts = (window.identityUploadAttempts ?? 0) + 1;
  if (window.failIdentityUpload) throw Error("Synthetic upload failure; try again.");
  window.identityUploaded = { id, name: file.name };
  return { verification: { id, status: "submitted", holder: window.identityPrepared.holder, rejectionCode: null } };
}
