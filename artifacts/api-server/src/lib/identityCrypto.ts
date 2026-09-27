import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyBytes(key: string): Buffer {
  // Dedicated key, never SESSION_SECRET or a default. Invalid/missing config fails closed.
  if (!/^[0-9a-fA-F]{64}$/.test(key)) throw new Error("Identity encryption key must be 32 bytes encoded as hexadecimal.");
  return Buffer.from(key, "hex");
}

/** Authenticated encryption binds ciphertext to its account AND record; swapping rows must fail. */
export function sealIdentity(plaintext: string, key: string, recordContext: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), nonce);
  cipher.setAAD(Buffer.from(`fadko-identity:v1:${recordContext}`));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function openIdentity(envelope: string, key: string, recordContext: string): string {
  const [version, nonce, tag, body, extra] = envelope.split(".");
  if (version !== "v1" || !nonce || !tag || body === undefined || extra !== undefined) throw new Error("Invalid identity envelope.");
  const iv = Buffer.from(nonce, "base64url");
  const authTag = Buffer.from(tag, "base64url");
  if (iv.length !== 12 || authTag.length !== 16) throw new Error("Invalid identity envelope.");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(key), iv);
  decipher.setAAD(Buffer.from(`fadko-identity:v1:${recordContext}`));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
