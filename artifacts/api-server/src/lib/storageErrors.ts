/**
 * What object storage's refusals mean, and what to change about them.
 *
 * No imports on purpose. Node's `--experimental-strip-types` cannot resolve extensionless
 * runtime imports, and `fileStore.ts` pulls in the AWS SDK and a logger — so the part that is
 * pure decision-making lives here where a test can reach it directly.
 */

/**
 * Turning object storage's refusal into a sentence somebody can act on.
 *
 * The upload route used to catch every failure and answer "We could not store that file.
 * Please try again." — which is true, useless, and wrong: trying again does not fix a
 * read-only API token. The owner saw it on the live site with no way to tell whether the
 * bucket was missing, the key was wrong, or the token simply could not write.
 *
 * The code is the S3/R2 error code (`AccessDenied`, `NoSuchBucket`, …) and the sentence says
 * what to change. Nothing here ever carries a secret: see `redact` below.
 */
export interface StorageFailure {
  /** The provider's own code, for the log and for us. */
  code: string;
  /** What the owner should change, in words. */
  advice: string;
  /** What a student or teacher should be told. Never mentions configuration. */
  publicMessage: string;
  /** The provider's message, with anything key-shaped removed. */
  detail: string;
}

/**
 * Strip anything that looks like a credential out of a provider message.
 *
 * S3-compatible services echo the access key ID back in `InvalidAccessKeyId` errors, and a
 * message goes into a log that a support agent may later read. A key id is not as sensitive as
 * a secret, but there is no reason for either to travel.
 */
function redact(text: string): string {
  return text
    .replace(/\b[A-Za-z0-9/+=]{40,}\b/g, "[redacted]")
    .replace(/\b[A-Z0-9]{20}\b/g, "[redacted]");
}

export function describeStorageFailure(err: unknown): StorageFailure {
  const anyErr = err as { name?: string; Code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const code = String(anyErr?.Code ?? anyErr?.name ?? "Unknown");
  const status = anyErr?.$metadata?.httpStatusCode;
  const detail = redact(String(anyErr?.message ?? ""));

  const generic = "We could not save that file just now. Please try again in a moment.";

  switch (code) {
    case "AccessDenied":
      return {
        code, detail,
        advice:
          "The R2 API token reached the bucket but is not allowed to write to it. In Cloudflare " +
          "→ R2 → Manage API Tokens, the token needs **Object Read & Write** on this bucket — " +
          "a read-only token gets exactly this far and no further.",
        publicMessage: generic,
      };
    case "InvalidAccessKeyId":
      return {
        code, detail,
        advice:
          "R2 does not recognise R2_ACCESS_KEY_ID. It is usually a token from a different " +
          "Cloudflare account, or one that has since been rolled.",
        publicMessage: generic,
      };
    case "SignatureDoesNotMatch":
      return {
        code, detail,
        advice:
          "R2_SECRET_ACCESS_KEY does not match R2_ACCESS_KEY_ID. Most often the secret was " +
          "copied with a space or a line break on the end — Cloudflare shows it once, so " +
          "reissue the token rather than trying to repair it.",
        publicMessage: generic,
      };
    case "NoSuchBucket":
      return {
        code, detail,
        advice:
          "There is no bucket by the name in R2_BUCKET on this account. Check it against " +
          "Cloudflare → R2 exactly, including case.",
        publicMessage: generic,
      };
    case "PermanentRedirect":
    case "AuthorizationHeaderMalformed":
      return {
        code, detail,
        advice:
          "The endpoint does not match the account. R2_ACCOUNT_ID must be the account the " +
          "bucket lives in — the endpoint is built from it as " +
          "https://<account id>.r2.cloudflarestorage.com.",
        publicMessage: generic,
      };
    default:
      break;
  }

  // Not an answer from R2 at all: DNS, TLS, a timeout. The account id in the endpoint is the
  // usual cause, because a wrong one is a hostname that does not resolve.
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|socket hang up|getaddrinfo/i.test(detail) || status === undefined) {
    return {
      code: code === "Unknown" ? "Unreachable" : code,
      detail,
      advice:
        "The server could not reach R2 at all. Check R2_ACCOUNT_ID — the endpoint is built " +
        "from it, so a wrong one is simply a hostname that does not exist.",
      publicMessage: "We could not reach our file storage. Please try again in a moment.",
    };
  }

  // Deliberately does not name an operation. This is reached by reads and deletes as well as
  // writes, and telling somebody "R2 refused the write" about a failed read sends them looking
  // in the wrong place — caught when the check failed at "read" and said exactly that.
  return {
    code, detail,
    advice: `Storage refused it with ${code}${status ? ` (HTTP ${status})` : ""}.`,
    publicMessage: generic,
  };
}

