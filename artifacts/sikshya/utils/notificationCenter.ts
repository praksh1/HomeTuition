import type { AppNotification } from "./notifications";

export type NotificationFilter = "all" | "unread";
export type NotificationRole = "teacher" | "student" | "admin" | undefined;

export interface NotificationDestination {
  pathname: string;
  params?: Record<string, string>;
}

export interface NotificationPresentation {
  icon: "bell" | "book-open" | "check-circle" | "clock" | "credit-card" | "message-circle" | "radio" | "shield" | "user-plus";
  label: string;
  tone: "action" | "success" | "warning" | "live" | "neutral";
}

const NEPAL_TIME_ZONE = "Asia/Kathmandu";

function value(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const candidate = data?.[key];
  return typeof candidate === "string" || typeof candidate === "number"
    ? String(candidate)
    : undefined;
}

export function notificationDestination(
  data: Record<string, unknown> | undefined,
  role?: NotificationRole,
): NotificationDestination | null {
  const kind = value(data, "type");
  const batchId = value(data, "batchId");
  const sessionId = value(data, "sessionId");
  const programId = value(data, "programId");
  const conversationWith = value(data, "conversationWith");

  if (batchId && kind?.startsWith("class_homework_")) {
    return { pathname: "/class-homework", params: { id: batchId } };
  }
  if (batchId && kind === "class_message") {
    return { pathname: "/class-chat", params: { id: batchId } };
  }
  if (programId && kind === "program_published") {
    return { pathname: "/(student)/program/[id]", params: { id: programId } };
  }
  if (sessionId && (kind === "session_reminder" || kind === "live")) {
    return { pathname: "/classroom/[id]", params: { id: sessionId } };
  }
  if (sessionId) {
    return { pathname: "/session/[id]", params: { id: sessionId } };
  }
  if (conversationWith || kind === "message") {
    return conversationWith
      ? { pathname: "/conversation/[id]", params: { id: conversationWith } }
      : { pathname: "/messages" };
  }
  if (kind === "payment") {
    return role === "teacher"
      ? { pathname: "/(teacher)/subscription", params: { from: "notif" } }
      : role === "student"
        ? { pathname: "/(student)/payments" }
        : null;
  }
  return null;
}

export function notificationPresentation(notification: AppNotification): NotificationPresentation {
  const kind = value(notification.data, "type");
  if (kind === "message" || kind === "class_message" || kind === "session_message") {
    return { icon: "message-circle", label: "Message", tone: "action" };
  }
  if (kind?.startsWith("class_homework_")) {
    return { icon: "book-open", label: "Homework", tone: "action" };
  }
  if (kind === "program_published") {
    return { icon: "book-open", label: "New class", tone: "action" };
  }
  if (kind === "follower") {
    return { icon: "user-plus", label: "Follower", tone: "action" };
  }
  if (notification.type === "live") {
    return { icon: "radio", label: "Live now", tone: "live" };
  }
  if (notification.type === "payment") {
    return { icon: "credit-card", label: "Payment", tone: "success" };
  }
  if (notification.type === "credential") {
    return { icon: "shield", label: "Account review", tone: "warning" };
  }
  if (notification.type === "session_reminder") {
    return { icon: "clock", label: "Reminder", tone: "action" };
  }
  if (kind === "cancelled" || kind === "dropped") {
    return { icon: "check-circle", label: "Class update", tone: "warning" };
  }
  return { icon: "bell", label: "Update", tone: "neutral" };
}

export function filterNotifications(
  notifications: AppNotification[],
  filter: NotificationFilter,
): AppNotification[] {
  return notifications
    .filter((item) => filter === "all" || !item.read)
    .slice()
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdAt);
      const rightTime = Date.parse(right.createdAt);
      const safeLeft = Number.isFinite(leftTime) ? leftTime : Number.NEGATIVE_INFINITY;
      const safeRight = Number.isFinite(rightTime) ? rightTime : Number.NEGATIVE_INFINITY;
      return safeRight - safeLeft;
    });
}

export function markOnlyNotificationRead(
  notifications: AppNotification[],
  id: string,
): AppNotification[] {
  return notifications.map((item) => item.id === id ? { ...item, read: true } : item);
}

function nepalDateParts(value: Date | string | number): { year: number; month: number; day: number } | null {
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NEPAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const year = read("year");
  const month = read("month");
  const day = read("day");
  return year && month && day ? { year, month, day } : null;
}

export function nepalDayKey(value: Date | string | number): string {
  const parts = nepalDateParts(value);
  return parts
    ? `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`
    : "unknown";
}

export function nepalDayAnchor(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  // 06:15 UTC is noon in Nepal. A noon anchor avoids a date changing during conversion.
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 6, 15));
}

export function notificationGroupLabel(
  key: string,
  now: Date | string | number,
  formatDate: (value: Date | string | number) => string,
): string {
  const current = nepalDateParts(now);
  const day = nepalDayAnchor(key);
  if (!current || !day) return "Earlier";
  const currentNumber = Date.UTC(current.year, current.month - 1, current.day) / 86_400_000;
  const itemParts = nepalDateParts(day);
  if (!itemParts) return "Earlier";
  const itemNumber = Date.UTC(itemParts.year, itemParts.month - 1, itemParts.day) / 86_400_000;
  if (itemNumber === currentNumber) return "Today";
  if (itemNumber === currentNumber - 1) return "Yesterday";
  return formatDate(day) || "Earlier";
}

export function notificationClock(value: Date | string | number): string {
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return "Time unavailable";
  return `${new Intl.DateTimeFormat("en-NP", {
    timeZone: NEPAL_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(at)} Nepal time`;
}
