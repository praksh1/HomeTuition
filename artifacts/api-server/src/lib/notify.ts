import { eq, inArray } from "drizzle-orm";
import { db, usersTable, userNotificationPrefsTable } from "@workspace/db";
import { logger } from "./logger";
import { isEmailConfigured, sendEmail } from "./mailer";
import { readPrefs, type PrefKind } from "./notificationPrefs";
import { emailFor, type NotificationEvent, type NotificationKind } from "./notificationEmails";

// Re-exported so the twenty routes that already import these from here do not all have to move.
export type { NotificationEvent, NotificationKind };

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

/** Notify one person. Returns immediately; the work happens after the response is sent. */
export function notify(userId: number, event: NotificationEvent): void {
  notifyMany([userId], event);
}

/**
 * Push to the app only, sending no email, for a notice whose email the caller owns.
 *
 * Operator decisions need this for two reasons.
 *
 * **They were sending two emails.** The credential decision route called `notify()` *and*
 * `sendEmail()`. `notify()` maps `kind: "message"` to a real email — "New message from Sikshya
 * Support", with a link to `/conversation/undefined` because these support notices carry no
 * `fromUserId` — so a teacher whose document was reviewed received that plus the purpose-written
 * one. Routing the in-app half here leaves exactly one email per decision.
 *
 * **The operator has to be told whether it arrived.** `notify()` is fire-and-forget by design and
 * cannot report delivery, so the route awaits its own `sendEmail()` and reads the result.
 *
 * Deliberately not preference-gated. The email preferences describe messages, followers and
 * classes — things a person may reasonably opt out of. "Your teacher account was rejected" is
 * transactional: nobody opts out of being told the outcome of their own application, and letting
 * a stale preference row silence it would put the operator screen back to guessing.
 */
export function notifyInApp(userId: number, event: NotificationEvent): void {
  notifyUser(userId, { ...event });
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
