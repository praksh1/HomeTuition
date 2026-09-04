import type { ComponentType } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { CallParticipant } from "@/utils/streamCallState";
import type { IncomingVideoPreference } from "@/utils/streamRoom";

/**
 * The line between Sikshya and Stream.
 *
 * Everything above this file — the call shell, its controls, the two classroom screens — is
 * written against these types and has never heard of Stream. Everything below it is one adapter
 * per platform. That is the same arrangement the server has: `lib/video/types.ts` describes what
 * a provider owes, and only the file next door knows a brand name.
 *
 * It matters more here than it looks. The reason to try Stream at all is that Daily is unlikely
 * to survive the monthly tier's pricing, which means a *third* provider is a live possibility
 * and a second migration should not be a second rewrite of the classroom.
 *
 * ### Why the SDK is loaded rather than imported
 *
 * `@stream-io/video-react-native-sdk` is **not installed**, and installing it today would break
 * the app for every real class: it requires `@stream-io/react-native-webrtc`, Daily requires
 * `@daily-co/react-native-webrtc`, and the two are forks of the same library that ship 33
 * identically-named Java classes, 45 identically-named iOS sources and the same
 * `"WebRTCModule"` native module name. Two of those cannot be in one Android or iOS binary.
 * Measured, not assumed — the file names were compared. STREAM.md records it and what the ways
 * out are.
 *
 * So the adapter is a **boundary that reports its own absence**. With no SDK installed the
 * classroom says exactly that, in words, instead of showing a black rectangle or a row of
 * buttons that do nothing.
 */

/** One participant's picture. The shell asks for it by id and never touches a track. */
export interface StreamVideoViewProps {
  participantId: string;
  kind: "camera" | "screen";
  mirror?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** What the adapter tells the shell as the call goes along. */
export interface StreamBridgeEvents {
  onJoined(): void;
  onReconnecting(): void;
  onRejoined(): void;
  onLeft(): void;
  /** A reason a person can read. Not an error code. */
  onError(message: string): void;
  /** The device refused the camera or microphone; the call itself is fine. */
  onPermissionDenied(message: string): void;
  onParticipants(participants: CallParticipant[]): void;
  onReaction(reaction: { id: string; participantId: string; emoji: string }): void;
  onScreenShare(phase: "idle" | "starting" | "sharing"): void;
}

export interface StreamMediaDevice {
  id: string;
  label: string;
}

/** A call that is running. Every method is something a control in the shell can ask for. */
export interface StreamBridgeSession {
  setMicrophone(on: boolean): Promise<void>;
  setCamera(on: boolean): Promise<void>;
  raiseHand(raised: boolean): Promise<void>;
  sendReaction(emoji: string): Promise<void>;

  startScreenShare(): Promise<void>;
  stopScreenShare(): Promise<void>;

  /**
   * Moderation. The teacher's, and refused twice.
   *
   * The shell only draws these when the server's room grant said `isOwner`, and Stream refuses
   * them unless the token's role carries `mute-users` / `kick-user` on the call type. Neither
   * check trusts the other.
   */
  muteParticipant(participantId: string): Promise<void>;
  removeParticipant(participantId: string): Promise<void>;
  endForEveryone(): Promise<void>;

  leave(): Promise<void>;

  /**
   * What to receive, and whether to receive video at all.
   *
   * Called whenever the window changes size, including to hidden. This is the money lever and
   * the battery lever at once — see `incomingVideoFor` — and it is a method rather than a prop
   * because changing it must never remount the call.
   */
  setIncomingVideo(preference: IncomingVideoPreference): void;

  /**
   * Device choice, where the platform has it.
   *
   * Optional on purpose. A browser can enumerate microphones and cameras; a phone mostly offers
   * front and back and routes audio itself. The shell draws the control only when the adapter
   * provides these, rather than showing a picker with one entry in it.
   */
  listDevices?(kind: "camera" | "microphone"): Promise<StreamMediaDevice[]>;
  selectDevice?(kind: "camera" | "microphone", deviceId: string): Promise<void>;
  flipCamera?(): Promise<void>;

  /** Paints one participant's camera or shared screen. Supplied by the adapter. */
  readonly VideoView: ComponentType<StreamVideoViewProps>;
}

export interface StreamConnectOptions {
  apiKey: string;
  callType: string;
  callId: string;
  token: string;
  /** The identity the server minted the token for. Sending back a different one fails to auth. */
  userId: string;
  userName: string;
  /** Who the server says the teacher is, so participants can be labelled without asking them. */
  teacherName?: string;
  events: StreamBridgeEvents;
}

export type StreamSdk =
  | { ok: true; connect(options: StreamConnectOptions): Promise<StreamBridgeSession> }
  /** `reason` is shown to the person. It must name what is missing and what to do about it. */
  | { ok: false; reason: string };
