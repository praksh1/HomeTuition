const MESSAGE_BADGE_EVENTS = new Set([
  "conversation_sync",
  "message",
  "class_message",
  "notification_read",
]);

/** Events that can change the combined direct-and-class unread total. */
export function messageBadgeNeedsRefresh(kind?: string): boolean {
  return typeof kind === "string" && MESSAGE_BADGE_EVENTS.has(kind);
}
