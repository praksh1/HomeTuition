/**
 * What the app asks of a video provider, in the app's own words.
 *
 * Nothing in here names LiveKit or Daily. A screen that wants a call asks `lib/video` for one
 * and gets back a `VideoSession` — nine verbs and three subscriptions — and that is the whole
 * vocabulary. The point is that swapping the provider underneath is a new file in this folder,
 * not an edit to every screen that shows a lesson.
 *
 * ## Why a handle rather than module-level state
 *
 * `joinRoom` returns the session; every other verb is a method on it. A module holding "the
 * current call" in a variable reads more simply and is wrong in the two cases that matter: a
 * screen that unmounts while its call is still connecting, and Metro's fast refresh replacing
 * the module while a call is live. Both leave a stale singleton that later verbs act on. A
 * handle the component owns dies when the component does.
 *
 * `lib/video/index.ts` does also export the verbs as free functions, because that is the shape
 * asked for; they delegate to the handle and refuse politely when there is no call.
 *
 * ## Scope, stated honestly
 *
 * The only implementation of this contract today is LiveKit, and it is web-only — Daily and
 * LiveKit each ship a fork of the same native WebRTC library and cannot both be in one phone
 * build, so Android and iOS stay on Daily's own component. That is why the media handles below
 * are typed against `HTMLMediaElement` rather than something platform-neutral: inventing a
 * general type for a case that does not exist yet would be a guess presented as a design.
 */

/**
 * Where the call is, and who is arriving.
 *
 * Every field comes from the server. In particular the token is minted by the API from
 * `LIVEKIT_API_SECRET`, which never reaches this process — see
 * `api-server/src/lib/video/livekitProvider.ts`.
 */
export interface JoinRoomOptions {
  /** The provider's address. For LiveKit, the project's `wss://` URL. */
  url: string;
  /** The signed join token. Without one the provider refuses, which is the correct outcome. */
  token: string;
  /**
   * Start with the camera off and never turn it on until asked.
   *
   * The low-bandwidth path: audio plus the whiteboard, which is the part of a lesson that
   * actually carries the teaching. See `setAudioOnly`.
   */
  audioOnly?: boolean;
  /** Start muted. The classroom does not, but a lobby preview would. */
  startMuted?: boolean;
}

/** Where a call is, from the app's point of view. */
export type VideoConnectionState =
  /** Negotiating. Nothing is on screen yet. */
  | "connecting"
  /** Media is flowing. */
  | "connected"
  /**
   * Dropped and trying again by itself.
   *
   * Distinct from `disconnected` because the correct thing to show a teacher is "reconnecting",
   * not an error — the SDK is retrying and usually wins. Only if it gives up does this become
   * `disconnected`.
   */
  | "reconnecting"
  /** Gone, whether by leaving deliberately or by giving up. */
  | "disconnected";

/** How well this person's connection is holding up. */
export type VideoConnectionQuality = "excellent" | "good" | "poor" | "lost" | "unknown";

/**
 * A camera or microphone that would not start.
 *
 * Separated by cause because the remedy differs and only one of them is the app's fault to
 * explain: a denied permission needs a browser instruction, a missing device needs hardware, a
 * device in use needs another app closed.
 */
export interface MediaProblem {
  kind: "camera" | "microphone" | "screen";
  reason: "denied" | "missing" | "in-use" | "unknown";
}

/**
 * A track somebody is sending, with the two operations a view needs.
 *
 * Opaque on purpose. The component attaches it to an element and detaches on unmount; it never
 * unwraps it, so the provider underneath can change without the component knowing.
 */
export interface VideoMediaHandle {
  /** Unique per publication, so a list can key on it without re-attaching on every render. */
  id: string;
  attach(element: HTMLMediaElement): void;
  detach(element: HTMLMediaElement): void;
}

