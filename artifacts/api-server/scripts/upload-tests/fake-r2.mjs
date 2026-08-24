/**
 * A stand-in for Cloudflare R2, good enough to prove the signing is right.
 *
 * There is no R2 in this container and no way to fetch MinIO through the proxy, so this is a
 * small S3-compatible server that does the one thing that matters: it **verifies the AWS
 * SigV4 presigned signature itself**, with an implementation written from the specification
 * rather than from the SDK that produced it.
 *
 * That independence is the whole point. If our signing and this verifier agree, two separate
 * implementations of SigV4 have arrived at the same signature over the same canonical request,
 * which is strong evidence that the real R2 will accept it too. A shape check — "does the URL
 * have an X-Amz-Signature on it" — would prove nothing at all.
 *
 * What it cannot prove: that Cloudflare's own quirks are satisfied. Only a real bucket can say
 * that, and the owner does it once when they set the credentials.
 */
import { createHmac, createHash } from "node:crypto";
import http from "node:http";

const SERVICE = "s3";
const REGION = "auto";

const hmac = (key, value) => createHmac("sha256", key).update(value, "utf8").digest();
const sha256hex = (value) => createHash("sha256").update(value, "utf8").digest("hex");

/** Exactly the escaping SigV4 wants: unreserved characters raw, everything else percent-encoded. */
function uriEncode(value, encodeSlash) {
  let out = "";
  for (const ch of Buffer.from(value, "utf8")) {
    const c = String.fromCharCode(ch);
    if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || (c >= "0" && c <= "9") ||
        c === "_" || c === "-" || c === "~" || c === ".") {
      out += c;
    } else if (c === "/") {
      out += encodeSlash ? "%2F" : "/";
    } else {
      out += "%" + ch.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

function signingKey(secret, date) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), REGION), SERVICE), "aws4_request");
}

/**
 * Recompute the signature on an incoming presigned request and compare.
 *
 * Returns null when it matches, or a reason when it does not — the reason is what makes a
 * failure diagnosable instead of just red.
 */
