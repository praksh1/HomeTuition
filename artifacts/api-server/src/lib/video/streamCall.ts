/**
 * Everything about a Stream call that is arithmetic on strings.
 *
 * Split from `streamProvider.ts` for the reason `select.ts` gives: this file imports nothing at
 * runtime, so it can be unit-tested directly. The provider next door talks to the network and
 * signs tokens with a secret; this one decides *what* is said, and every one of those decisions
 * — how long a token lives, which claims carry moderator rights, what a phone on a 3G
 * connection is asked to receive — is worth a test that does not need an account.
 *
 * ### Nothing here is Daily's business, and nothing here is production
 *
 * Stream is a proof of concept. Daily carries every real class and stays the default; this file
 * is only reachable when `VIDEO_PROVIDER=stream` is set deliberately. See STREAM.md.
 */

import { DOORS_OPEN_MINUTES, OVERTIME_CUTOFF_MINUTES } from "../sessionStart.ts";

/**
 * How the app is told where to join.
 *
 * `ensureRoom` has to return one string, because that is what every provider in the seam gives
 * you — Daily a room URL, LiveKit a `wss://` server, Jitsi a room address. Stream is the first
 * one that does not have a URL at all: its client is handed an API key, a call type and a call
 * id, and finds the edge itself.
 *
 * So the string is a locator rather than a link, and it says so by not pretending to be `https`.
 * The one earlier precedent in this seam does the same thing — the echo provider returns
 * `https://video.invalid/...` — but `.invalid` still looks openable, and this does not.
 *
 * The API key travels in it deliberately. Stream's API key is the publishable half of the pair
 * (the secret never leaves the server and is what signs the token), so handing it over with the
 * room means **no Stream value has to be baked into the Expo bundle at all** — a build of the
 * app carries no trace of the experiment, and turning the provider off at the server turns it
 * off everywhere.
 */
export const STREAM_ROOM_URI_PREFIX = "stream:call/";

/**
 * The call type whose settings and role grants apply.
 *
 * Stream calls are `type:id`, and the *type* is where per-role permissions live — which role
 * may end a call, mute somebody, or share a screen is configured against the call type in
 * Stream's dashboard, not sent per call. `default` is Stream's own built-in type; the setup
 * guide in STREAM.md says which grants to check on it, because a token asking for a role the
 * type does not grant gets a polite nothing rather than an error.
 */
export const STREAM_DEFAULT_CALL_TYPE = "default";

/**
 * How long a join token lives, measured from the class it is for.
 *
 * The first version of this was a flat hour, which was wrong and would have failed in front of
 * a teacher: the monthly tier is a **ninety-minute** lesson, and Stream's client reconnects with
 * the token it already holds rather than asking for a new one. A ninety-minute class would have
 * dropped somebody at the hour mark and refused to let them back in — worst on exactly the
 * connections this product is built for, where reconnecting is normal.
 *
 * So the lifetime is derived from this project's own clock rather than picked:
 *
 *     doors open 10 min early  +  the booked length  +  10 min of teacher overtime
 *
 * which is the widest gap between the earliest moment a token can be minted and the last moment
 * `canStart` will still open the door. Those two numbers are imported from `sessionStart.ts`
 * rather than copied, because a class having two ideas about its own clock is how this project
 * ended up with a socket and a room URL that disagreed about who was allowed in.
 *
 * **Both ends are clamped**, because `duration` is validated as "a positive integer" and nothing
 * more — a teacher who types 100000 must not mint a token that lives ten weeks. The floor keeps
 * a fifteen-minute class from holding a token too short to survive one rejoin.
 *
 * The trade-off, stated plainly: a longer token is a token worth more if it is stolen. It is
 * bounded to one call by `call_cids`, so the worst case is one class, and it is still a fraction
 * of the eight hours the Daily path mints. The alternative — a refresh endpoint feeding Stream's
 * `tokenProvider` — is real (the option exists in `@stream-io/video-client@1.59.0`'s types) and
 * is **not implemented here**; it needs a route of its own that repeats the membership and
 * timing checks, which is more surface than a proof of concept should add.
 */
export const STREAM_TOKEN_MIN_TTL_SECONDS = 60 * 60;
export const STREAM_TOKEN_MAX_TTL_SECONDS = 6 * 60 * 60;

export function streamTokenTtlSeconds(durationMinutes: number): number {
  const wanted =
    (DOORS_OPEN_MINUTES + Math.max(0, durationMinutes || 0) + OVERTIME_CUTOFF_MINUTES) * 60;
  return Math.min(STREAM_TOKEN_MAX_TTL_SECONDS, Math.max(STREAM_TOKEN_MIN_TTL_SECONDS, wanted));
}

