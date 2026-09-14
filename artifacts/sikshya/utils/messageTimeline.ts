export interface TimelineMessage {
  id: number;
  senderId: number;
  read: boolean;
  createdAt: string;
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

export function messageDayKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "invalid";
  const parts = nepalParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function messageTimeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-NP", {
    timeZone: "Asia/Kathmandu",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function messageDayLabel(
  value: string,
  nowMs: number,
  formatCalendarDate: (value: Date) => string,
) {
  const date = new Date(value);
  const now = new Date(nowMs);
  if (Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) return "";
  const at = nepalParts(date);
  const today = nepalParts(now);
  const atDay = Date.UTC(at.year, at.month - 1, at.day);
  const todayDay = Date.UTC(today.year, today.month - 1, today.day);
  const daysAgo = Math.round((todayDay - atDay) / 86_400_000);
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return formatCalendarDate(new Date(at.year, at.month - 1, at.day, 12));
}

export function shouldShowDay(messages: TimelineMessage[], index: number) {
  if (index === 0) return true;
  return messageDayKey(messages[index - 1]!.createdAt) !== messageDayKey(messages[index]!.createdAt);
}

export function latestOwnMessageId(messages: TimelineMessage[], userId: number | undefined) {
  if (userId === undefined) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.senderId === userId) return messages[index]!.id;
  }
  return null;
}
