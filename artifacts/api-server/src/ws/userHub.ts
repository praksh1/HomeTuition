import type { WebSocket } from "ws";

/**
 * A live channel to a signed-in person, wherever they are in the app.
 *
 * The classroom socket carries a *room*: presence, chat and the whiteboard for one class. It
 * cannot carry anything that happens outside a lesson, which turned out to be everything the
 * owner meant by "notifications" — a new follower, a message from a student who is not in a
 * class with you, a lesson about to start.
 *
 * Before this there was no server-side notification system at all. The list users saw was
 * seeded sample data in their own device's storage, and `notifyNewMessage` only ever fired on
 * the device that already knew about the message. That is why a teacher never heard about a
 * new follower: nothing on the server had any way to tell them.
 *
 * Deliberately small. It delivers events to people who happen to be connected; it is not a
 * queue and does not guarantee delivery. Anything that must survive being offline is fetched
 * from the API when the app next opens, and this channel exists so that a user who *is*
 * looking at the app finds out now rather than in a minute.
 */

interface UserChannel {
  ws: WebSocket;
  userId: number;
}

const channels = new Map<number, Set<UserChannel>>();

export function addUserChannel(ws: WebSocket, userId: number): () => void {
  let set = channels.get(userId);
  if (!set) {
    set = new Set();
    channels.set(userId, set);
  }
  const channel: UserChannel = { ws, userId };
  set.add(channel);

  return () => {
    const current = channels.get(userId);
    if (!current) return;
    current.delete(channel);
    if (current.size === 0) channels.delete(userId);
  };
}

/**
 * Push an event to one person, on every device they have open.
 *
 * Never throws and never blocks the caller: a notification failing must not fail the thing it
 * was notifying about. Sending a message matters more than announcing it.
 */
export function notifyUser(userId: number, event: Record<string, unknown>): void {
  const set = channels.get(userId);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify({ type: "notification", ...event });
  for (const channel of set) {
    try {
      if (channel.ws.readyState === 1) channel.ws.send(payload);
    } catch {
      // A dead socket is cleaned up by its own close handler.
    }
  }
}

export function notifyUsers(userIds: number[], event: Record<string, unknown>): void {
  for (const userId of new Set(userIds)) notifyUser(userId, event);
}

/** Whether this person is currently looking at the app. Used only for diagnostics. */
export function isUserConnected(userId: number): boolean {
  return (channels.get(userId)?.size ?? 0) > 0;
}
