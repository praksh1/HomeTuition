/**
 * Reading a list of conversations.
 *
 * Pure and dependency-free so it can be tested without a screen — small, but the thing it
 * decides is what a number on a folder tab means, and that was wrong in a way nobody could see
 * was wrong: every folder showed how many conversations it held, so a tidy inbox read
 * "Inbox (1) · Sent (1) · Drafts (1)". Three numbers, none of them anything to act on, all of
 * them looking exactly like the badge that means somebody is waiting for a reply.
 */

export interface CountableConversation {
  /** How many messages in this conversation the reader has not opened. */
  unreadCount: number;
}

/**
 * How many messages are actually waiting to be read.
 *
 * Messages, not conversations: two unread messages from one person is two, because that is
 * what the number on the tab bar badge means and the two should not disagree. Anything
 * missing or nonsensical counts as nothing rather than as NaN, which would render as a badge
 * saying "NaN".
 */
export function unreadTotal(conversations: CountableConversation[]): number {
  return conversations.reduce((total, conversation) => {
    const unread = Number(conversation?.unreadCount);
    return total + (Number.isFinite(unread) && unread > 0 ? unread : 0);
  }, 0);
}
