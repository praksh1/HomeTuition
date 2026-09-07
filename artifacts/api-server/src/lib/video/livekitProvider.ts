// `TrackSource` is re-exported by the server SDK, so this needs no second dependency — importing
// it from `@livekit/protocol` directly would mean depending on a transitive package by name.
import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { logger } from "../logger";
import { providerUserId } from "./participantIdentity";
import { roomNameForSession } from "./roomName";
import type { JoinOptions, VideoProvider } from "./types";

/**
 * LiveKit Cloud, behind the same interface Daily uses.
 *
 * Nothing in `lib/daily.ts` is touched by this file existing. Both providers sit behind
 * `lib/video/index.ts`, `VIDEO_PROVIDER` chooses between them, and the default is still `daily`
 * — so switching back is one environment variable and no rebuild.
 *
 * ## The secret never leaves this process
 *
 * `LIVEKIT_API_SECRET` signs a JWT here and is never sent anywhere. What reaches the browser is
 * the signed token and the `wss://` address, which is exactly what a client needs and nothing
 * more. A client holding the secret could mint itself a token for any room in the project,
 * including a class it never paid for — so `scripts/video-tests` asserts the secret appears in no
 * response body.
 *
 * ## Rights are decided here, never by the client
 *
 * `isOwner` comes from `lib/membership.ts` — this server's single answer to "may this user be in
 * this class?" — and is the only thing that turns on `roomAdmin` and screen sharing. A token is
 * minted server-side precisely so its claims are ours.
 *
 * ## What is deliberately not done
 *
 * **No room is pre-created.** LiveKit creates a room when the first authorised participant joins,
 * so `ensureRoom` needs no network call at all. Daily works the other way — a room that was never
 * created via its REST API cannot be joined — which is why `lib/daily.ts` has a room lifecycle and
 * this file does not. Pre-creating rooms here to set per-room limits is a real option later; it
 * would cost an API call on every join for something the token already constrains.
 *
 * **No webhook ingestion.** Provider-corroborated attendance (`routes/sessionProof.ts`) is written
 * against Daily's callback format and is switched off in every environment. Running on LiveKit
 * does not break it; it leaves it equally off. LiveKit signs its webhooks differently, so turning
 * that on for LiveKit is its own piece of work — see SESSION-PROOF.md.
 *
 * **The documentation could not be read.** `docs.livekit.io` is blocked by this environment's
 * network egress proxy, so everything here is written against the installed SDK's own TypeScript
 * definitions — which are authoritative for the API surface — rather than against a guide. The
 * behaviour that only a live server can confirm is listed in VIDEO.md under the LiveKit trial.
 */

/**
 * Eight hours — the ceiling, and what a token gets when nothing says otherwise.
 *
 * Matches the Daily token. It is a ceiling rather than the value because a token good for eight
 * hours is a credential somebody still holds long after the class it was minted for.
 */
const TOKEN_TTL_CEILING_SECONDS = 60 * 60 * 8;

/**
 * The shortest token this will ever mint.
 *
 * A floor is needed because expiry is checked against the *server's* clock with roughly a
 * minute of leeway, and a token minted seconds before the cutoff would otherwise be dead on
 * arrival. Five minutes past a cutoff costs nothing: the room route refuses to mint a token at
 * all once a class is past it, so this only ever covers somebody who was already let in.
 */
const TOKEN_TTL_FLOOR_SECONDS = 60 * 5;

/**
 * How long this credential should live, from when the class stops being enterable.
 *
 * ## Why this is safe, and how that was established
 *
 * The obvious worry about a short-lived token is that it expires while a lesson is running and
 * hangs up on a class. It does not. Run against a real `livekit-server`
 * (`sikshya/scripts/livekit-live`, and the experiment recorded in VIDEO.md): a participant
 * connected on a twenty-second token stayed connected for **two hundred seconds past expiry**
 * with no `Disconnected` and no `Reconnecting` event. Expiry is checked when the signal
 * connection is established and not afterwards — joining and rejoining with an expired token
 * are both refused with `token has invalid claims: token is expired`.
 *
 * So the token is a *door key, not a heartbeat*. Shortening it cannot interrupt anybody already
 * inside; it only stops the key opening the door again once the class is over.
 *
 * That measurement is the whole reason this changed. It was left at eight hours precisely
 * because the answer was unknown and guessing wrong would drop students mid-lesson.
 */
function ttlSecondsFor(expiresAt: number | undefined, now: number): number {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return TOKEN_TTL_CEILING_SECONDS;
  const seconds = Math.ceil((expiresAt - now) / 1000);
  return Math.min(TOKEN_TTL_CEILING_SECONDS, Math.max(TOKEN_TTL_FLOOR_SECONDS, seconds));
}

/**
 * The REST address, from the `wss://` one the app is given.
 *
 * LiveKit's HTTP API lives on the same host as the signalling socket; the scheme is the only
 * difference. Converted in one place so a second caller cannot invent a slightly different
 * rule — `lib/video/diagnose.ts` does the same conversion for the credentials check.
 */
