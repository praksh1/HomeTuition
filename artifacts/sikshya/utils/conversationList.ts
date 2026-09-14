import { matches } from "./search.ts";

export interface ConversationSummary {
  otherUserId: number;
  otherUserName: string;
  otherUserRole: string | null;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  lastMessageFromMe: boolean;
}

export type ConversationFilter = "all" | "unread";

export function conversationPreview(conversation: ConversationSummary, draft?: string) {
  const saved = draft?.trim();
  if (saved) return { label: "Draft:", text: saved, draft: true };
  const body = conversation.lastMessage.trim() || "Attachment";
  return {
    label: conversation.lastMessageFromMe ? "You:" : "",
    text: body,
    draft: false,
  };
}

export function filterConversations(
  conversations: ConversationSummary[],
  query: string,
  filter: ConversationFilter,
) {
  return [...conversations]
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
    .filter((conversation) => {
      if (filter === "unread" && conversation.unreadCount < 1) return false;
      if (!query.trim()) return true;
      return matches(`${conversation.otherUserName} ${conversation.lastMessage}`, query);
    });
}

function nepalParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Short, familiar message-list time, always measured in Nepal rather than the viewer's laptop zone. */
export function conversationTimeLabel(
  value: string,
  nowMs: number,
  formatCalendarDate: (value: Date) => string,
) {
  const instant = new Date(value);
  const now = new Date(nowMs);
  if (Number.isNaN(instant.getTime()) || Number.isNaN(now.getTime())) return "";

  const at = nepalParts(instant);
  const today = nepalParts(now);
  const atDay = Date.UTC(at.year, at.month - 1, at.day);
  const todayDay = Date.UTC(today.year, today.month - 1, today.day);
  const daysAgo = Math.round((todayDay - atDay) / 86_400_000);

  if (daysAgo === 0) {
    return new Intl.DateTimeFormat("en-NP", {
      timeZone: "Asia/Kathmandu",
      hour: "numeric",
      minute: "2-digit",
    }).format(instant);
  }
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo > 1 && daysAgo < 7) {
    return new Intl.DateTimeFormat("en-NP", { timeZone: "Asia/Kathmandu", weekday: "short" }).format(instant);
  }

  // The calendar converter reads a local Date. Noon prevents a timezone offset from rolling the
  // Nepal calendar day backwards while still letting the user's BS/AD preference do the writing.
  return formatCalendarDate(new Date(at.year, at.month - 1, at.day, 12));
}