export function verifyPresigned(req, secret, host) {
  const url = new URL(req.url, `http://${host}`);
  const q = url.searchParams;

  /**
   * Header-signed requests too, not only presigned links.
   *
   * The phone uses a presigned URL, but the *server* talks to the bucket directly for HEAD and
   * DELETE, and the SDK signs those with an Authorization header instead of query parameters.
   * Refusing them made every size check report "that file did not finish uploading" — which is
   * exactly the sort of misleading symptom this stand-in exists to surface rather than hide.
   */
  if (!q.get("X-Amz-Signature") && req.headers.authorization) {
    return verifyAuthHeader(req, secret, host);
  }

  const algorithm = q.get("X-Amz-Algorithm");
  if (algorithm !== "AWS4-HMAC-SHA256") return `algorithm is ${algorithm}`;

  const credential = q.get("X-Amz-Credential");
  const amzDate = q.get("X-Amz-Date");
  const expires = q.get("X-Amz-Expires");
  const signedHeaders = q.get("X-Amz-SignedHeaders");
  const provided = q.get("X-Amz-Signature");
  if (!credential || !amzDate || !expires || !signedHeaders || !provided) {
    return "a required X-Amz parameter is missing";
  }

  const [, date, region, service] = credential.split("/");
  if (region !== REGION) return `region is ${region}`;
  if (service !== SERVICE) return `service is ${service}`;

  // Has it expired? Signed links must not live forever.
  const stamp = Date.parse(
    `${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T` +
    `${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`,
  );
  if (Date.now() > stamp + Number(expires) * 1000) return "the link has expired";

  // The canonical query string is everything except the signature, sorted, re-encoded.
  const pairs = [];
  for (const [k, v] of q.entries()) {
    if (k === "X-Amz-Signature") continue;
    pairs.push([uriEncode(k, true), uriEncode(v, true)]);
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const canonicalQuery = pairs.map(([k, v]) => `${k}=${v}`).join("&");

  const canonicalHeaders = signedHeaders
    .split(";")
    .map((h) => `${h}:${String(req.headers[h] ?? "").trim()}\n`)
    .join("");

  const canonicalRequest = [
    req.method,
    uriEncode(decodeURIComponent(url.pathname), false),
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    `${date}/${REGION}/${SERVICE}/aws4_request`,
    sha256hex(canonicalRequest),
  ].join("\n");

  const expected = createHmac("sha256", signingKey(secret, date)).update(stringToSign, "utf8").digest("hex");
  if (expected !== provided) {
    return `signature mismatch\n  canonical request was:\n${canonicalRequest.replace(/^/gm, "    ")}`;
  }
  return null;
}

/**
 * The same verification, for a request signed with an Authorization header.
 *
 * Identical canonical request, except the payload hash comes from the `x-amz-content-sha256`
 * header rather than being the literal "UNSIGNED-PAYLOAD".
 */
function verifyAuthHeader(req, secret, host) {
  const auth = String(req.headers.authorization ?? "");
  const m = /^AWS4-HMAC-SHA256\s+Credential=([^,]+),\s*SignedHeaders=([^,]+),\s*Signature=([0-9a-f]+)$/.exec(auth);
  if (!m) return "the Authorization header is not SigV4";
  const [, credential, signedHeaders, provided] = m;
  const [, date, region, service] = credential.split("/");
  if (region !== REGION) return `region is ${region}`;
  if (service !== SERVICE) return `service is ${service}`;

  const url = new URL(req.url, `http://${host}`);
  const pairs = [];
  for (const [k, v] of url.searchParams.entries()) pairs.push([uriEncode(k, true), uriEncode(v, true)]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));

  const canonicalHeaders = signedHeaders
    .split(";")
    .map((h) => `${h}:${String(req.headers[h] ?? "").trim()}\n`)
    .join("");

  const canonicalRequest = [
    req.method,
    uriEncode(decodeURIComponent(url.pathname), false),
    pairs.map(([k, v]) => `${k}=${v}`).join("&"),
    canonicalHeaders,
    signedHeaders,
    String(req.headers["x-amz-content-sha256"] ?? "UNSIGNED-PAYLOAD"),
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    String(req.headers["x-amz-date"] ?? ""),
    `${date}/${REGION}/${SERVICE}/aws4_request`,
    sha256hex(canonicalRequest),
  ].join("\n");

  const expected = createHmac("sha256", signingKey(secret, date)).update(stringToSign, "utf8").digest("hex");
  if (expected !== provided) {
    return `header signature mismatch\n  canonical request was:\n${canonicalRequest.replace(/^/gm, "    ")}`;
  }
  return null;
}

/**
 * Start the stand-in. Objects live in a Map; nothing touches a disk.
 *
 * Every request must carry a valid presigned signature — an unsigned or badly signed one is
 * refused with 403, exactly as R2 would, so a test that forgets to sign fails rather than
 * quietly passing.
 */
export function startFakeR2({ port, bucket, secret }) {
  const objects = new Map();
  const rejected = [];

  const server = http.createServer((req, res) => {
    const host = req.headers.host ?? `127.0.0.1:${port}`;
    const problem = verifyPresigned(req, secret, host);
    if (problem) {
      rejected.push({ url: req.url, problem });
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end(`SignatureDoesNotMatch: ${problem}`);
      return;
    }

    const url = new URL(req.url, `http://${host}`);
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (!path.startsWith(`${bucket}/`)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("NoSuchBucket");
      return;
    }
    const key = path.slice(bucket.length + 1);

    if (req.method === "PUT") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        objects.set(key, {
          body: Buffer.concat(chunks),
          contentType: String(req.headers["content-type"] ?? ""),
        });
        res.writeHead(200).end();
      });
      return;
    }

    const object = objects.get(key);
    if (!object) { res.writeHead(404, { "Content-Type": "text/plain" }).end("NoSuchKey"); return; }

    if (req.method === "HEAD") {
      res.writeHead(200, {
        "Content-Length": String(object.body.length),
        "Content-Type": object.contentType,
      }).end();
      return;
    }
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": object.contentType }).end(object.body);
      return;
    }
    if (req.method === "DELETE") {
      objects.delete(key);
      res.writeHead(204).end();
      return;
    }
    res.writeHead(405).end();
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve({
      objects,
      rejected,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
}
