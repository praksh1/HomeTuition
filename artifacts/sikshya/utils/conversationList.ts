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

export interface ClassConversationSummary {
  batchId: number;
  title: string;
  lastMessage: string;
  lastMessageAt: string | null;
  lastSenderName: string | null;
  unreadCount: number;
  lastMessageFromMe: boolean;
}

export type InboxThread =
  | ({ kind: "direct" } & ConversationSummary)
  | ({ kind: "class" } & ClassConversationSummary);

export type ConversationFilter = "all" | "classes" | "direct" | "unread";

export function inboxThreads(
  direct: ConversationSummary[],
  classes: ClassConversationSummary[],
): InboxThread[] {
  return [
    ...direct.map((conversation) => ({ kind: "direct" as const, ...conversation })),
    ...classes.map((conversation) => ({ kind: "class" as const, ...conversation })),
  ];
}

export function inboxThreadKey(thread: InboxThread): string {
  return thread.kind === "direct" ? `person-${thread.otherUserId}` : `class-${thread.batchId}`;
}

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

export function inboxPreview(thread: InboxThread, draft?: string) {
  if (thread.kind === "direct") return conversationPreview(thread, draft);
  const body = thread.lastMessage.trim();
  if (!body) return { label: "", text: "Start the class conversation", draft: false };
  return {
    label: thread.lastMessageFromMe ? "You:" : thread.lastSenderName ? `${thread.lastSenderName}:` : "",
    text: body || "Shared a file",
    draft: false,
  };
}

export function inboxThreadTitle(thread: InboxThread): string {
  return thread.kind === "direct" ? thread.otherUserName : thread.title;
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

export function filterInboxThreads(
  threads: InboxThread[],
  query: string,
  filter: ConversationFilter,
) {
  return [...threads]
    .sort((a, b) => {
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bTime - aTime;
    })
    .filter((thread) => {
      if (filter === "unread" && thread.unreadCount < 1) return false;
      if (filter === "classes" && thread.kind !== "class") return false;
      if (filter === "direct" && thread.kind !== "direct") return false;
      if (!query.trim()) return true;
      if (thread.kind === "direct") {
        return matches(`${thread.otherUserName} ${thread.lastMessage}`, query);
      }
      return matches(`${thread.title} ${thread.lastSenderName ?? ""} ${thread.lastMessage}`, query);
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
