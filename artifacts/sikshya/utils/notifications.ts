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

export async function notifyPaymentReceived(amount: number, studentName: string): Promise<void> {
  if (Platform.OS === "web") {
    await addInAppNotification({
      title: "Payment Received",
      body: `NPR ${amount.toLocaleString()} received from ${studentName} via eSewa`,
      type: "payment",
    });
    return;
  }
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Payment Received",
        body: `NPR ${amount.toLocaleString()} received from ${studentName} via eSewa`,
        data: { type: "payment" },
        sound: true,
      },
      trigger: null,
    });
  } catch (_e) {
  }
  await addInAppNotification({
    title: "Payment Received",
    body: `NPR ${amount.toLocaleString()} received from ${studentName} via eSewa`,
    type: "payment",
  });
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
