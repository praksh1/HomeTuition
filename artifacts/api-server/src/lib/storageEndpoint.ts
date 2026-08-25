/**
 * Working out where the bucket actually is, from settings a person typed.
 *
 * No imports on purpose — `fileStore.ts` pulls in the AWS SDK and a logger, and Node's
 * `--experimental-strip-types` cannot resolve extensionless runtime imports, so the deciding
 * lives here where a test can reach it.
 *
 * ### Why this is more than string concatenation
 *
 * The endpoint used to be built as `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, which
 * is correct only if what is in `R2_ACCOUNT_ID` really is a bare account id. Cloudflare's own
 * bucket page shows an **S3 API** value that looks like
 * `https://<account id>.r2.cloudflarestorage.com/<bucket>`, and that is the obvious thing to
 * copy. Pasting it produced `https://https://…` — a URL whose hostname is the literal string
 * `https`, and a failure that read `getaddrinfo ENOTFOUND https`.
 *
 * That is not a mistake worth blaming somebody for; it is a mistake worth absorbing. So
 * anything that is already a URL is treated as one, and the bucket path Cloudflare includes is
 * dropped rather than being sent as part of the hostname.
 */

export interface ResolvedEndpoint {
  endpoint: string;
  /** What was corrected, if anything, so the server can say so once at boot. */
  note: string | null;
}

/** The 32 hex characters Cloudflare calls an account id. */
const ACCOUNT_ID = /^[0-9a-f]{32}$/i;

/**
 * Pull the origin out of something that may or may not be a URL.
 *
 * Returns null when the text is not a URL at all, which is the ordinary case of a bare account
 * id. Any path is discarded: Cloudflare's S3 API value ends in the bucket name, and a bucket in
 * the endpoint is a bucket in every request path twice over.
 */
function originOf(raw: string): string | null {
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Where to send S3 requests, given whatever is in the two settings.
 *
 * `R2_ENDPOINT` wins when it is set, because somebody who set it explicitly meant it — but it
 * is still cleaned, since the same paste lands there just as easily.
 */
export function resolveEndpoint(accountId: string, endpointSetting: string): ResolvedEndpoint {
  const explicit = endpointSetting.trim();
  if (explicit) {
    const origin = originOf(explicit);
    if (origin && origin !== explicit.replace(/\/+$/, "")) {
      return {
        endpoint: origin,
        note: "R2_ENDPOINT had a path on the end (usually the bucket name); using just the host.",
      };
    }
    if (origin) return { endpoint: origin, note: null };
    // Not a URL at all — most likely a bare hostname. Give it a scheme rather than refusing.
    return {
      endpoint: `https://${explicit.replace(/\/+$/, "")}`,
      note: "R2_ENDPOINT had no https:// on the front; added it.",
    };
  }

  const account = accountId.trim();
  if (!account) return { endpoint: "", note: null };

  /**
   * The paste that caused this. A URL in the account id is used as the endpoint, with its path
   * dropped — which is what the person meant, and is far better than a hostname of "https".
   */
  const asUrl = originOf(account);
  if (asUrl) {
    return {
      endpoint: asUrl,
      note:
        "R2_ACCOUNT_ID held a full URL rather than an account id. Using it as the endpoint — " +
        "but set R2_ACCOUNT_ID to just the account id, or move the URL to R2_ENDPOINT.",
    };
  }

  // A hostname without a scheme: `abc123.r2.cloudflarestorage.com`.
  if (account.includes(".")) {
    return {
      endpoint: `https://${account.replace(/\/.*$/, "")}`,
      note: "R2_ACCOUNT_ID looked like a hostname rather than an account id; using it as one.",
    };
  }

  return {
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    // Not fatal — Cloudflare ids are 32 hex characters, and something else is probably a typo.
    note: ACCOUNT_ID.test(account)
      ? null
      : "R2_ACCOUNT_ID is not the 32-character id Cloudflare shows. Check it if uploads fail.",
  };
}
