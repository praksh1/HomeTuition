import type { CallParticipant } from "@/utils/streamCallState";
import type { IncomingVideoPreference } from "@/utils/streamRoom";
import type {
  StreamBridgeEvents,
  StreamBridgeSession,
  StreamMediaDevice,
  StreamSdk,
  StreamVideoViewProps,
} from "./streamBridge";
import type { ComponentType } from "react";

/**
 * Turning a Stream call object into the session the shell asked for.
 *
 * The same `Call` object is behind both of Stream's SDKs — `@stream-io/video-react-sdk` on the
 * web and `@stream-io/video-react-native-sdk` on a phone both wrap `@stream-io/video-client` —
 * so this mapping is written once and each platform's adapter supplies only the two things that
 * genuinely differ: how the client is constructed, and what paints a video.
 *
 * ### It is typed against a shape, not against Stream
 *
 * `StreamCallLike` below describes the handful of methods used, rather than importing Stream's
 * types. Three reasons, in order of how much they matter:
 *
 * 1. The SDK is not installed on this branch — see `streamSdk.ts` for why installing it would
 *    break Daily — so a real import would not compile.
 * 2. A fake call object can therefore be handed to this file in a test, which is how every rule
 *    below is checked without an account, a network or a phone.
 * 3. It keeps the promise the seam makes: nothing above `streamBridge.ts` knows a brand name.
 *
 * Every method named here was read out of `@stream-io/video-client@1.59.0`'s published type
 * definitions, not guessed. The exact signatures are in STREAM.md with the version they came
 * from, because a shape copied from documentation goes stale silently.
 */

/** The subset of Stream's `Call` this app uses. Checked against 1.59.0's `Call.d.ts`. */
export interface StreamCallLike {
  join(options?: { create?: boolean }): Promise<unknown>;
  leave(options?: { reason?: string }): Promise<void>;
  /**
   * Not declared, and not by omission.
   *
   * Stream's `Call` has `endCall()`. This app must not call it: ending a class is Sikshya's
   * business — session status, the reminder, the attendance record, the teacher's confirmation —
   * and a provider-side end would stop the video while the application went on believing the
   * lesson was running. Leaving it off this shape means a future edit cannot reach for it by
   * accident. See `callControls` in utils/streamCallState.ts.
   */

  screenShare: { enable(): Promise<void>; disable(): Promise<void> };

  sendReaction(reaction: { type: string; emoji_code?: string; custom?: object }): Promise<unknown>;
  /** Takes a **user** id. A session id matches nobody and reports no error. */
  muteUser(userId: string | string[], type: "audio" | "video" | "screenshare"): Promise<unknown>;
  kickUser(request: { user_id: string; block?: boolean }): Promise<unknown>;

  setPreferredIncomingVideoResolution(
    resolution: { width: number; height: number } | undefined,
    sessionIds?: string[],
  ): void;
  setIncomingVideoEnabled(enabled: boolean): void;

  state: {
    participants$: Subscribable<StreamParticipantLike[]>;
    /**
     * Where reconnection actually comes from.
     *
     * `CallingState` is a real string enum in `@stream-io/video-client@1.59.0`
     * (`store/CallingState.d.ts`) with `joining`, `joined`, `reconnecting`, `migrating`,
     * `reconnecting-failed`, `offline`, `left`, `idle`, `ringing`, `unknown`, and
     * `call.state.callingState$` is a real observable of it. The first version of this adapter
     * declared `onReconnecting` / `onRejoined` on the bridge and never emitted either, so the
     * reducer's handling of them was scaffolding with nothing behind it.
     */
    callingState$: Subscribable<string>;
  };

  /**
   * Per-device permission, which is what makes a refused camera survivable.
   *
   * `hasBrowserPermission$` is a real observable on each device manager's state
   * (`devices/DeviceManagerState.d.ts`). There is one per manager, so the camera's answer and
   * the microphone's are genuinely separate rather than one flag serving both.
   */
  camera: {
    enable(): Promise<void>;
    disable(): Promise<void>;
    flip?(): Promise<void>;
    state?: { hasBrowserPermission$?: Subscribable<boolean> };
  };
  microphone: {
    enable(): Promise<void>;
    disable(): Promise<void>;
    state?: { hasBrowserPermission$?: Subscribable<boolean> };
  };

  on(event: string, handler: (payload: any) => void): () => void;
}

/** The shape of an rxjs subscription, without importing rxjs. */
export interface Subscribable<T> {
  subscribe(observer: (value: T) => void): { unsubscribe(): void };
}

