import jwt from "jsonwebtoken";
import { logger } from "../logger.ts";
import {
  STREAM_API_BASE,
  STREAM_DEFAULT_CALL_TYPE,
  buildStreamRoomUri,
  redactStreamKey,
  streamCallCid,
  streamCallId,
  streamConfigProblem,
  streamCreateCallBody,
  streamTokenClaims,
  streamTokenTtlSeconds,
} from "./streamCall.ts";
import { VideoNotConfiguredError } from "./types.ts";
import type { JoinOptions, VideoProvider } from "./types.ts";

/**
 * Stream Video, behind the same interface Daily is behind.
 *
 * **This is an experiment and not the product.** Daily carries every real class; `VIDEO_PROVIDER`
 * still defaults to `daily`, this file is unreachable unless somebody sets `stream` on purpose,
 * and with no Stream credentials it refuses to open a room rather than opening a broken one.
 * Why the experiment exists at all is in VIDEO.md: forty-five people in a daily ninety-minute
 * call is around a hundred thousand participant-minutes a month against a NPR 6,500
 * subscription, and Daily bills per participant-minute.
 *
 * The whole point of the seam is that this file is the only thing that had to be written. The
 * room route, the membership check, the time gates and the classroom screens are untouched.
 *
 * ### Two secrets and one key
 *
 * `STREAM_API_SECRET` signs tokens and never leaves this process. `STREAM_API_KEY` is Stream's
 * publishable half and travels to the app inside the room locator — which is why nothing about
 * Stream is compiled into the Expo bundle, and why turning the provider off here turns it off
 * on every device without a rebuild.
 */

/** How long to wait on Stream before giving the class an answer either way. */
const STREAM_REQUEST_TIMEOUT_MS = 10_000;

function config() {
  return {
    apiKey: process.env.STREAM_API_KEY?.trim() ?? "",
    apiSecret: process.env.STREAM_API_SECRET?.trim() ?? "",
    callType: process.env.STREAM_CALL_TYPE?.trim() || STREAM_DEFAULT_CALL_TYPE,
  };
}

/**
 * A token that says "this is the server talking", which is how a call gets created.
 *
 * The same `{ server: true }` claim `@stream-io/node-sdk` signs — read out of its own source
 * rather than guessed, because a wrong claim here fails as a 401 with nothing to read.
 */
function serverToken(apiSecret: string): string {
  return jwt.sign({ server: true }, apiSecret, { algorithm: "HS256", noTimestamp: true });
}

/**
 * Make sure the call exists, and hand back where to join it.
 *
 * Throws when Stream is selected but not configured, and the message names the missing
 * variable. That is the one behaviour this file most needs to get right today: with no account
 * yet, the *only* honest outcome is a refusal somebody can act on. A provider that returned a
 * plausible-looking locator would produce a black rectangle on a phone and a bug report nobody
 * can diagnose.
 */
