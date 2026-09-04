import type { CallWindowState } from "./streamRoom";

/**
 * The call shell's state, with no video library anywhere near it.
 *
 * Sikshya owns the window — hidden, compact, normal, full; where it sits; which controls exist
 * and who may press them — and the provider owns the media inside it. This file is the first
 * half, written as a reducer so it can be tested without an SDK, without a phone, without a
 * network and without a Stream account.
 *
 * That is not a testing convenience. It is where the rules that matter live:
 *
 * - **A student never sees a control they may not use.** Ending the class for everybody, muting
 *   somebody else and removing them are the teacher's, and `isOwner` comes from the server's own
 *   membership check — never from the client, never from the provider. Stream refuses them too;
 *   this is the second no, so a misconfigured role in a dashboard cannot put an End button in
 *   front of a fifteen-year-old.
 * - **A control that cannot work is not drawn.** The screen-share button is the standing example
 *   in this codebase: the native Daily path cannot capture a screen, so the button had to go.
 * - **What the person is told is true.** "Reconnecting" only while it is reconnecting, and a
 *   failure names what failed.
 */

export type CallPhase =
  | "connecting"
  | "joined"
  /** The connection dropped and the SDK is trying again. Audio may still be going. */
  | "reconnecting"
  | "left"
  /** Something is wrong that this app cannot fix by retrying. `error` says what. */
  | "failed";

export type ScreenSharePhase = "idle" | "starting" | "sharing";

export interface CallParticipant {
  id: string;
  name: string;
  isLocal: boolean;
  /** Decided from the server's own room grant, not from anything the participant says. */
  isTeacher: boolean;
  micOn: boolean;
  camOn: boolean;
  handRaised: boolean;
  sharingScreen: boolean;
}

export interface CallState {
  phase: CallPhase;
  /** Present whenever `phase` is "failed". Shown to the person, so it has to read like English. */
  error: string | null;
  micOn: boolean;
  camOn: boolean;
  handRaised: boolean;
  screenShare: ScreenSharePhase;
  /** True once the device has refused the camera or microphone. Not the same as "off". */
  permissionDenied: boolean;
  participants: CallParticipant[];
  /** Most recent first, and bounded — a class of forty-five can send a lot of these. */
  reactions: { id: string; participantId: string; emoji: string }[];
}

export const MAX_REMEMBERED_REACTIONS = 5;

export function initialCallState(): CallState {
  return {
    phase: "connecting",
    error: null,
    // Matches the server-side call settings: the microphone comes up, the camera does not.
    // Audio is the lesson; a camera is a courtesy that costs bandwidth nobody here has spare.
    micOn: true,
    camOn: false,
    handRaised: false,
    screenShare: "idle",
    permissionDenied: false,
    participants: [],
    reactions: [],
  };
}

export type CallAction =
  | { type: "joined" }
  | { type: "reconnecting" }
  | { type: "rejoined" }
  | { type: "left" }
  | { type: "failed"; error: string }
  | { type: "permission-denied"; error: string }
  | { type: "mic"; on: boolean }
  | { type: "camera"; on: boolean }
  | { type: "hand"; raised: boolean }
  | { type: "screen-share"; phase: ScreenSharePhase }
  | { type: "participants"; participants: CallParticipant[] }
  | { type: "reaction"; id: string; participantId: string; emoji: string };