/**
 * The two roles this product has, named as Stream names them.
 *
 * Stream ships five call roles — `user`, `moderator`, `host`, `admin` and `call-member`. Only
 * the first two are used here, and which one a person gets is decided by the server's own
 * membership check before this file is ever called. A provider that worked out for itself who
 * the teacher was would be a provider that could be talked into it by a client.
 */
export const STREAM_TEACHER_ROLE = "host";
export const STREAM_STUDENT_ROLE = "user";

/** Stream's REST host, from `@stream-io/node-sdk`'s own default. */
export const STREAM_API_BASE = "https://video.stream-io-api.com";

export interface StreamConfig {
  apiKey: string;
  apiSecret: string;
  callType: string;
}

/**
 * A call id Stream will accept, derived from ours.
 *
 * Same shape of problem the Daily path solves in `sanitizeRoomName`, and solved the same way:
 * strip everything that is not a plain character and prefix it, so the id is stable, guessable
 * only if you already know the session id, and never collides with another product's calls in
 * the same Stream app.
 */
export function streamCallId(sessionId: string | number): string {
  return "sikshya-" + String(sessionId).replace(/[^a-zA-Z0-9]/g, "");
}

/** Stream's own name for one call: `type:id`. It is what a call token is scoped to. */
export function streamCallCid(callType: string, callId: string): string {
  return `${callType}:${callId}`;
}

export function buildStreamRoomUri(config: {
  apiKey: string;
  callType: string;
  callId: string;
}): string {
  return (
    STREAM_ROOM_URI_PREFIX +
    `${encodeURIComponent(config.callType)}/${encodeURIComponent(config.callId)}` +
    `?api_key=${encodeURIComponent(config.apiKey)}`
  );
}

export interface ParsedStreamRoom {
  callType: string;
  callId: string;
  apiKey: string;
}

/**
 * Read a locator back apart.
 *
 * Hand-written rather than handed to `new URL()`: `stream:` is not a scheme any runtime has
 * special rules for, and this string is parsed on the server, in a browser and in Hermes. Three
 * engines agreeing about a non-special URL scheme is not something to find out on a phone.
 *
 * Returns null rather than throwing. A locator that cannot be read is a configuration problem,
 * and the caller has somewhere better to say so than a stack trace.
 */
export function parseStreamRoomUri(uri: string | null | undefined): ParsedStreamRoom | null {
  if (typeof uri !== "string" || !uri.startsWith(STREAM_ROOM_URI_PREFIX)) return null;
  const rest = uri.slice(STREAM_ROOM_URI_PREFIX.length);
  const queryAt = rest.indexOf("?");
  if (queryAt < 0) return null;

  const path = rest.slice(0, queryAt).split("/");
  if (path.length !== 2) return null;

  try {
    /**
     * All of the decoding, inside one `try`.
     *
     * `decodeURIComponent` **throws** on a malformed percent escape — `%zz`, or a `%` at the end
     * of the string — so the earlier version of this function documented that it returns null for
     * anything unreadable and then threw instead. The two are not the same to a caller: a null is
     * a state the classroom already handles and a throw is an unhandled rejection inside an
     * effect.
     */
    let apiKey = "";
    for (const pair of rest.slice(queryAt + 1).split("&")) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      if (pair.slice(0, eq) === "api_key") apiKey = decodeURIComponent(pair.slice(eq + 1));
    }

    const callType = decodeURIComponent(path[0]);
    const callId = decodeURIComponent(path[1]);
    if (!callType || !callId || !apiKey) return null;
    return { callType, callId, apiKey };
  } catch {
    return null;
  }
}

export interface StreamTokenClaims {
  user_id: string;
  /** The one call this token opens. Not "every call in the app" — see below. */
  call_cids: string[];
  role: string;
  iat: number;
  exp: number;
}

/**
 * What the join token says.
 *
 * Two claims are doing the security work and both are decided here rather than by the client:
 *
 * `call_cids` scopes the token to **one call**. Without it a token is a key to every call in
 * the Stream app, which for this product would mean a student who booked one class holding a
 * credential for every other lesson on the platform. That is the same bug this codebase already
 * fixed once at the room route — see `lib/membership.ts` — and it is not being reintroduced one
 * layer down.
 *
 * `role` carries moderator rights, and is `host` only for the teacher who owns the session, as
 * decided by the server's membership check. It is a request, not a grant: what `host` may
 * actually do is configured against the call type in Stream's dashboard, so the client is told
 * `isOwner` separately and draws its teacher-only controls from that. Two independent noes.
 */
