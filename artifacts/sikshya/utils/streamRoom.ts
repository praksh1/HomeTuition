/**
 * Reading the room locator the server hands out for a Stream call.
 *
 * The app's half of `api-server/src/lib/video/streamCall.ts`. The two packages deliberately do
 * not share code — the same arrangement `sessionWindow.ts` has with `sessionStart.ts` — so this
 * is a mirror, and a mirror that drifts is the worst kind of bug: the server produces a locator
 * the app cannot read, the classroom shows "couldn't set up the video room", and every test on
 * each side still passes. `streamRoom.test.ts` pins the exact string both sides agree on.
 *
 * **Stream is an experiment.** Daily carries every class; nothing here runs unless the server is
 * deliberately set to `VIDEO_PROVIDER=stream`. See STREAM.md.
 */

import type { CallWindowState } from "./callWindow";

export type { CallWindowState };

/** Must equal `STREAM_ROOM_URI_PREFIX` on the server. Pinned by a test on both sides. */
export const STREAM_ROOM_URI_PREFIX = "stream:call/";

export interface StreamRoom {
  callType: string;
  callId: string;
  /**
   * Stream's publishable API key, sent with the room rather than compiled into the app.
   *
   * That is the point of putting it here: an Expo bundle carries no trace of Stream, so
   * switching the provider off at the server switches it off on every phone already installed,
   * with no rebuild and no store review. The secret that signs tokens never leaves the server.
   */
  apiKey: string;
}

/**
 * Parse a locator, or return null.
 *
 * Hand-written rather than handed to `URL`: `stream:` is not a scheme with special rules, and
 * this runs in a browser, in Hermes on Android and in JavaScriptCore on iOS. Three engines
 * agreeing about a non-special scheme is not something to discover on somebody's phone.
 *
 * Null rather than a throw, and null rather than a half-read result. A locator read halfway
 * would join *something* — the wrong call, or the right call with the wrong key — and surface as
 * an authentication error nobody can trace back to here.
 */
export function parseStreamRoom(uri: string | null | undefined): StreamRoom | null {
  if (typeof uri !== "string" || !uri.startsWith(STREAM_ROOM_URI_PREFIX)) return null;
  const rest = uri.slice(STREAM_ROOM_URI_PREFIX.length);
  const queryAt = rest.indexOf("?");
  if (queryAt < 0) return null;

  const path = rest.slice(0, queryAt).split("/");
  if (path.length !== 2) return null;

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
}

/**
 * How big a picture to ask other people's cameras for.
 *
 * This is the single lever with the most money and the most bandwidth behind it. Stream bills by
 * the resolution each participant **receives**, so what the app asks for is what the platform
 * pays for — and the phones this product is built for cannot decode much anyway.
 *
 * The window is a thumbnail over a whiteboard for most of a lesson, so the sizes follow the
 * window rather than the network:
 *
 * - **hidden** — nothing. Not a small picture: none. The call keeps running for its audio.
 * - **compact** — a 92×66 tile. 180p is already more than those pixels can show.
 * - **normal** — the docked window. 360p.
 * - **full** — the whole screen, and the only state where 480p is worth paying for. It is also
 *   the ceiling the call itself is created at, so nothing above it is reachable.
 */
export interface IncomingVideoPreference {
  /** False means: do not subscribe to anybody's camera at all. */
  enabled: boolean;
  resolution: { width: number; height: number } | null;
}

export function incomingVideoFor(state: CallWindowState): IncomingVideoPreference {
  switch (state) {
    case "hidden":
      // The requirement in one line: do not carry video nobody can see. A hidden window on a
      // phone tethered to a shared connection is the common case in this product, not the edge.
      return { enabled: false, resolution: null };
    case "compact":
      return { enabled: true, resolution: { width: 320, height: 180 } };
    case "normal":
      return { enabled: true, resolution: { width: 640, height: 360 } };
    case "full":
      return { enabled: true, resolution: { width: 640, height: 480 } };
  }
}

/**
 * How many cameras to actually render.
 *
 * The monthly tier is forty-five students in one call. Forty-five decoded video tracks on a
 * budget Android is not a layout problem, it is a device that gets hot and then drops the call.
 *
 * So the strip is bounded, and the bound is smaller when the window is. The people who do not
 * fit are still *in* the call — their audio is untouched, which is the part of a lesson that
 * matters — they simply have no tile. `VISIBLE_PARTICIPANT_CAP` is deliberately low; the number
 * to raise it to is one somebody measures on a real phone, not one anybody guesses here.
 */
export const VISIBLE_PARTICIPANT_CAP: Record<CallWindowState, number> = {
  hidden: 0,
  compact: 2,
  normal: 4,
  full: 6,
};

/**
 * Which participants get a tile, in a stable order.
 *
 * Stable matters more than clever: a strip that reshuffles every time somebody unmutes is a
 * strip nobody can tap. The teacher is pinned first because a student's reason for looking at
 * the window at all is to see the teacher; whoever is presenting takes the stage above it
 * separately and does not need a tile to be seen.
 */
export function visibleParticipants<T extends { isLocal: boolean; isTeacher: boolean }>(
  participants: T[],
  state: CallWindowState,
): T[] {
  const cap = VISIBLE_PARTICIPANT_CAP[state];
  if (cap === 0) return [];
  const teachers = participants.filter((p) => p.isTeacher);
  const others = participants.filter((p) => !p.isTeacher);
  return [...teachers, ...others].slice(0, cap);
}
