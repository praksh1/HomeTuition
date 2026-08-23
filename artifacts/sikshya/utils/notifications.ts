import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const NOTIFICATIONS_KEY = "@sikshya_notifications";

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  type: "session_reminder" | "payment" | "credential" | "general" | "live";
  read: boolean;
  createdAt: string;
  data?: Record<string, unknown>;
}

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  // A duplicated expo-modules-core version in the dependency tree makes the
  // `NotificationPermissionsStatus` type returned here structurally mismatch its own
  // declared shape (`status`/`granted` fields are typed as never-accessible), even though
  // the values exist at runtime. Cast through `unknown` to read the fields safely.
  const existing = (await Notifications.getPermissionsAsync()) as unknown as {
    status: string;
    granted: boolean;
  };
  if (existing.granted || existing.status === "granted") return true;
  const requested = (await Notifications.requestPermissionsAsync()) as unknown as {
    status: string;
    granted: boolean;
  };
  return requested.granted || requested.status === "granted";
}

export async function scheduleSessionReminder(session: {
  id: string;
  topic: string;
  teacherName?: string;
  date: string;
}): Promise<void> {
  if (Platform.OS === "web") return;

  const sessionDate = new Date(session.date);
  const reminderDate = new Date(sessionDate.getTime() - 30 * 60 * 1000);
  const now = new Date();

  if (reminderDate > now) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Session Starting Soon",
          body: `"${session.topic}" ${session.teacherName ? `by ${session.teacherName} ` : ""}starts in 30 minutes. Tap to join.`,
          data: { sessionId: session.id, type: "session_reminder" },
          sound: true,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminderDate },
        identifier: `session_reminder_${session.id}`,
      });
    } catch (_e) {
    }
  }

  await addInAppNotification({
    title: "Session Reminder Scheduled",
    body: `You'll receive a reminder 30 minutes before "${session.topic}"`,
    type: "session_reminder",
    data: { sessionId: session.id },
  });
}

/**
 * Cancels a scheduled reminder.
 *
 * Reminders were scheduled when a session was created and never withdrawn, so a class that
 * finished, was cancelled, or was simply started early still fired "starts in 30 minutes"
 * later on. The identifier matches the one used when scheduling.
 */
export async function cancelSessionReminder(sessionId: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await Notifications.cancelScheduledNotificationAsync(`session_reminder_${sessionId}`);
  } catch {
    // Nothing scheduled for this session; nothing to undo.
  }
}

/**
 * Raised when a message arrives from someone else.
 *
 * The app had no signal at all for new messages: no notification and no badge, so a message
 * sat unseen until the user happened to open the tab. `conversationWith` is carried in the
 * payload so tapping the notification opens that thread rather than a generic screen.
 */
export async function notifyNewMessage(msg: {
  senderName: string;
  body: string;
  senderId: string | number;
}): Promise<void> {
  const title = `New message from ${msg.senderName}`;
  const body = msg.body.length > 120 ? `${msg.body.slice(0, 117)}…` : msg.body;

  if (Platform.OS !== "web") {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: { type: "message", conversationWith: String(msg.senderId) },
          sound: true,
        },
        trigger: null,
      });
    } catch {
      // Permission refused or notifications unavailable — the in-app entry below still lands.
    }
  }
  await addInAppNotification({
    title,
    body,
    type: "general",
    data: { conversationWith: String(msg.senderId), type: "message" },
  });
}

/**
 * Raised when somebody writes in a class's own message thread.
 *
 * Kept apart from `notifyNewMessage` because it opens a different place. A direct message
 * opens a conversation with one person; this opens the class, which is where the thread lives
 * and where the Join button is. The commonest thing sent on it is a teacher saying they are
 * running late, and a notification that took the student to a private chat instead of to the
 * class they are waiting for would be actively unhelpful.
 */
