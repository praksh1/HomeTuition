export type ScreenShareState = "idle" | "starting" | "sharing";

export interface VideoParticipantState {
  local?: boolean;
  user_name?: string;
  tracks?: {
    screenVideo?: { state?: string; persistentTrack?: unknown };
  };
}

export function watchedParticipantLeft(
  watchedName: string | undefined,
  leftName: string | undefined,
): boolean {
  return Boolean(watchedName && leftName === watchedName);
}

export function firstRemoteParticipant<T extends VideoParticipantState>(
  participants: T[],
): T | undefined {
  return participants.find((participant) => !participant.local);
}

export function sharingPresenter<T extends VideoParticipantState>(
  participants: T[],
): T | undefined {
  return participants.find((participant) =>
    participant.tracks?.screenVideo?.state === "playable" ||
    Boolean(participant.tracks?.screenVideo?.persistentTrack),
  );
}

/** The label describes the action a tap will take, not merely the current icon. */
export function microphoneActionLabel(micOn: boolean): string {
  return micOn ? "Mute microphone" : "Unmute microphone";
}

export function cameraActionLabel(camOn: boolean): string {
  return camOn ? "Turn camera off" : "Turn camera on";
}

export function screenShareActionLabel(state: ScreenShareState): string {
  if (state === "sharing") return "Stop sharing screen";
  if (state === "starting") return "Starting screen share";
  return "Share screen";
}

export function chatActionLabel(open: boolean, unseen: number): string {
  if (open) return "Close class chat";
  return unseen > 0 ? `Open class chat, ${unseen} unread` : "Open class chat";
}

/**
 * Messages are counted only while the panel is closed. The caller owns the last-seen marker;
 * this helper keeps the edge cases (initial empty chat and a shrinking/reset thread) explicit.
 */
export function unseenChatCount(total: number, lastSeen: number, open: boolean): number {
  return open ? 0 : Math.max(0, total - lastSeen);
}