/**
 * The `CallingState` values this app acts on.
 *
 * Copied from Stream's own enum rather than imported, because the SDK is not installed — and
 * pinned by a test, so a value that drifts is caught here rather than as a call that silently
 * stops reporting that it dropped.
 */
export const CALLING_STATE_JOINED = "joined";
export const CALLING_STATE_RECONNECTING = "reconnecting";
export const CALLING_STATE_MIGRATING = "migrating";
export const CALLING_STATE_RECONNECTING_FAILED = "reconnecting-failed";
export const CALLING_STATE_OFFLINE = "offline";
export const CALLING_STATE_LEFT = "left";

/** The subset of `StreamVideoParticipant` this app reads. */
export interface StreamParticipantLike {
  userId: string;
  sessionId: string;
  name?: string;
  isLocalParticipant?: boolean;
  publishedTracks?: number[];
  roles?: string[];
  reaction?: { type?: string; emoji_code?: string };
  screenShareStream?: unknown;
}

/**
 * Stream's track-type numbers, from the SFU model enum it publishes.
 *
 * Read off `TrackType` in `@stream-io/video-client`: AUDIO = 1, VIDEO = 2, SCREEN_SHARE = 3.
 * Written as named constants because `publishedTracks.includes(2)` in the middle of a component
 * is the kind of line that survives a rename by continuing to be wrong.
 */
export const TRACK_AUDIO = 1;
export const TRACK_VIDEO = 2;
export const TRACK_SCREEN_SHARE = 3;

/** Stream's own reaction type for a raised hand, from its React Native SDK's defaults. */
export const RAISED_HAND_REACTION = "raised-hand";
export const RAISED_HAND_EMOJI = ":raised-hand:";

/**
 * Who counts as the teacher.
 *
 * The server already said, in the room grant, and the name it gave is the one the token was
 * minted with — so matching on it is matching on something the server decided. A participant's
 * own `roles` are not consulted for this: Stream's role does gate what a person may *do*, but
 * asking the client's copy of it who to put first in the strip would be asking a participant
 * about themselves.
 */
function isTeacherParticipant(p: StreamParticipantLike, teacherName?: string): boolean {
  return Boolean(teacherName) && (p.name ?? "") === teacherName;
}

export function toCallParticipant(
  p: StreamParticipantLike,
  teacherName?: string,
): CallParticipant {
  const published = p.publishedTracks ?? [];
  return {
    /**
     * Both identifiers, kept apart, because they are answers to different questions.
     *
     * `userId` is the person and is what Stream's `muteUser` and `kickUser` want. `sessionId` is
     * the connection and is what a video track belongs to. Collapsing them into one field is the
     * defect this replaced: moderation was being handed a session id, which matches nobody and
     * returns no error — a teacher would have pressed Mute and watched nothing happen.
     */
    userId: p.userId,
    sessionId: p.sessionId,
    name: p.name || "Guest",
    isLocal: Boolean(p.isLocalParticipant),
    isTeacher: isTeacherParticipant(p, teacherName),
    micOn: published.includes(TRACK_AUDIO),
    camOn: published.includes(TRACK_VIDEO),
    handRaised: p.reaction?.type === RAISED_HAND_REACTION,
    sharingScreen: published.includes(TRACK_SCREEN_SHARE) || Boolean(p.screenShareStream),
  };
}

/**
 * Wire a live call to the shell.
 *
 * Returns the session the shell drives, and starts feeding it participants and events. The
 * unsubscribe is folded into `leave()` so a caller that only ever calls the one method it knows
 * about still cannot strand a subscription.
 */
