import { eq, inArray } from "drizzle-orm";
import { db, usersTable, userNotificationPrefsTable } from "@workspace/db";
import { logger } from "./logger";
import { isEmailConfigured, sendEmail } from "./mailer";
import { readPrefs, type PrefKind } from "./notificationPrefs";
import { notifyUser } from "../ws/userHub";

/**
 * The one place a notification is sent from.
 *
 * A notification has two halves that are easy to let drift apart: the live push down the
 * user's socket, and the email for when they are not looking. Both have to respect the same
 * preferences, so both live here and the routes call one function.
 *
 * Fire-and-forget on purpose. Nothing here is awaited by a request handler and nothing here
 * throws: sending a message matters more than announcing it, and a mail provider having a bad
 * day must not turn into a failed booking.
 */

export type NotificationKind =
  | "message"
  | "follower"
  | "session_live"
  | "session_invite"
  | "session_booked"
  | "session_dropped"
  | "session_cancelled"
  | "session_rescheduled";

/** Which preference switch governs each kind. */
const PREF_KEY: Record<NotificationKind, PrefKind> = {
  message: "messages",
  follower: "followers",
  session_live: "sessionLive",
  // An invitation is a class about to exist, so it follows the same switch as a class going
  // live: someone who does not want to hear about classes does not want to hear about these.
  session_invite: "sessionLive",
  // Its own switch rather than sharing one. A teacher turning off "class starting" reminders
  // has not asked to stop being told that somebody paid them.
  session_booked: "bookings",
  // A student leaving is the same news as one arriving, from the same switch: it is money and
  // a seat, and a teacher who wants to hear about one wants to hear about the other.
  session_dropped: "bookings",
  // A class somebody paid for is not happening. Follows the "class" switch rather than the
  // booking one, because the person who needs this most is the student, not the teacher.
  session_cancelled: "sessionLive",
  // A class they paid for has moved and they have a day to decide about a refund. Follows the
  // same switch as a class going live because both are "something happened to a class of
  // yours", and this one is the more consequential of the two to miss.
  session_rescheduled: "sessionLive",
};

export interface NotificationEvent {
  kind: NotificationKind;
  at: string;
  fromUserId?: number;
  fromName?: string;
  preview?: string;
  sessionId?: number;
  topic?: string;
  /** What was paid, for the notifications about money arriving or going back. */
  amount?: number;
  /** When a class has been moved: where it is now, as an ISO string. */
  newDate?: string;
  /** When a class has been moved: where it was before. */
  previousDate?: string;
}

/** Where a person is sent when they act on the email. Falls back to the app's own domain. */
function appUrl(path: string): string {
  const base = (process.env.APP_URL ?? process.env.EXPO_PUBLIC_DOMAIN ?? "").replace(/\/+$/, "");
  if (!base) return "";
  const origin = base.startsWith("http") ? base : `https://${base}`;
  return `${origin}${path}`;
}