function httpsFrom(url: string): string {
  return url.trim().replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

interface LiveKitConfig {
  apiKey: string;
  apiSecret: string;
  url: string;
}

/**
 * The three variables, or null.
 *
 * All three or none: a half-configured provider that mints unsigned tokens, or signs tokens for a
 * server nobody can reach, fails in a way that looks like a network problem to everyone involved.
 */
function config(): LiveKitConfig | null {
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  const url = process.env.LIVEKIT_URL?.trim();
  if (!apiKey || !apiSecret || !url) return null;
  return { apiKey, apiSecret, url };
}

export const livekitProvider: VideoProvider = {
  name: "livekit",

  /**
   * The browser, and only the browser.
   *
   * Measured rather than assumed: Daily and LiveKit each ship a fork of the same native WebRTC
   * library — 33 identical Android classes and 47 identical iOS classes, both declaring the
   * namespace `com.oney.WebRTCModule` and registering the React Native module as
   * `WebRTCModule` — and neither SDK can be installed without its fork. One phone build cannot
   * hold both, so the phone builds hold Daily.
   *
   * Declaring it here is what makes the trial usable on one deployment: the room route reads
   * this, gives a browser LiveKit and a phone Daily, and nobody has to remember not to set the
   * variable.
   */
  platforms: ["web"],

  capabilities: {
    /**
     * True on the web, which is the only place this provider runs.
     *
     * The phone apps stay on Daily: both SDKs ship a fork of the same native WebRTC library, with
     * 33 identical Android classes under `com.oney.WebRTCModule` and 47 identical iOS classes, so
     * one build cannot contain both. Measured, not assumed — see the LiveKit section of VIDEO.md.
     */
    screenShare: true,
    /**
     * False, and this is the useful half of the flag.
     *
     * Daily Prebuilt brings a chat panel this app hides; LiveKit brings no UI at all. Either way
     * the class's own chat is the only one, because it survives the call ending, reaches people
     * who have not joined yet, and does not split a class in two.
     */
    builtInChat: false,
    /**
     * True, and the reason this provider is worth the trial at all.
     *
     * A student's token permits publishing nothing; `setPublishing` below is the only way that
     * ever changes, and it runs on the server in response to a teacher's decision. That is a
     * classroom with a floor in it rather than a conference call where the loudest person wins.
     */
    moderatesPublishing: true,
  },

  configured() {
    return config() !== null;
  },

  /**
   * Where to join. No network call, no room creation.
   *
   * The `wss://` address of the project, unchanged for every class — the room itself is named in
   * the token, and LiveKit brings it into being when the first authorised person arrives.
   */
  async ensureRoom(sessionId: string | number): Promise<string> {
    const settings = config();
    if (!settings) {
      /*
        Never throw video away over configuration.

        `selectProvider` already refuses to leave a platform without video over a typo'd provider
        name; this is the same instinct one level down. The classroom gets an address that will
        not connect and says so, which is a bad lesson — but a thrown error here is a 500 on the
        room route, which is no lesson at all and no explanation either.
      */
      logger.warn(
        { sessionId },
        "LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET are not all set; returning an unusable room address",
      );
      return "";
    }
    return settings.url;
  },

  /**
   * A JWT authorising exactly one person for exactly one class's room.
   *
   * Null when the provider is unconfigured, which is the same contract Daily has: the caller may
   * then join without a token, and without one LiveKit refuses — which is the correct outcome for
   * a deployment that has not been given credentials.
   */
  async joinToken(sessionId: string | number, options: JoinOptions): Promise<string | null> {
    const settings = config();
    if (!settings) return null;

    /*
      Identity is the Fadko user id, not a name.

      LiveKit reports `identity` on participants and in webhooks, and two students called Sita
      would otherwise be indistinguishable in the record of who was in the room. The display name
      is carried separately, where a duplicate costs nothing.
    */
    const identity = providerUserId(options.userId);
    if (identity === null) {
      logger.error({ sessionId }, "refusing to mint a LiveKit token without a usable participant identity");
      return null;
    }

    try {
      const token = new AccessToken(settings.apiKey, settings.apiSecret, {
        identity,
        name: options.userName,
        // The class's own cutoff when the caller knows it, the eight-hour ceiling when it does not.
        ttl: ttlSecondsFor(options.expiresAt, Date.now()),
      });

      token.addGrant({
        roomJoin: true,
        room: roomNameForSession(sessionId),
        canSubscribe: true,
        /**
         * **A student's token permits nothing to be published.**
         *
         * This is the security boundary of the whole classroom, and it is a signed claim rather
         * than a hidden button. Before this, every token said `canPublish: true` and the class
         * relied on the app not offering a microphone control — which protects against a student
         * who behaves, and against nobody else. A browser console was enough to publish into a
         * lesson.
         *
         * A student is granted the floor by the *server*, in response to a teacher's decision,
         * through `RoomServiceClient.updateParticipant`. That path is in `grantPublishing`
         * below, it consults `lib/classroom/speakingFloor.ts`, and it is the only way a
         * microphone or camera is ever permitted.
         */
        canPublish: options.isOwner,
        // The app's own signalling runs over its own WebSocket; nothing needs LiveKit's data
        // channel, and a capability nobody uses is a capability nobody is watching.
        canPublishData: false,
        /**
         * Moderator rights, and only for this class's own teacher.
         *
         * `roomAdmin` is what lets somebody mute or remove another participant. It is not a UI
         * decision: a student who could call the LiveKit API directly could eject their teacher,
         * so the restriction has to live in the signed token rather than in a hidden button.
         */
        roomAdmin: options.isOwner,
        /**
         * The teacher publishes; a student starts with an empty list.
         *
         * An empty `canPublishSources` alongside `canPublish: false` is belt and braces on
         * purpose: the two are separate fields in the protocol and a future SDK that reads one
         * without the other must still refuse.
         */
        canPublishSources: options.isOwner
          ? [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
          : [],
      });

      // Async in livekit-server-sdk v2. Returning the promise unawaited would hand the app a
      // "[object Promise]" and fail at join with nothing useful in the logs.
      return await token.toJwt();
    } catch (err) {
      logger.error({ err, sessionId }, "could not mint a LiveKit access token");
      return null;
    }
  },

  /**
   * Tell LiveKit what one participant may now publish.
   *
   * The other half of the boundary the token opened above. A student joins able to publish
   * nothing; this is the single path by which that ever changes, and it runs on the server in
   * response to a teacher's decision that `lib/membership.ts` has already authorised.
   *
   * **`updateParticipant`, not a new token.** Re-minting would mean handing the client a fresh
   * credential and asking it to reconnect with it — a reconnection mid-lesson, and a moment
   * where the old token is still valid. Updating the live participant applies immediately, to
   * the participant the server names, and leaves nothing reusable behind.
   *
   * Returns whether it took effect rather than throwing: a student who dropped off a second
   * before the teacher pressed the button is an ordinary event in a Nepali classroom, not an
   * error worth failing a request over. The caller records the outcome either way.
   */
  async setPublishing(
    sessionId: string | number,
    userId: number,
    rights: { canPublish: boolean; mic: boolean; camera: boolean },
  ): Promise<boolean> {
    const settings = config();
    if (!settings) return false;
    const identity = providerUserId(userId);
    if (identity === null) return false;

    const sources: TrackSource[] = [];
    if (rights.mic) sources.push(TrackSource.MICROPHONE);
    if (rights.camera) sources.push(TrackSource.CAMERA);

    /**
     * An empty source list is not "nothing" — to LiveKit it is "everything".
     *
     * From its own `protocol/auth/grants.go`, which is what the SFU actually runs:
     *
     * ```go
     * func (v *VideoGrant) GetCanPublishSource(source livekit.TrackSource) bool {
     *     if !v.GetCanPublish() { return false }
     *     if len(v.CanPublishSources) == 0 { return true }
     * ```
     *
     * So `canPublish: true` with no sources permits camera, microphone *and screen share*. The
     * only thing standing between a caller's mistake and that outcome is `canPublish`, so it is
     * forced false whenever there is nothing to permit. `publishRightsFor` already derives it
     * correctly; this is here because the consequence is severe enough to be worth refusing twice,
     * and because this file is the one that knows the rule.
     */
    const canPublish = rights.canPublish && sources.length > 0;

    try {
      const rooms = new RoomServiceClient(httpsFrom(settings.url), settings.apiKey, settings.apiSecret);
      await rooms.updateParticipant(roomNameForSession(sessionId), identity, undefined, {
        canSubscribe: true,
        canPublish,
        canPublishData: false,
        canPublishSources: sources,
      });
      /*
        Note what cannot be set from here: `roomAdmin` is not part of `ParticipantPermission`
        at all. Moderator rights exist only as a claim in the signed token, and the token gets
        them only from `isOwner`. So a permission update is structurally incapable of making
        somebody a moderator — it is not a rule this code enforces, it is one the protocol does,
        which is the better kind. The compiler rejected an earlier version of this that tried.
      */
      return true;
    } catch (err) {
      logger.warn({ err, sessionId, userId }, "could not update LiveKit publishing permission");
      return false;
    }
  },

  /**
   * Stop a track that is already live.
   *
   * Revoking permission stops somebody publishing *again*; it does not by itself silence a
   * microphone already open. A teacher pressing mute expects silence now, so the live track is
   * muted as well — which is why `endDiscussion` and `muteAllStudents` call both halves.
   */
  async silence(sessionId: string | number, userId: number): Promise<boolean> {
    const settings = config();
    if (!settings) return false;
    const identity = providerUserId(userId);
    if (identity === null) return false;

    try {
      const rooms = new RoomServiceClient(httpsFrom(settings.url), settings.apiKey, settings.apiSecret);
      const people = await rooms.listParticipants(roomNameForSession(sessionId));
      const who = people.find((p) => p.identity === identity);
      if (!who) return false;
      for (const track of who.tracks ?? []) {
        if (track.muted) continue;
        await rooms.mutePublishedTrack(roomNameForSession(sessionId), identity, track.sid, true);
      }
      return true;
    } catch (err) {
      logger.warn({ err, sessionId, userId }, "could not stop a LiveKit track");
      return false;
    }
  },
};