export function callReducer(state: CallState, action: CallAction): CallState {
  switch (action.type) {
    case "joined":
      return { ...state, phase: "joined", error: null };

    case "reconnecting":
      /**
       * A failed call does not become a reconnecting one.
       *
       * The failure this guards is the same shape as the one the Daily web path already carries
       * a `joined` ref for: a join that never succeeded emitting a leave, and the classroom
       * reading it as a departure. Here it would be worse — a call that gave up with a real
       * reason would replace it with a hopeful "Reconnecting…" that never resolves.
       */
      return state.phase === "failed" || state.phase === "left"
        ? state
        : { ...state, phase: "reconnecting" };

    case "rejoined":
      return state.phase === "reconnecting" ? { ...state, phase: "joined", error: null } : state;

    case "left":
      return { ...state, phase: "left", screenShare: "idle", handRaised: false };

    case "failed":
      return { ...state, phase: "failed", error: action.error, screenShare: "idle" };

    case "permission-denied":
      // Not a failure of the call — the call is fine, the device said no. The person can still
      // hear the lesson, so the shell keeps running and says what happened.
      return { ...state, permissionDenied: true, micOn: false, camOn: false, error: action.error };

    case "mic":
      return { ...state, micOn: action.on };

    case "camera":
      return { ...state, camOn: action.on };

    case "hand":
      return { ...state, handRaised: action.raised };

    case "screen-share":
      return { ...state, screenShare: action.phase };

    case "participants":
      return { ...state, participants: action.participants };

    case "reaction":
      return {
        ...state,
        reactions: [
          { id: action.id, participantId: action.participantId, emoji: action.emoji },
          ...state.reactions,
        ].slice(0, MAX_REMEMBERED_REACTIONS),
      };
  }
}

/**
 * Which controls this person gets, and whether each one can be pressed right now.
 *
 * One function so the two classroom screens cannot end up with two answers, and so the answer is
 * testable. Every `false` here has a reason underneath it rather than a style preference.
 */
export interface CallControls {
  mic: boolean;
  camera: boolean;
  hand: boolean;
  reactions: boolean;
  participants: boolean;
  screenShare: boolean;
  /** Mute somebody else, or remove them. The teacher's, and only while the call is up. */
  moderate: boolean;
  /** Ends the class for everybody. Never a student's. */
  endForEveryone: boolean;
  leave: boolean;
}

export function callControls(options: {
  state: CallState;
  /** From the server's room grant. The client is told; it does not decide. */
  isOwner: boolean;
  /** What the provider says it can do. A button that does nothing is worse than no button. */
  canScreenShare: boolean;
}): CallControls {
  const { state, isOwner, canScreenShare } = options;
  const live = state.phase === "joined";
  // While reconnecting the buttons stay on screen but stop responding: a control that silently
  // does nothing teaches people to press it repeatedly, and the layout jumping as the network
  // wobbles is its own small cruelty on a bus.
  return {
    mic: live && !state.permissionDenied,
    camera: live && !state.permissionDenied,
    hand: live,
    reactions: live,
    participants: state.phase !== "failed",
    screenShare: live && canScreenShare && isOwner,
    moderate: live && isOwner,
    endForEveryone: live && isOwner,
    // Always available. Somebody must always be able to get out, including out of a call that
    // is failing to connect.
    leave: state.phase !== "left",
  };
}

/**
 * One line about what is happening, or nothing at all.
 *
 * Null when the call is simply working — a permanent status bar over a video window on a phone
 * is screen the whiteboard should have had.
 */
export function callStatusLine(state: CallState): string | null {
  switch (state.phase) {
    case "connecting":
      return "Joining the class…";
    case "reconnecting":
      return "Connection lost. Trying to get back in…";
    case "failed":
      return state.error ?? "The video call ran into a problem.";
    case "left":
      return "You have left the call.";
    case "joined":
      if (state.permissionDenied) {
        return state.error ?? "Camera and microphone are blocked. You can still hear the class.";
      }
      return null;
  }
}

/**
 * Whether the media should be running at all.
 *
 * The hidden state is not a smaller window, it is a call the person cannot see — so it keeps
 * its audio and drops every camera. See `incomingVideoFor`. The call itself is never torn down;
 * the classroom relies on the window being hideable and restorable without a rejoin, and a
 * rejoin costs seconds of lesson and a fresh round of permission prompts on some phones.
 */
export function shouldRenderVideo(windowState: CallWindowState): boolean {
  return windowState !== "hidden";
}