async function ensureRoom(sessionId: string | number): Promise<string> {
  const { apiKey, apiSecret, callType } = config();
  const problem = streamConfigProblem({ STREAM_API_KEY: apiKey, STREAM_API_SECRET: apiSecret });
  if (problem) {
    logger.error({ provider: "stream", apiKey: redactStreamKey(apiKey) }, problem);
    // Typed, so the room route can answer "this server was never set up" differently from "the
    // provider had a bad minute" — and so the variable names stay in this log rather than
    // travelling to whoever opened the classroom.
    throw new VideoNotConfiguredError(problem);
  }

  const callId = streamCallId(sessionId);
  const url =
    `${STREAM_API_BASE}/api/v2/video/call/${encodeURIComponent(callType)}/` +
    `${encodeURIComponent(callId)}?api_key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: serverToken(apiSecret),
      "stream-auth-type": "jwt",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(streamCreateCallBody()),
    signal: AbortSignal.timeout(STREAM_REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // The key is redacted and the token is never logged. A Stream error body carries the call
    // id and a reason, both of which are safe and are the only useful part.
    logger.error(
      { provider: "stream", callId, status: res.status, body: body.slice(0, 500) },
      "could not create or fetch the Stream call",
    );
    throw new Error(`Stream call setup failed: ${res.status}`);
  }

  logger.info({ provider: "stream", callId, callType }, "Stream call ready");
  return buildStreamRoomUri({ apiKey, callType, callId });
}

/**
 * A token for one person, for one call, for as long as that class can legitimately run.
 *
 * Signed here and only here. `isOwner` arrives from `getSessionMembership` and is the only
 * thing that decides whether the token asks for the teacher's role — a client cannot influence
 * it, and neither can Stream.
 *
 * Unlike the Daily path this does not return null on failure. A Daily room without a token
 * still lets somebody in as an ordinary participant, so falling back is a real degraded mode;
 * a Stream call with no token cannot be joined at all, so a null would be a black rectangle
 * with no explanation. It throws, and the route turns that into a 502 the app can show.
 */
async function joinToken(sessionId: string | number, options: JoinOptions): Promise<string> {
  const { apiKey, apiSecret, callType } = config();
  const problem = streamConfigProblem({ STREAM_API_KEY: apiKey, STREAM_API_SECRET: apiSecret });
  if (problem) throw new VideoNotConfiguredError(problem);

  const callId = streamCallId(sessionId);
  const claims = streamTokenClaims({
    userId: identityFor(options.userId),
    callCid: streamCallCid(callType, callId),
    isOwner: options.isOwner,
    nowSeconds: Math.floor(Date.now() / 1000),
    // Measured against the class this token opens, not against a number somebody liked.
    ttlSeconds: streamTokenTtlSeconds(options.durationMinutes),
  });

  /**
   * `noTimestamp: false` because the claims already carry a pinned `iat`.
   *
   * Not a style choice — `jsonwebtoken` **deletes** `iat` from the payload when `noTimestamp`
   * is true, so signing with it on produced a token with an `exp` and no issue time at all.
   * Caught by the test below, which is the only reason it is not in the branch. Stream's own
   * `@stream-io/node-sdk` does exactly this dance for exactly this reason.
   */
  return jwt.sign(claims, apiSecret, { algorithm: "HS256", noTimestamp: false });
}

/**
 * The name Stream knows a person by.
 *
 * Stream user ids allow letters, digits, `@`, `_` and `-`. This app's ids are numbers, so the
 * transformation is nearly nothing — but it is written down rather than assumed, because the
 * app has to send back the *same* string when it opens the call and a mismatch there fails as
 * an authentication error rather than as anything readable.
 */
function identityFor(userId: string): string {
  return String(userId).replace(/[^a-zA-Z0-9@_-]/g, "") || "guest";
}

export const streamProvider: VideoProvider = {
  name: "stream",

  capabilities: {
    /**
     * Stream's SDKs can capture a screen on every platform, which is the difference that makes
     * this worth trying.
     *
     * Daily can only share a screen from a browser here — the native path is a WebView and a
     * WebView cannot capture a screen. **Nothing on this branch has seen either work:** the
     * native SDK cannot be installed beside Daily's (STREAM.md §2) and the web SDK is not
     * installed either, so this flag states what Stream documents about itself, not something
     * measured here.
     */
    screenShare: true,
    /**
     * Stream Video ships no chat. Stream Chat is a separate product and a separate SDK, and it
     * is not installed and will not be — see .agents/memory/one-chat-per-class.md. This app's
     * chat is on its own socket, survives the call and reaches people who have not joined yet.
     */
    builtInChat: false,
  },

  configured() {
    const { apiKey, apiSecret } = config();
    return streamConfigProblem({ STREAM_API_KEY: apiKey, STREAM_API_SECRET: apiSecret }) === null;
  },

  ensureRoom,
  joinToken,
  identityFor,
};