export function streamTokenClaims(options: {
  userId: string;
  callCid: string;
  isOwner: boolean;
  /** Unix seconds. Passed in so a test can pin the clock. */
  nowSeconds: number;
  /** From `streamTokenTtlSeconds`. Required, so nobody can forget the class's own length. */
  ttlSeconds: number;
}): StreamTokenClaims {
  const ttl = options.ttlSeconds;
  return {
    user_id: options.userId,
    call_cids: [options.callCid],
    role: options.isOwner ? STREAM_TEACHER_ROLE : STREAM_STUDENT_ROLE,
    iat: options.nowSeconds,
    exp: options.nowSeconds + ttl,
  };
}

/**
 * The picture quality a class is created at.
 *
 * This is the number the whole experiment is about. Stream bills by the resolution a participant
 * **receives**, so a call that quietly negotiates 720p because the teacher has a good laptop
 * costs about twice one held at 480p — and on the tier this project is worried about, that is
 * the difference between a subscription that works and one that loses money on every teacher.
 *
 * 640×480 at 600 kbps is also simply the right answer for the phones this product is built for:
 * a cheap Android on a Kathmandu connection does not have the bandwidth for 720p and does not
 * have the screen to show it. The video window on a phone is a thumbnail over a whiteboard.
 *
 * `camera_default_on: false` and `mic_default_on: true` say the other half out loud — **audio
 * is the lesson, video is the courtesy.** A class where thirty cameras come up by default is
 * thirty upstreams nobody asked for, on connections that cannot carry them.
 */
export function streamCallSettings(): Record<string, unknown> {
  return {
    audio: {
      mic_default_on: true,
      speaker_default_on: true,
      default_device: "speaker",
      // Opus discontinuous transmission: stops sending while nobody is talking. Free, and it
      // matters most on exactly the connections this is for.
      opus_dtx_enabled: true,
      redundant_coding_enabled: true,
    },
    video: {
      enabled: true,
      camera_default_on: false,
      target_resolution: { width: 640, height: 480, bitrate: 600_000 },
    },
    screensharing: {
      enabled: true,
      // A student asking to present, in a class of forty-five, is a queue nobody is running.
      access_request_enabled: false,
      target_resolution: { width: 1280, height: 720, bitrate: 1_000_000 },
    },
    // Recording and transcription cost money and nobody has asked for them. Off, explicitly,
    // rather than left to whatever the dashboard's default happens to be.
    recording: { mode: "disabled" },
    transcription: { mode: "disabled", closed_caption_mode: "disabled" },
    backstage: { enabled: false },
  };
}

/**
 * Who Stream thinks made the room.
 *
 * The platform, not the teacher — deliberately. Stream requires a creator when a call is made
 * with a server token, and naming the teacher there would give one participant a standing that
 * did not come from this server's membership check. Rights in this product come from the `role`
 * claim and from nothing else; a room nobody in the class owns is the honest shape of that.
 */
export const STREAM_SYSTEM_USER_ID = "sikshya-system";

/**
 * The body that creates the call, or finds the one already there.
 *
 * Idempotent by construction — Stream's `getOrCreate` returns the existing call untouched — which
 * is what the seam requires: this is called when a teacher starts a class and again by every
 * person who opens the room.
 */
export function streamCreateCallBody(): Record<string, unknown> {
  return {
    data: {
      created_by: { id: STREAM_SYSTEM_USER_ID, name: "Sikshya" },
      settings_override: streamCallSettings(),
    },
  };
}

/**
 * What is missing, said in the words of the thing that is missing.
 *
 * The rule the rest of this codebase follows — payments, email, file storage: the mode follows
 * from what is in the environment, and when nothing is there the app *says so* rather than
 * pretending. A proof of concept with no credentials must fail closed and name the variable,
 * because "Failed to set up video room" is the least diagnosable sentence in the product.
 *
 * **This sentence is for the log.** It goes into `VideoNotConfiguredError.detail`, and the room
 * route logs it and answers with a message that says video is not set up here and stops there.
 * Telling anybody who can open a class that `STREAM_API_SECRET` is unset tells them what to go
 * looking for, and this project has already had one key leak.
 */
export function streamConfigProblem(env: {
  STREAM_API_KEY?: string;
  STREAM_API_SECRET?: string;
}): string | null {
  const missing: string[] = [];
  if (!env.STREAM_API_KEY?.trim()) missing.push("STREAM_API_KEY");
  if (!env.STREAM_API_SECRET?.trim()) missing.push("STREAM_API_SECRET");
  if (missing.length === 0) return null;
  return (
    `Stream video is selected but not configured: ${missing.join(" and ")} ` +
    `${missing.length === 1 ? "is" : "are"} not set on the server.`
  );
}

/** Everything after the first four characters of a key, gone. Logs are not a place for secrets. */
export function redactStreamKey(value: string | undefined | null): string {
  if (!value) return "(unset)";
  return value.length <= 4 ? "****" : `${value.slice(0, 4)}…(${value.length} chars)`;
}