export async function notifySessionMessage(msg: {
  senderName: string;
  body: string;
  sessionId: number | string;
  topic?: string;
}): Promise<void> {
  const title = msg.topic ? `${msg.senderName} · ${msg.topic}` : `${msg.senderName} messaged your class`;
  const body = msg.body.length > 120 ? `${msg.body.slice(0, 117)}…` : msg.body;
  const data = { type: "session_message", sessionId: String(msg.sessionId) };

  if (Platform.OS !== "web") {
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title, body, data, sound: true },
        trigger: null,
      });
    } catch {
      // Permission refused or notifications unavailable — the in-app entry below still lands.
    }
  }
  await addInAppNotification({ title, body, type: "general", data });
}

/**
 * Raised when someone starts following a teacher.
 *
 * The owner reported never hearing about a new follower. Following only ever wrote a row —
 * nothing read it on the teacher's behalf, on the server or here.
 */
export async function notifyNewFollower(follower: { name: string; userId: number | string }): Promise<void> {
  const title = "New follower";
  const body = `${follower.name} started following you. They'll be told when you schedule a class.`;

  if (Platform.OS !== "web") {
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title, body, data: { type: "follower", userId: String(follower.userId) }, sound: true },
        trigger: null,
      });
    } catch {
      // Permission refused or notifications unavailable — the in-app entry below still lands.
    }
  }
  await addInAppNotification({
    title,
    body,
    type: "general",
    data: { type: "follower", userId: String(follower.userId) },
  });
}

/**
 * Raised when a teacher schedules a class and tells their students about it.
 *
 * The wording matters: this is an announcement, not a booking. A student who reads "you're in"
 * and turns up unpaid finds a door that refuses them, which is a worse experience than not
 * being told at all.
 */
export async function notifySessionInvite(session: {
  topic: string;
  teacherName?: string;
  sessionId?: number | string;
}): Promise<void> {
  const title = `${session.teacherName ?? "Your teacher"} scheduled a class`;
  const body = `"${session.topic}" — tap to see it and book your place.`;
  const data = { type: "invite", sessionId: session.sessionId != null ? String(session.sessionId) : undefined };

  if (Platform.OS !== "web") {
    try {
      await Notifications.scheduleNotificationAsync({ content: { title, body, data, sound: true }, trigger: null });
    } catch {
      // Permission refused or notifications unavailable — the in-app entry below still lands.
    }
  }
  await addInAppNotification({ title, body, type: "general", data });
}

/**
 * Somebody paid for a class.
 *
 * This is the notification a teacher most wants, and until now the app dropped it on the floor:
 * the server sent `session_booked` down the socket and the handler had no branch for it, so a
 * teacher was told by email if email was configured, and otherwise not at all.
 *
 * It replaces a `notifyPaymentReceived` that nothing ever called and that said "via eSewa"
 * regardless — a payment method the app cannot know, and today never true, because no provider
 * is wired up.
 */
export async function notifySessionBooked(booking: {
  topic: string;
  studentName?: string;
  sessionId?: number | string;
  amount?: number;
}): Promise<void> {
  const who = booking.studentName ?? "A student";
  const title = `${who} booked your class`;
  const body = booking.amount
    ? `NPR ${booking.amount.toLocaleString()} for "${booking.topic}".`
    : `"${booking.topic}" — tap to see who is coming.`;
  const data = { type: "booked", sessionId: booking.sessionId != null ? String(booking.sessionId) : undefined };

  if (Platform.OS !== "web") {
    try {
      await Notifications.scheduleNotificationAsync({ content: { title, body, data, sound: true }, trigger: null });
    } catch {
      // Permission refused or notifications unavailable — the in-app entry below still lands.
    }
  }
  await addInAppNotification({ title, body, type: "payment", data });
}

/** And somebody leaving — the same news from the other direction, and the seat is back on sale. */
export async function notifySessionDropped(booking: {
  topic: string;
  studentName?: string;
  sessionId?: number | string;
}): Promise<void> {
  const who = booking.studentName ?? "A student";
  const title = `${who} dropped your class`;
  const body = `"${booking.topic}" — their place is back on sale.`;
  const data = { type: "dropped", sessionId: booking.sessionId != null ? String(booking.sessionId) : undefined };

  if (Platform.OS !== "web") {
    try {
      await Notifications.scheduleNotificationAsync({ content: { title, body, data, sound: true }, trigger: null });
    } catch {
      // Permission refused or notifications unavailable — the in-app entry below still lands.
    }
  }
  await addInAppNotification({ title, body, type: "general", data });
}

