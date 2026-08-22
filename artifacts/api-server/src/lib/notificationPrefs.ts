/**
 * Reading and merging a user's notification switches.
 *
 * Pure and dependency-free on purpose, so it can be tested without a database — the same
 * reason lib/sessionStaleness.ts is split out. The rule it enforces is small but easy to get
 * wrong in a way nobody notices: a user who never opens this screen, or who is on an older
 * build of the app, must end up with the *defaults* for anything they did not set, not with
 * silence.
 */

export interface NotificationPrefs {
  push: Record<PrefKind, boolean>;
  email: Record<PrefKind, boolean>;
}

export type PrefChannel = "push" | "email";
export type PrefKind = "messages" | "followers" | "sessionLive" | "reminders" | "bookings";

export const PREF_CHANNELS: readonly PrefChannel[] = ["push", "email"];
export const PREF_KINDS: readonly PrefKind[] = [
  "messages",
  "followers",
  "sessionLive",
  "reminders",
  "bookings",
];

export const DEFAULT_PREFS: NotificationPrefs = {
  // In-app and device notifications are on: they are the app working as expected, and a user
  // who does not want them can turn them off.
  push: { messages: true, followers: true, sessionLive: true, reminders: true, bookings: true },
  // Email is off by default except for messages and bookings — the two things genuinely
  // missed while the app is closed. A booking is a teacher's income arriving and a student
  // expecting them at a particular hour; a teacher who first hears about it by finding
  // somebody waiting in the room has been failed by us, not by the student.
  email: { messages: true, followers: false, sessionLive: false, reminders: false, bookings: true },
};

/**
 * The stored value, with every missing switch filled in from the defaults.
 *
 * Rows written before this column existed hold null, and a half-written object would
 * otherwise read as "wants nothing" — which looks exactly like notifications being broken
 * again.
 */
export function readPrefs(stored: unknown): NotificationPrefs {
  const value = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const result: NotificationPrefs = {
    push: { ...DEFAULT_PREFS.push },
    email: { ...DEFAULT_PREFS.email },
  };
  for (const channel of PREF_CHANNELS) {
    const section = value[channel];
    if (!section || typeof section !== "object") continue;
    for (const kind of PREF_KINDS) {
      const flag = (section as Record<string, unknown>)[kind];
      if (typeof flag === "boolean") result[channel][kind] = flag;
    }
  }
  return result;
}

/**
 * Applies an update on top of what is stored, ignoring anything we do not recognise.
 *
 * An older client sends fewer switches than the server knows about; it must not clear the
 * ones it has never heard of. Anything that is not a known channel/kind/boolean is dropped
 * rather than written, so the column cannot fill with junk the sender then has to defend
 * against on every notification.
 */
export function mergePrefs(stored: unknown, incoming: unknown): NotificationPrefs {
  const current = readPrefs(stored);
  if (!incoming || typeof incoming !== "object") return current;

  for (const channel of PREF_CHANNELS) {
    const section = (incoming as Record<string, unknown>)[channel];
    if (!section || typeof section !== "object") continue;
    for (const kind of PREF_KINDS) {
      const flag = (section as Record<string, unknown>)[kind];
      if (typeof flag === "boolean") current[channel][kind] = flag;
    }
  }
  return current;
}
