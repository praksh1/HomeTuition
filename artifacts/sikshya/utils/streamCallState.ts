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
  /**
   * Who the person is. Stable for as long as they have an account.
   *
   * **This is the one to hand to anything that acts on a person** — muting them, removing them,
   * attributing a reaction. The first version of this type had a single `id` holding the session
   * id, which meant the moderation calls were given the wrong string entirely: Stream's
   * `muteUser` and `kickUser` both want a user id, and would have silently matched nobody. A
   * teacher would have pressed Mute, seen no error, and watched the student keep talking.
   */
  userId: string;
  /**
   * Which *connection* this is. New every time the same person rejoins.
   *
   * **This is the one to hand to anything that draws a picture** — a video track belongs to a
   * connection, not to a person, and somebody signed in on a laptop and a phone at once has two
   * of these and one `userId`.
   */
  sessionId: string;
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
  /**
   * Which device the phone or browser refused, kept apart.
   *
   * They were one flag, and that was a real fault rather than a tidiness one: a student who
   * allows the microphone and refuses the camera — the sensible thing to do on a shared family
   * phone — had their **working microphone switched off** and was told both were blocked. They
   * would have sat through a lesson unable to answer a question, with the app insisting that was
   * their own choice.
   */
  cameraDenied: boolean;
  micDenied: boolean;
  participants: CallParticipant[];
  /**
   * Reactions currently on screen. Newest first, one per person, and bounded.
   *
   * One per person is what makes it deterministic without a timer: a new reaction from somebody
   * replaces their old one, and the oldest falls off the end when the list is full. Nothing
   * fades, nothing is scheduled, and a class of forty-five cannot push more than
   * `MAX_VISIBLE_REACTIONS` of these onto a cheap Android at once.
   */
  reactions: VisibleReaction[];
}

export interface VisibleReaction {
  userId: string;
  name: string;
  emoji: string;
  /** When it arrived, in milliseconds. Passed in rather than read, so expiry can be tested. */
  at: number;
}

/** Few enough to fit one row at phone width without covering the video underneath. */
export const MAX_VISIBLE_REACTIONS = 3;

/**
 * How long a reaction stays on screen.
 *
 * A reaction is a moment, not a status. The first version of this kept one until somebody else
 * sent one, which meant a class where three people react and then nobody does again leaves three
 * chips sitting over the video for the rest of the lesson — a thumbs-up from twenty minutes ago
 * reading as though it were about whatever the teacher just said.
 *
 * Five seconds, and no animation to go with it: a fade is a frame budget the phones this product
 * is built for do not have spare. It simply stops being drawn.
 */
export const REACTION_VISIBLE_MS = 5_000;

/**
 * How long until the next reaction needs removing, or null if none does.
 *
 * The arithmetic lives here, on its own, so that the part of expiry that can be tested with a
 * pinned clock is tested with one — the component is then a single `setTimeout` around this
 * number, and there is no interval ticking behind a call nobody is reacting in.
 */
export function nextReactionExpiryMs(reactions: VisibleReaction[], now: number): number | null {
  if (reactions.length === 0) return null;
  const earliest = Math.min(...reactions.map((r) => r.at));
  // Never negative: an already-expired reaction wants removing now, not in the past.
  return Math.max(0, earliest + REACTION_VISIBLE_MS - now);
}

/** Everything still worth showing at `now`. */
export function liveReactions(reactions: VisibleReaction[], now: number): VisibleReaction[] {
  return reactions.filter((r) => r.at + REACTION_VISIBLE_MS > now);
}

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
    cameraDenied: false,
    micDenied: false,
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
  | { type: "permission-denied"; device: "camera" | "microphone"; error: string }
  | { type: "permission-granted"; device: "camera" | "microphone" }
  | { type: "mic"; on: boolean }
  | { type: "camera"; on: boolean }
  | { type: "hand"; raised: boolean }
  | { type: "screen-share"; phase: ScreenSharePhase }
  | { type: "participants"; participants: CallParticipant[] }
  | { type: "reaction"; userId: string; name: string; emoji: string; at: number }
  /** A timer fired, or another reaction arrived. Either way, drop whatever has run out. */
  | { type: "reactions-expired"; now: number };

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
      /**
       * Not a failure of the call — the call is fine, the device said no.
       *
       * Only the refused device is switched off. Somebody who allowed the microphone and refused
       * the camera can still answer a question, which on a shared family phone is the common
       * case rather than the odd one.
       */
      return action.device === "camera"
        ? { ...state, cameraDenied: true, camOn: false, error: action.error }
        : { ...state, micDenied: true, micOn: false, error: action.error };

    case "permission-granted":
      // Somebody changed their mind in the browser's own settings, which is a thing people do
      // once they understand why they were asked. The control comes back rather than staying
      // greyed out until they reload.
      return action.device === "camera"
        ? { ...state, cameraDenied: false }
        : { ...state, micDenied: false };

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
          { userId: action.userId, name: action.name, emoji: action.emoji, at: action.at },
          // Somebody's newer reaction replaces their older one rather than stacking beside it,
          // so one person tapping five times cannot fill the row. Anything already out of time
          // goes at the same moment, so a phone whose timers were throttled in the background
          // still cannot show a reaction from ten minutes ago.
          ...liveReactions(
            state.reactions.filter((r) => r.userId !== action.userId),
            action.at,
          ),
        ].slice(0, MAX_VISIBLE_REACTIONS),
      };

    case "reactions-expired": {
      const remaining = liveReactions(state.reactions, action.now);
      // Same array when nothing expired, so a timer that fires a millisecond early cannot cause
      // a re-render on its own.
      return remaining.length === state.reactions.length ? state : { ...state, reactions: remaining };
    }
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
    // Each control follows its own device's permission. A refused camera does not take the
    // microphone with it.
    mic: live && !state.micDenied,
    camera: live && !state.cameraDenied,
    hand: live,
    reactions: live,
    participants: state.phase !== "failed",
    screenShare: live && canScreenShare && isOwner,
    moderate: live && isOwner,
    /**
     * There is no "end for everyone" here, and that is deliberate.
     *
     * The shell had one, and it was wrong: it called the provider's `endCall()` and nothing
     * else, so the class's video stopped while Sikshya went on believing the lesson was running
     * — no `status: completed`, no cancelled reminder, no attendance closed, and none of the
     * confirmation the teacher's own End Session button asks for. Two buttons that look alike
     * and do different amounts of work is exactly the trap this project already removed from
     * Daily Prebuilt.
     *
     * **The teacher's classroom HUD owns ending a class**, and always did. It clears the room,
     * which unmounts this component, which leaves the call — the provider's media stops as part
     * of the application's lifecycle rather than starting a competing one.
     */
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
      // Named per device, because "camera and microphone are blocked" to somebody who
      // deliberately allowed the microphone reads as the app not having listened.
      if (state.micDenied && state.cameraDenied) {
        return "Camera and microphone are blocked. You can still hear the class.";
      }
      if (state.micDenied) return "Your microphone is blocked. You can hear, but not speak.";
      if (state.cameraDenied) return "Your camera is blocked. Everything else works.";
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