/** Somebody in the call. */
export interface VideoParticipant {
  /**
   * The Sikshya account id, as minted into the token.
   *
   * Not the display name: two students called Sita would otherwise be one row. The server sets
   * this — see `providerUserId` — so it can be trusted here.
   */
  id: string;
  /** What to show. May repeat across people; never used as a key. */
  name: string;
  isLocal: boolean;
  isSpeaking: boolean;
  micEnabled: boolean;
  cameraEnabled: boolean;
  /** Their camera, if they are sending one and it has been subscribed. */
  camera: VideoMediaHandle | null;
  /** Their screen, if they are sharing one. Only a teacher's token permits this. */
  screen: VideoMediaHandle | null;
  /**
   * Their microphone.
   *
   * Null for the local participant — a browser playing your own microphone back at you is
   * feedback, so the local audio track is deliberately never offered for attachment.
   */
  microphone: VideoMediaHandle | null;
  quality: VideoConnectionQuality;
}

/** Cancels a subscription. Every `on…` returns one; call it on unmount. */
export type Unsubscribe = () => void;

/**
 * A live call.
 *
 * The verbs are the ones the app actually performs. `toggleMic`, `toggleCamera` and the two
 * screen-share calls return the state they left things in rather than void, so a caller never
 * has to guess whether a toggle took effect — a denied camera permission means `toggleCamera`
 * returns `false` and reports through `onMediaProblem`.
 */
export interface VideoSession {
  /** Which implementation is carrying this, for diagnostics and nothing else. */
  readonly provider: string;

  /** Leave and release the camera and microphone. Safe to call twice. */
  leaveRoom(): Promise<void>;

  /** @returns whether the microphone is now on. */
  toggleMic(on?: boolean): Promise<boolean>;

  /**
   * @returns whether the camera is now on.
   *
   * Refuses while audio-only is set, rather than fighting it: a caller that wants the camera
   * back calls `setAudioOnly(false)` first, so there is one place where that decision lives.
   */
  toggleCamera(on?: boolean): Promise<boolean>;

  /**
   * Front camera to back and back again.
   *
   * A phone-shaped verb that mostly no-ops on a laptop with one camera; it is in the contract
   * because a browser on a phone does have two, and a teacher pointing the back camera at a
   * page of working is a real thing that happens.
   *
   * @returns whether a different camera is now in use.
   */
  switchCamera(): Promise<boolean>;

  /** @returns whether a screen is now being shared. False if the person cancelled the picker. */
  startScreenShare(): Promise<boolean>;
  stopScreenShare(): Promise<void>;

  /** Everyone in the room right now, local participant first. A fresh array each call. */
  getParticipants(): VideoParticipant[];

  /**
   * Turn everybody's video off, or back on.
   *
   * Both directions: it stops this person publishing a camera *and* stops subscribing to
   * anyone else's, which is the half that matters on a weak connection — receiving four
   * cameras costs more than sending one. The whiteboard and the audio are untouched, which is
   * the point: the lesson continues, it just stops carrying faces.
   */
  setAudioOnly(on: boolean): Promise<void>;
  readonly audioOnly: boolean;

  /**
   * The browser is refusing to play sound until somebody clicks something.
   *
   * Not an edge case — it is the default in Chrome and Safari for a page the person has not
   * interacted with, and a class arriving through a deep link is exactly that. Without a
   * visible way out, the lesson is silent and the student's only clue is that nobody is
   * talking. `unblockAudio` is what the button calls.
   */
  readonly audioBlocked: boolean;
  unblockAudio(): Promise<void>;

  onConnectionStateChange(fn: (state: VideoConnectionState) => void): Unsubscribe;
  /** Fires on any change to the roster: joins, leaves, mutes, track publications, quality. */
  onParticipantsChange(fn: (participants: VideoParticipant[]) => void): Unsubscribe;
  /** A camera or microphone that would not start, with the cause. */
  onMediaProblem(fn: (problem: MediaProblem) => void): Unsubscribe;
}