export async function notifyCredentialStatus(status: "approved" | "rejected", reason?: string): Promise<void> {
  const isApproved = status === "approved";
  const title = isApproved ? "Verification Approved!" : "Verification Needs Attention";
  const body = isApproved
    ? "Your credentials have been verified. You can now start teaching on Sikshya!"
    : `Your credentials were not accepted. ${reason ?? "Please re-upload valid documents."}`;

  if (Platform.OS !== "web") {
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title, body, data: { type: "credential", status }, sound: true },
        trigger: null,
      });
    } catch (_e) {
    }
  }
  await addInAppNotification({ title, body, type: "credential", data: { status } });
}

export async function notifySessionLive(session: {
  topic: string;
  teacherName?: string;
  sessionId?: number | string;
}): Promise<void> {
  const title = "Class is live now";
  const body = `"${session.topic}"${session.teacherName ? ` by ${session.teacherName}` : ""} has started. Join now!`;
  // Carried so a tap opens the classroom rather than a generic list. Without it the
  // notification told a student their class had begun and then left them to find it.
  const data = { type: "live", sessionId: session.sessionId != null ? String(session.sessionId) : undefined };
  if (Platform.OS !== "web") {
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title, body, data, sound: true },
        trigger: null,
      });
    } catch (_e) {
    }
  }
  await addInAppNotification({ title, body, type: "live", data });
}

/**
 * A class somebody paid for has been moved.
 *
 * The wording carries the consequence, not just the fact. A student told only that their class
 * moved has been told the least useful half: the 24 hours in which they can take the whole
 * price back starts at that moment, and one who reads this tomorrow has lost the choice by not
 * having been told what it was.
 */
export async function notifySessionRescheduled(session: {
  topic: string;
  teacherName?: string;
  sessionId?: number | string;
  newDate?: string;
}): Promise<void> {
  const when = session.newDate ? new Date(session.newDate) : null;
  const readable = when && !Number.isNaN(when.getTime())
    ? when.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "a new time";
  const title = `"${session.topic}" has been moved`;
  const body =
    `${session.teacherName ?? "Your teacher"} moved it to ${readable}. ` +
    `If that does not suit you, you can drop it for a full refund within 24 hours.`;
  const data = { type: "rescheduled", sessionId: session.sessionId != null ? String(session.sessionId) : undefined };

  if (Platform.OS !== "web") {
    try {
      await Notifications.scheduleNotificationAsync({ content: { title, body, data, sound: true }, trigger: null });
    } catch {
      // Permission refused or notifications unavailable — the in-app entry below still lands.
    }
  }
  await addInAppNotification({ title, body, type: "general", data });
}

export async function addInAppNotification(
  notification: Omit<AppNotification, "id" | "read" | "createdAt">
): Promise<void> {
  const stored = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
  const existing: AppNotification[] = stored ? JSON.parse(stored) : [];
  const newNotif: AppNotification = {
    ...notification,
    id: Date.now().toString() + Math.random().toString(36).slice(2, 7),
    read: false,
    createdAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify([newNotif, ...existing].slice(0, 100)));
}

export async function getNotifications(): Promise<AppNotification[]> {
  const stored = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
  return stored ? JSON.parse(stored) : [];
}

export async function markAllRead(): Promise<void> {
  const stored = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
  const existing: AppNotification[] = stored ? JSON.parse(stored) : [];
  const updated = existing.map((n) => ({ ...n, read: true }));
  await AsyncStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(updated));
}

export async function getUnreadCount(): Promise<number> {
  const notifications = await getNotifications();
  return notifications.filter((n) => !n.read).length;
}
