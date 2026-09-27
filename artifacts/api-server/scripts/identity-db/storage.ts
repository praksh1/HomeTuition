export const deleted = new Map<string, number>();
export const failures = new Set<string>();
export { identityCollectionEnabled, identityEncryptionKey, identityDocumentType } from "../../src/lib/identityFiles.ts";
export const uploaded = new Map<string, Buffer>();
export const writes = new Map<string, number>();
export function identityStorageReady() { return true; } // Test adapter ONLY: not an R2 integration pass.
export async function putIdentityFile(key: string, bytes: Buffer) {
  if (failures.has(key)) throw Error("Synthetic storage failure");
  uploaded.set(key, Buffer.from(bytes)); writes.set(key, (writes.get(key) ?? 0) + 1);
}
export async function readIdentityFile(key: string) {
  if (failures.has(key) || !uploaded.has(key)) throw Error("Synthetic storage failure");
  return {bytes: Buffer.from(uploaded.get(key)!), contentType: "image/png"};
}
export async function deleteIdentityFile(key: string) {
  if (failures.has(key)) throw Error("Synthetic storage failure");
  deleted.set(key, (deleted.get(key) ?? 0) + 1);
}