export function createStreamSession(options: {
  call: StreamCallLike;
  events: StreamBridgeEvents;
  teacherName?: string;
  VideoView: ComponentType<StreamVideoViewProps>;
  /** Web has a device list; a phone mostly has front and back. Absent where it is absent. */
  listDevices?: (kind: "camera" | "microphone") => Promise<StreamMediaDevice[]>;
  selectDevice?: (kind: "camera" | "microphone", deviceId: string) => Promise<void>;
}): StreamBridgeSession {
  const { call, events, teacherName, VideoView } = options;

  const offs: (() => void)[] = [];
  const track = <T,>(source: Subscribable<T> | undefined, observer: (value: T) => void) => {
    if (!source) return;
    const subscription = source.subscribe(observer);
    offs.push(() => subscription.unsubscribe());
  };

  track(call.state.participants$, (participants) => {
    events.onParticipants(participants.map((p) => toCallParticipant(p, teacherName)));
  });

  /**
   * Reconnection, from Stream's own call state rather than from hope.
   *
   * `callingState$` is the observable Stream drives itself; the values are its `CallingState`
   * enum. `migrating` counts as reconnecting because from a student's chair it is the same
   * thing — the picture stops and comes back — and `reconnecting-failed` and `offline` are the
   * two that are not coming back on their own, so they are told the truth instead of being left
   * on "trying to get back in…" forever.
   *
   * `joined` only produces `onRejoined`; the reducer ignores it unless something was actually
   * reconnecting, so the first join does not race the `onJoined` the connect path already sends.
   */
  let sawReconnecting = false;
  /**
   * A departure is announced once, and it ends the story.
   *
   * Stream reports the end of a call **twice**: the `call.ended` event fires and `callingState$`
   * moves to `left`. Both used to reach `onLeft`, and in the teacher's classroom `onLeft` marks
   * the session completed and cancels its reminder — so ending a class sent that twice.
   *
   * `departed` also stops anything arriving afterwards. A `reconnecting` that lands after a call
   * has ended is not a wobble to show somebody; the reducer already refuses it, and refusing it
   * here as well means the two ends cannot disagree about what happened.
   */
  let departed = false;
  const announceLeft = () => {
    if (departed) return;
    departed = true;
    events.onLeft();
  };

  track(call.state.callingState$, (callingState) => {
    if (departed) return;
    switch (callingState) {
      case CALLING_STATE_RECONNECTING:
      case CALLING_STATE_MIGRATING:
        sawReconnecting = true;
        events.onReconnecting();
        return;
      case CALLING_STATE_JOINED:
        if (sawReconnecting) {
          sawReconnecting = false;
          events.onRejoined();
        }
        return;
      case CALLING_STATE_RECONNECTING_FAILED:
        events.onError("The connection could not be recovered. Please rejoin the class.");
        return;
      case CALLING_STATE_OFFLINE:
        events.onError("This device is offline. Please rejoin when you have a connection.");
        return;
      case CALLING_STATE_LEFT:
        announceLeft();
        return;
      default:
        // joining, idle, ringing, unknown — nothing this shell shows differently.
        return;
    }
  });

  /**
   * Each device's permission, watched separately.
   *
   * `hasBrowserPermission$` emits the current answer immediately on subscribe, so the initial
   * `true` for a device nobody has refused arrives as a `granted` the reducer treats as a no-op.
   * `state` is optional on the shape above because the phone SDK's managers are not guaranteed
   * to expose it in every version — a missing observable means the shell simply never claims a
   * device was refused, which is the honest failure direction.
   */
  track(call.camera.state?.hasBrowserPermission$, (allowed) => {
    if (allowed) events.onPermissionGranted("camera");
    else events.onPermissionDenied("camera", "Your camera is blocked. Everything else works.");
  });
  track(call.microphone.state?.hasBrowserPermission$, (allowed) => {
    if (allowed) events.onPermissionGranted("microphone");
    else {
      events.onPermissionDenied(
        "microphone",
        "Your microphone is blocked. You can hear, but not speak.",
      );
    }
  });

  offs.push(
    call.on("call.reaction_new", (payload: any) => {
      const emoji = payload?.reaction?.emoji_code;
      const from = payload?.reaction?.user?.id;
      if (!emoji || !from) return;
      // A raised hand is a participant state, not a burst of confetti — it shows on their tile
      // through `handRaised` and is deliberately not queued here as well.
      if (payload?.reaction?.type === RAISED_HAND_REACTION) return;
      // The user id, so the shell can put a name beside the emoji and so one person tapping
      // repeatedly replaces their own reaction instead of filling the row.
      events.onReaction({
        userId: String(from),
        name: payload?.reaction?.user?.name || "Someone",
        emoji: String(emoji),
      });
    }),
  );

  offs.push(
    call.on("call.ended", () => {
      // The call is over for everybody. Not an error and not a network failure — the same
      // outcome as this person pressing Leave, and it must read that way in the classroom.
      // Announced through the same guard as `callingState$`, because Stream reports the end
      // both ways and the classroom acts on it.
      announceLeft();
    }),
  );

  const stop = () => {
    for (const off of offs.splice(0)) {
      try {
        off();
      } catch {
        // A listener that will not detach must not stop the call from being left.
      }
    }
  };

  return {
    async setMicrophone(on) {
      await (on ? call.microphone.enable() : call.microphone.disable());
    },
    async setCamera(on) {
      await (on ? call.camera.enable() : call.camera.disable());
    },
    async raiseHand(raised) {
      // Stream carries a raised hand as a reaction of its own type. Lowering it is the same
      // message with `custom.raised: false` — the SDK has no separate "unraise", so the state
      // the shell shows is the authority and this keeps the two ends in step.
      await call.sendReaction({
        type: RAISED_HAND_REACTION,
        emoji_code: RAISED_HAND_EMOJI,
        custom: { raised },
      });
    },
    async sendReaction(emoji) {
      await call.sendReaction({ type: "reaction", emoji_code: emoji, custom: {} });
    },

    async startScreenShare() {
      await call.screenShare.enable();
    },
    async stopScreenShare() {
      await call.screenShare.disable();
    },

    async muteParticipant(userId) {
      // Audio only. Muting somebody's camera as well is a second decision and the teacher has
      // not made it; a control that does more than its label is how trust in one goes.
      await call.muteUser(userId, "audio");
    },
    async removeParticipant(userId) {
      // Not blocked. A student removed from a class they paid for must be able to come back —
      // whether they should is a refund question, not one for a button in a video window.
      await call.kickUser({ user_id: userId, block: false });
    },

    async leave() {
      stop();
      await call.leave();
    },

    setIncomingVideo(preference: IncomingVideoPreference) {
      call.setIncomingVideoEnabled(preference.enabled);
      if (preference.enabled && preference.resolution) {
        call.setPreferredIncomingVideoResolution(preference.resolution);
      }
    },

    ...(options.listDevices ? { listDevices: options.listDevices } : null),
    ...(options.selectDevice ? { selectDevice: options.selectDevice } : null),
    ...(call.camera.flip ? { flipCamera: () => call.camera.flip!() } : null),

    VideoView,
  };
}


