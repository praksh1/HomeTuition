/**
 * The shape of a user's notification switches, as the API returns them.
 *
 * Mirrors artifacts/api-server/src/lib/notificationPrefs.ts. The two packages do not share
 * code, so this is the one place the app states what it expects; the server fills in anything
 * missing before answering, so these defaults only apply while offline.
 */

export type PrefChannel = "push" | "email";
export type PrefKind = "messages" | "followers" | "sessionLive" | "reminders";

export interface NotificationPrefs {
  push: Record<PrefKind, boolean>;
  email: Record<PrefKind, boolean>;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  push: { messages: true, followers: true, sessionLive: true, reminders: true },
  email: { messages: true, followers: false, sessionLive: false, reminders: false },
};

/** Label and explanation for each switch, so both roles read the same wording. */
export const PREF_LABELS: Record<PrefKind, { title: string; help: string }> = {
  messages: { title: "Messages", help: "When someone sends you a message" },
  followers: { title: "New followers", help: "When someone starts following you" },
  sessionLive: { title: "Class starting", help: "When a class you are in goes live" },
  reminders: { title: "Class reminders", help: "30 minutes before a class you booked" },
};
