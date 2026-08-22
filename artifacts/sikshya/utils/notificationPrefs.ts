/**
 * The shape of a user's notification switches, as the API returns them.
 *
 * Mirrors artifacts/api-server/src/lib/notificationPrefs.ts. The two packages do not share
 * code, so this is the one place the app states what it expects; the server fills in anything
 * missing before answering, so these defaults only apply while offline.
 */

export type PrefChannel = "push" | "email";
export type PrefKind = "messages" | "followers" | "sessionLive" | "reminders" | "bookings";

export interface NotificationPrefs {
  push: Record<PrefKind, boolean>;
  email: Record<PrefKind, boolean>;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  push: { messages: true, followers: true, sessionLive: true, reminders: true, bookings: true },
  email: { messages: true, followers: false, sessionLive: false, reminders: false, bookings: true },
};

/**
 * The order the switches appear in, most-wanted first.
 *
 * Lives here rather than in the screen so it sits beside the type it has to cover, and can be
 * tested against it. A kind that exists on the server and is missing from this list is a
 * notification nobody can turn off — which is exactly how "New bookings" arrived: on by
 * default, on both channels, with no switch anywhere.
 */
export const PREF_ORDER: PrefKind[] = ["messages", "bookings", "sessionLive", "followers", "reminders"];

/** Label and explanation for each switch, so both roles read the same wording. */
export const PREF_LABELS: Record<PrefKind, { title: string; help: string }> = {
  messages: { title: "Messages", help: "When someone sends you a message" },
  followers: { title: "New followers", help: "When someone starts following you" },
  sessionLive: { title: "Class starting", help: "When a class you are in goes live" },
  reminders: { title: "Class reminders", help: "30 minutes before a class you booked" },
  // Teachers only in practice — a student never receives one — but the switch is listed for
  // everybody rather than hidden by role, because a screen that shows different switches to
  // different people is a screen nobody can be told how to use.
  bookings: { title: "New bookings", help: "When a student books and pays for your class" },
};