function emailFor(event: NotificationEvent, recipientName: string): { subject: string; text: string } | null {
  const hello = `Hi ${recipientName.split(" ")[0] || "there"},`;
  const signoff = "\n\nYou can turn these emails off in the app under Profile → Notifications.\n— Sikshya";

  switch (event.kind) {
    case "message": {
      const link = appUrl(`/conversation/${event.fromUserId ?? ""}`);
      return {
        subject: `New message from ${event.fromName ?? "someone"}`,
        text:
          `${hello}\n\n${event.fromName ?? "Someone"} sent you a message:\n\n` +
          `  "${event.preview ?? ""}"\n` +
          (link ? `\nRead and reply: ${link}\n` : "") +
          signoff,
      };
    }
    case "follower":
      return {
        subject: `${event.fromName ?? "A student"} is now following you`,
        text:
          `${hello}\n\n${event.fromName ?? "A student"} has started following you on Sikshya. ` +
          `They will be told when you schedule a class.` +
          signoff,
      };
    case "session_invite": {
      const link = appUrl(`/session/${event.sessionId ?? ""}`);
      return {
        subject: `${event.fromName ?? "Your teacher"} has scheduled "${event.topic ?? "a class"}"`,
        text:
          `${hello}\n\n${event.fromName ?? "Your teacher"} has scheduled a new class: ` +
          `"${event.topic ?? ""}".\n` +
          (link ? `\nSee it and book your place: ${link}\n` : "") +
          `\nYour place is not held until you book and pay for it.` +
          signoff,
      };
    }
    case "session_booked": {
      const link = appUrl(`/session/${event.sessionId ?? ""}`);
      return {
        subject: `${event.fromName ?? "A student"} booked "${event.topic ?? "your class"}"`,
        text:
          `${hello}\n\n${event.fromName ?? "A student"} has booked and paid for your class ` +
          `"${event.topic ?? ""}".\n` +
          (link ? `\nSee who is coming: ${link}\n` : "") +
          signoff,
      };
    }
    case "session_rescheduled": {
      const link = appUrl(`/session/${event.sessionId ?? ""}`);
      const when = event.newDate ? new Date(event.newDate).toUTCString() : "a new time";
      return {
        subject: `"${event.topic ?? "Your class"}" has been moved`,
        text:
          `${hello}\n\n${event.fromName ?? "Your teacher"} has moved your class ` +
          `"${event.topic ?? ""}" to ${when}.\n\n` +
          `You did not ask for this change, so if the new time does not suit you, you can ` +
          `drop the class for a full refund. That option is open for 24 hours.\n` +
          (link ? `\nSee the class: ${link}\n` : "") +
          signoff,
      };
    }
    case "session_dropped": {
      const link = appUrl(`/session/${event.sessionId ?? ""}`);
      return {
        subject: `${event.fromName ?? "A student"} dropped "${event.topic ?? "your class"}"`,
        text:
          `${hello}\n\n${event.fromName ?? "A student"} has dropped your class ` +
          `"${event.topic ?? ""}". Their place is back on sale.\n` +
          (link ? `\nSee who is coming: ${link}\n` : "") +
          signoff,
      };
    }
    case "session_cancelled": {
      return {
        subject: `"${event.topic ?? "Your class"}" has been cancelled`,
        text:
          `${hello}\n\n${event.fromName ?? "Your teacher"} has cancelled ` +
          `"${event.topic ?? "your class"}".\n\n` +
          (event.amount
            ? `A full refund of NPR ${event.amount} has been requested for you. Our team will ` +
              `process it within 5-7 business days.\n`
            : "") +
          signoff,
      };
    }
    case "session_live": {
      const link = appUrl(`/classroom/${event.sessionId ?? ""}`);
      return {
        subject: `"${event.topic ?? "Your class"}" has started`,
        text:
          `${hello}\n\nYour class "${event.topic ?? ""}" is live now.\n` +
          (link ? `\nJoin: ${link}\n` : "") +
          signoff,
      };
    }
    default:
      return null;
  }
}

/** Notify one person. Returns immediately; the work happens after the response is sent. */
export function notify(userId: number, event: NotificationEvent): void {
  notifyMany([userId], event);
}

/** Notify several people about the same thing — students in one class, for instance. */
export function notifyMany(userIds: number[], event: NotificationEvent): void {
  const ids = [...new Set(userIds)].filter((id) => Number.isFinite(id));
  if (ids.length === 0) return;

  void (async () => {
    try {
      // Left join: a user who has never opened the settings screen has no preferences row,
      // and that is not an error — it means "the defaults", which readPrefs() answers.
      const recipients = await db
        .select({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
          notificationPrefs: userNotificationPrefsTable.prefs,
        })
        .from(usersTable)
        .leftJoin(userNotificationPrefsTable, eq(userNotificationPrefsTable.userId, usersTable.id))
        .where(ids.length === 1 ? eq(usersTable.id, ids[0]) : inArray(usersTable.id, ids));

      const key = PREF_KEY[event.kind];
      const emailOn = isEmailConfigured();

      for (const recipient of recipients) {
        const prefs = readPrefs(recipient.notificationPrefs);

        if (prefs.push[key]) notifyUser(recipient.id, { ...event });

        if (emailOn && prefs.email[key]) {
          const mail = emailFor(event, recipient.name);
          if (mail) void sendEmail({ to: recipient.email, ...mail });
        }
      }
    } catch (err) {
      logger.warn({ err, kind: event.kind }, "notification dispatch failed");
    }
  })();
}
