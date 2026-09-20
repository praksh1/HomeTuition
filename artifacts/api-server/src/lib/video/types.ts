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
   * The authenticated Fadko user id, so a provider can say *who* joined and not merely that
   * somebody did.
   *
   * The provider echoes it back on the events it sends about the call, which is the difference
   * between "an account we can name was in the room" and "somebody with moderator rights was" —
   * and the second is not evidence a refund argument can rest on.
   *
   * **It grants nothing.** Rights come from `isOwner`, which comes from this server's own
   * membership check in `lib/membership.ts`. This is taken from the authenticated request and
   * never from a request body: an identity a client could choose is not an identity.
   */
  userId: number;
  /**
   * When this credential should stop working, as epoch milliseconds. Optional.
   *
   * The class's hard cutoff — `cutoffAt` in `lib/sessionStart.ts`, ten minutes past the booked
   * finish, after which no teacher may reopen the call. A provider that can express expiry
   * should use it; one that cannot may ignore it, which is why this is optional rather than
   * required. Daily's token lifetime is set by Daily and is untouched by this.
   *
   * It exists because a join token outliving its class is a credential somebody still holds
   * after a refund, after being unenrolled, and after the lesson they paid for ended.
   */
  expiresAt?: number;
}

/** What the classroom has decided one person may publish. Never assembled by a client. */
export interface PublishRights {
  canPublish: boolean;
  mic: boolean;
  camera: boolean;
}

/**
 * What happened when the server asked the provider to change something.
 *
 * ## Three answers, because two of them are not the same
 *
 * This was a `boolean`, and the false branch meant both "that student is not in the room" and
 * "the call to the provider failed" — which are opposite situations. An absent participant is
 * ordinary and safe: their token permits publishing nothing, so a grant they never received
 * cannot be used, and reconnecting re-pushes it. A failed call is the dangerous one: the floor
 * has moved, the class has been told, and the SFU has not agreed. Collapsing them meant a
 * classroom that reported a mute as done while a microphone was still open.
 *
 * `.agents/memory/refusals-must-name-their-reason.md` is this same lesson one layer down: when a
 * check folds several situations into one boolean, make it return which one and let the caller
 * decide what to say.
 */
export type ProviderApply =
  | { applied: true }
  /** The provider answered, and there is nobody by that identity in the room. */
  | { applied: false; reason: "absent" }
  /** The provider could not be asked, or refused. The change has **not** taken effect. */
  | { applied: false; reason: "failed"; error: string };

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
  /**
   * The server can decide, mid-call, who is allowed to publish a microphone or a camera.
   *
   * The whole raise-your-hand classroom rests on this one bit. Where it is false the feature is
   * not merely unstyled, it is *meaningless*: Daily Prebuilt lets every participant unmute
   * themselves, so a student asking permission would be asking for something they already have,
   * and a teacher's "mute" would be a button that does nothing while looking as though it had.
   *
   * So it is answered here rather than inferred from the provider's name, the hub refuses floor
   * actions when it is false, and the app hides the controls. All three, because a control the
   * server refuses is still a control that should never have been drawn.
   */
  moderatesPublishing: boolean;
}

/** The three places this app runs. What a client says it is; it confers nothing. */
export type ClientPlatform = "web" | "ios" | "android";

export const CLIENT_PLATFORMS: readonly ClientPlatform[] = ["web", "ios", "android"];

/**
 * The header a client uses to say which of those it is. Lowercase, as Express normalises it.
 *
 * A constant rather than a string typed at each call site, because it was two magic strings and
 * the Fadko rename moved one of them: the app began sending `X-Fadko-Platform` while the server
 * still read `x-sikshya-platform`, so every client fell through to the fallback and the LiveKit
 * trial would never have switched on for anybody. Nothing failed loudly — it just quietly did
 * the safe thing forever. One constant, and the mismatch cannot happen again.
 */
export const PLATFORM_HEADER = "x-fadko-platform";

export interface VideoProvider {
  /** Named in the room payload so the app knows which call UI to mount. */
  readonly name: string;
  readonly capabilities: VideoCapabilities;

  /**
   * Where this provider can actually run.
   *
   * Not a preference — a fact about the build. Daily and LiveKit each ship a fork of the same
   * native WebRTC library and cannot both be inside one phone app, so the Android and iOS
   * builds contain Daily and only Daily. A LiveKit room handed to a phone is a black rectangle.
   *
   * So the room route asks the client what it is and gives it a provider that works there. It
   * costs nothing to say and it is what lets the LiveKit trial be switched on for the browser
   * without taking video away from every phone on the platform — which, with one deployment,
   * is otherwise the choice.
   */
  readonly platforms: readonly ClientPlatform[];

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
   * Change what one participant may publish, mid-call, on the server's authority.
   *
   * Optional because it is a real capability rather than a universal one: Daily's classroom is
   * its own prebuilt interface and does not expose per-participant publish permissions to us,
   * so `dailyProvider` does not implement this and the classroom refuses the teacher's control
   * rather than pretending it worked. A provider that cannot enforce a permission must not be
   * asked to look as though it did.
   *
   * @returns whether the provider applied it, and if not, whether the participant was simply
   * absent or the call itself failed. The caller must not report a failure as a completed change.
   */
  setPublishing?(sessionId: string | number, userId: number, rights: PublishRights): Promise<ProviderApply>;

  /**
   * Stop whatever this participant currently has open.
   *
   * Separate from `setPublishing` because they answer different questions: one is "may they
   * speak again", the other is "are they speaking now". A teacher pressing mute means both.
   */
  silence?(sessionId: string | number, userId: number): Promise<ProviderApply>;
}

/** What the room route hands back. Named for what it is, not for whoever is providing it. */
export interface RoomGrant {
  provider: string;
  roomUrl: string;
  token: string | null;
  isOwner: boolean;
  capabilities: VideoCapabilities;
}