/* ---------------------------------------------------------------------------
 * Building a client out of whichever Stream module a platform loaded.
 * ------------------------------------------------------------------------- */

/**
 * The part of a Stream SDK module this app uses.
 *
 * Both of Stream's SDKs export `StreamVideoClient` — `@stream-io/video-react-sdk` on the web and
 * `@stream-io/video-react-native-sdk` on a phone — because both re-export it from
 * `@stream-io/video-client`. So the construction is written once here and each platform's loader
 * supplies only the module and the component that paints a video.
 */
export interface StreamClientModule {
  StreamVideoClient: new (options: {
    apiKey: string;
    user: { id: string; name?: string };
    token: string;
  }) => {
    call(type: string, id: string): StreamCallLike;
    disconnectUser(): Promise<void>;
  };
}

export function createStreamSdkFrom(
  mod: StreamClientModule,
  platform: {
    VideoView: ComponentType<StreamVideoViewProps>;
    listDevices?: (kind: "camera" | "microphone") => Promise<StreamMediaDevice[]>;
    selectDevice?: (kind: "camera" | "microphone", deviceId: string) => Promise<void>;
  },
): StreamSdk {
  return {
    ok: true,
    async connect(options) {
      /**
       * The client is built from what the server sent, and nothing else.
       *
       * `apiKey` is Stream's publishable half and arrived inside the room locator; `token` was
       * minted server-side, is scoped to this one call and expires within the hour; `userId` is
       * the identity that token was signed for, and sending a different one fails to
       * authenticate rather than quietly joining as somebody else. No Stream value is compiled
       * into the bundle, so switching the provider off at the server switches it off everywhere.
       */
      const client = new mod.StreamVideoClient({
        apiKey: options.apiKey,
        user: { id: options.userId, name: options.userName },
        token: options.token,
      });

      const call = client.call(options.callType, options.callId);

      const session = createStreamSession({
        call,
        events: options.events,
        teacherName: options.teacherName,
        VideoView: platform.VideoView,
        listDevices: platform.listDevices,
        selectDevice: platform.selectDevice,
      });

      try {
        // `create: false` on purpose. The call already exists — the server made it when it
        // handed out the room — and a client that could create one would be a client that could
        // open a call for a class nobody booked, which is the one check the room route exists
        // to make.
        await call.join({ create: false });
        options.events.onJoined();
      } catch (err) {
        options.events.onError(describeStreamError(err));
        throw err;
      }

      const leave = session.leave.bind(session);
      return {
        ...session,
        async leave() {
          await leave();
          // Closes the websocket as well as the call. Left out, a student who shut the classroom
          // would keep a connection open and go on counting as present — and presence is what
          // every refund rule in this product rests on.
          await client.disconnectUser().catch(() => {});
        },
      };
    },
  };
}

/** Stream rejects with plain objects as often as with Errors; "[object Object]" helps nobody. */
export function describeStreamError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  if (err && typeof err === "object") {
    for (const key of ["message", "errorMsg", "error", "reason"]) {
      const value = (err as Record<string, unknown>)[key];
      if (typeof value === "string" && value) return value;
    }
  }
  return "The video call could not be started.";
}
