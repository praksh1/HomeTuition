/**
 * Whether the classroom shows its own slide-over chat.
 *
 * Always true. Daily's unrelated Prebuilt chat is disabled at the room level, and both browser
 * and installed-app classrooms use the same WebSocket conversation. Keeping the platform
 * parameter preserves the existing call-site contract while making the one-chat rule explicit.
 */
export function showsOwnChatTab(_platform: string): boolean {
  return true;
}
