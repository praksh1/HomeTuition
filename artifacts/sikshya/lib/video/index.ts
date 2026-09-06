import { joinLiveKitRoom } from "./livekit";
import type {
  JoinRoomOptions,
  MediaProblem,
  Unsubscribe,
  VideoConnectionState,
  VideoParticipant,
  VideoSession,
} from "./types";

export type {
  JoinRoomOptions,
  MediaProblem,
  Unsubscribe,
  VideoConnectionQuality,
  VideoConnectionState,
  VideoMediaHandle,
  VideoParticipant,
  VideoSession,
} from "./types";

/**
 * The app's video calling, in one door.
 *
 * Nothing outside this folder imports LiveKit, and nothing outside `components/VideoCall.tsx`
 * imports Daily. A screen that wants a call calls `joinRoom` and then speaks the nine verbs
 * below; which company is carrying the packets is not its business.
 *
 * ## Two shapes, one implementation
 *
 * `joinRoom` returns a `VideoSession` handle and every verb is a method on it. The same verbs
 * are also exported here as free functions that act on whichever call is currently open, which
 * is the shape a caller usually wants — there is only ever one class on screen.
 *
 * They are the same object. The free functions exist so a control can be wired up without
 * threading a handle through it; the handle exists because a component that owns a call needs
 * something that dies when it does. A free function called with no call open returns the safe
 * answer rather than throwing: `getParticipants` gives an empty list, the toggles report "off",
 * `leaveRoom` does nothing. A hang-up button pressed twice is not an error.
 *
 * ## Which provider
 *
 * The server decides, from `VIDEO_PROVIDER`, and sends the answer down with the room. This
 * module implements LiveKit; Daily keeps its own component, untouched, and `VideoCall.tsx` is
 * the switch between them. See VIDEO.md for why the two are not merged.
 */

/**
 * The call currently on screen, if there is one.
 *
 * A single slot rather than a list because the product has one: a person is in one class at a
 * time. `joinRoom` closes any previous call before opening the next, so a screen that remounts
 * during a bad reconnect cannot leave two rooms connected and two microphones live.
 */
let active: VideoSession | null = null;

/** The call currently open, or null. For a component that needs to hold a reference. */
export function currentSession(): VideoSession | null {
  return active;
}

export async function joinRoom(options: JoinRoomOptions): Promise<VideoSession> {
  // Never two at once. A leftover call keeps a microphone open and keeps being billed for.
  if (active) await active.leaveRoom().catch(() => undefined);
  const session = await joinLiveKitRoom(options);
  active = session;
  return session;
}

export async function leaveRoom(): Promise<void> {
  const session = active;
  if (!session) return;
  // Cleared first: `leaveRoom` awaits a disconnect, and a second press during that await should
  // find nothing rather than start a second teardown of the same room.
  active = null;
  await session.leaveRoom();
}

export function toggleMic(on?: boolean): Promise<boolean> {
  return active ? active.toggleMic(on) : Promise.resolve(false);
}

export function toggleCamera(on?: boolean): Promise<boolean> {
  return active ? active.toggleCamera(on) : Promise.resolve(false);
}

export function switchCamera(): Promise<boolean> {
  return active ? active.switchCamera() : Promise.resolve(false);
}

export function startScreenShare(): Promise<boolean> {
  return active ? active.startScreenShare() : Promise.resolve(false);
}

export function stopScreenShare(): Promise<void> {
  return active ? active.stopScreenShare() : Promise.resolve();
}

export function getParticipants(): VideoParticipant[] {
  return active ? active.getParticipants() : [];
}

/** Turn video off in both directions, leaving audio and the whiteboard running. */
export function setAudioOnly(on: boolean): Promise<void> {
  return active ? active.setAudioOnly(on) : Promise.resolve();
}

/** Whether the browser is holding the sound until somebody clicks. */
export function audioBlocked(): boolean {
  return active ? active.audioBlocked : false;
}

/** Must be called from inside a click handler, or the browser refuses again. */
export function unblockAudio(): Promise<void> {
  return active ? active.unblockAudio() : Promise.resolve();
}

/** A no-op unsubscribe, for the case where there is nothing to subscribe to. */
const NOTHING_TO_CANCEL: Unsubscribe = () => undefined;

export function onConnectionStateChange(fn: (state: VideoConnectionState) => void): Unsubscribe {
  if (!active) {
    /*
      No call, so the state is "disconnected" and it is told once.

      Silence would be the wrong answer: a caller subscribing before joining would sit on
      whatever it happened to render first. Saying the true current state immediately is the
      same contract a live session honours.
    */
    fn("disconnected");
    return NOTHING_TO_CANCEL;
  }
  return active.onConnectionStateChange(fn);
}

export function onParticipantsChange(fn: (participants: VideoParticipant[]) => void): Unsubscribe {
  if (!active) {
    fn([]);
    return NOTHING_TO_CANCEL;
  }
  return active.onParticipantsChange(fn);
}

export function onMediaProblem(fn: (problem: MediaProblem) => void): Unsubscribe {
  return active ? active.onMediaProblem(fn) : NOTHING_TO_CANCEL;
}
