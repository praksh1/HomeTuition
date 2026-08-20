import type { WebSocket, WebSocketServer } from "ws";
import { logger } from "../lib/logger";

/**
 * Detects connections that have died without saying so.
 *
 * A phone that walks out of coverage, or a network that drops a connection at a router, leaves
 * a socket that is open on paper and carries nothing. Neither side is told. The server keeps a
 * ghost in the room — so the class shows a student who is not there — and the student's app
 * believes it is still connected, so it never reconnects. It just sits there.
 *
 * That is the "sometimes a student cannot get back in" half of the reported problem, and no
 * amount of retrying on the client fixes it, because the client does not know anything is
 * wrong. Only a heartbeat can tell.
 *
 * The protocol is the WebSocket ping/pong frame, which browsers answer automatically — no
 * client code required, and no message that an old build would not understand.
 */

/**
 * How often each connection is pinged.
 *
 * 25 seconds because proxies and mobile networks commonly drop an idle connection at 30 or 60,
 * and a ping inside that window both keeps a healthy connection alive and finds a dead one
 * quickly. Overridable only so the tests do not have to wait a minute to prove it works.
 */
export const HEARTBEAT_MS = Number(process.env.WS_HEARTBEAT_MS ?? 25_000);

const alive = new WeakMap<WebSocket, boolean>();

/** Marks a socket live and starts answering for it. Call once per connection. */
export function watchHeartbeat(ws: WebSocket): void {
  alive.set(ws, true);
  ws.on("pong", () => alive.set(ws, true));
}

/**
 * Pings every open connection, and closes any that did not answer the last round.
 *
 * `terminate()` rather than `close()`: a socket that has stopped answering will not complete a
 * closing handshake either, and waiting for one it will never send is how these accumulate.
 * Terminating fires the socket's own close handler, so rooms and channels clean themselves up
 * through the paths they already use.
 */
export function startHeartbeat(wss: WebSocketServer): () => void {
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        logger.info("ws terminating a connection that stopped answering");
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      try {
        ws.ping();
      } catch {
        // Already gone; the next round terminates it.
      }
    }
  }, HEARTBEAT_MS);

  // Node keeps the process alive for a pending timer, which would hold a shutdown open for up
  // to one interval for no reason.
  timer.unref?.();

  return () => clearInterval(timer);
}
