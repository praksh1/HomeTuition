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
}

/** What the room route hands back. Named for what it is, not for whoever is providing it. */
export interface RoomGrant {
  provider: string;
  roomUrl: string;
  token: string | null;
  isOwner: boolean;
  capabilities: VideoCapabilities;
}
