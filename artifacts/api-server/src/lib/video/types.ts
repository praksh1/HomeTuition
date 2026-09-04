/**
 * What this product needs from a video provider — and nothing more.
 *
 * Daily.co is the only implementation today and it works. It is also, on the numbers, unlikely
 * to survive contact with the monthly tier: forty-five people in a ninety-minute call every day
 * is on the order of a hundred thousand participant-minutes per teacher per month, against a
 * NPR 6,500 subscription. Replacing it is a decided piece of future work.
 *
 * So this interface exists now, while there is one provider and nothing depends on the shape,
 * rather than later when a swap would mean touching every classroom screen. The rest of the
 * server asks for "a room and a token"; only the file next door knows the word Daily.
 *
 * ### It is deliberately small
 *
 * Two calls. Everything else this app needs during a lesson — presence, chat, the whiteboard,
 * the attendance record, the time limit — already runs over our own WebSocket and is not the
 * provider's business. That was true before this interface existed and it is why the interface
 * can be this thin: the provider carries audio and video, and nothing else.
 *
 * ### What a replacement has to give us
 *
 * A URL to join and a token that authorises one person for one room. That covers every serious
 * option: LiveKit (a `wss://` server and a JWT), Jitsi (a room URL and an optional JWT), 100ms,
 * or something built here. See VIDEO.md.
 */

export interface JoinOptions {
  /** Moderator rights. Only ever true for the teacher who owns the session, decided server-side. */
  isOwner: boolean;
  /** The name other people in the call see. */
  userName: string;
  /**
   * This server's own id for the person, as a string.
   *
   * Added when Stream arrived, and genuinely cross-provider rather than a Stream detail: every
   * candidate that mints its own token binds it to an identity — LiveKit's `identity`, Jitsi's
   * `context.user.id`, Stream's `user_id`. Daily does not use one and ignores it.
   *
   * It matters because a token bound to a person is a token that cannot be passed to somebody
   * else, and because the app has to send the *same* identity back when it opens the call.
   */
  userId: string;
  /**
   * How long the class is booked for, in minutes.
   *
   * Here because a token's expiry is only defensible if it is measured against the thing it
   * authorises. A flat lifetime was the first version of this and it was wrong: the monthly tier
   * is a ninety-minute lesson, and a provider whose client reconnects with the token it already
   * holds would have dropped somebody at the hour mark and refused to let them back in.
   *
   * Cross-provider for the same reason `userId` is: LiveKit, Jitsi and 100ms tokens all carry an
   * expiry, and the only honest input to it is how long the lesson lasts. Daily ignores it.
   */
  durationMinutes: number;
}

/**
 * The provider is selected but has no credentials.
 *
 * Its own type so the room route can tell "this server was never set up" apart from "the
 * provider had a bad minute", and answer differently: the first is a 503 the owner can act on,
 * the second a 502 worth retrying.
 *
 * `detail` names the missing environment variables and is **for the log, not for the response**.
 * Which variables a server is missing is not a thing to hand to anybody who can open a class.
 */
export class VideoNotConfiguredError extends Error {
  /**
   * Declared and assigned rather than written as a constructor parameter property.
   *
   * `readonly detail: string` in the parameter list is TypeScript-only syntax, and Node's
   * `--experimental-strip-types` refuses it outright — which took the whole provider test file
   * down rather than one test. The same constraint `select.ts` already documents, in a new place.
   */
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = "VideoNotConfiguredError";
    this.detail = detail;
  }
}

/**
 * What a provider can do, so the app stops guessing.
 *
 * Not speculative: the native Daily path genuinely cannot screen-share — that is why this app
 * carries its own chat rather than using the provider's — and a screen-share button that does
 * nothing is exactly the class of thing this project has had to remove before.
 */
export interface VideoCapabilities {
  screenShare: boolean;
  /** The provider brings its own chat panel. When false, the app's own chat is the only one. */
  builtInChat: boolean;
}

export interface VideoProvider {
  /** Named in the room payload so the app knows which call UI to mount. */
  readonly name: string;
  readonly capabilities: VideoCapabilities;

  /** True when this provider has the credentials it needs. */
  configured(): boolean;

  /**
   * Make sure a room exists for this class, and return where to join it.
   *
   * Must be safe to call repeatedly: it is called when a teacher starts a class and again by
   * every person who opens the room.
   */
  ensureRoom(sessionId: string | number): Promise<string>;

  /**
   * A token authorising one person to join one room.
   *
   * Null when the provider does not use tokens. Never minted from anything the client says
   * about itself — `isOwner` comes from the server's own membership check.
   */
  joinToken(sessionId: string | number, options: JoinOptions): Promise<string | null>;

  /**
   * What this provider will call the person the token was minted for.
   *
   * Optional, because a provider may not have identities at all — Daily does not implement this
   * and the room grant then carries `null`. Implemented by anything whose client has to be
   * handed a user object alongside the token, which is most of them, and it lives here rather
   * than in the route so the transformation and the token can never disagree.
   */
  identityFor?(userId: string): string;
}

/** What the room route hands back. Named for what it is, not for whoever is providing it. */
export interface RoomGrant {
  provider: string;
  roomUrl: string;
  token: string | null;
  isOwner: boolean;
  capabilities: VideoCapabilities;
  /** Who the token says you are, when the provider uses identities. Null when it does not. */
  identity: string | null;
}
