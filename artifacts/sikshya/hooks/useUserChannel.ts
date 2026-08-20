import { useEffect, useRef } from "react";
import { getToken } from "@/utils/api";
import { wsUrl } from "@/utils/wsUrl";
import { onNetworkResume } from "@/utils/networkResume";

/** One event pushed by the server to a signed-in user, wherever they are in the app. */
export interface UserEvent {
  kind: "message" | "follower" | "session_live";
  at?: string;
  fromUserId?: number;
  fromName?: string;
  preview?: string;
  sessionId?: number | string;
  topic?: string;
}

/** Reconnect delays, in ms. Backs off, then keeps trying every 30s. */
const BACKOFF = [1000, 2000, 5000, 10000, 30000];

/**
 * Keeps a socket open to the server for as long as the app is signed in, and calls `onEvent`
 * for anything that arrives.
 *
 * Notifications were not real-time and in fact were not real: the list a user saw was sample
 * data written into their own device's storage on first run. Nothing on the server ever told a
 * teacher they had a new follower, or a student that a class had gone live.
 *
 * The socket is best-effort by design. It reconnects on its own, and while it is down nothing
 * queues up — anything that must survive being offline is fetched from the API when a screen
 * next loads. Its job is to make a user who *is* looking at the app find out now.
 */
export function useUserChannel(enabled: boolean, onEvent: (event: UserEvent) => void): void {
  // Held in a ref so a changing callback never tears the socket down and reconnects.
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!enabled) return;

    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let closed = false;

    const connect = async () => {
      if (closed) return;
      const token = await getToken();
      if (!token || closed) return;

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl({ token }));
      } catch {
        schedule();
        return;
      }
      socket = ws;

      ws.onopen = () => {
        attempt = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data));
          if (data?.type !== "notification") return;
          handler.current(data as UserEvent);
        } catch {
          // A frame we cannot read is not worth taking the channel down for.
        }
      };

      // A 401 arrives as a failed handshake, not a message: retrying forever with a bad token
      // is harmless here because the delay caps at 30s and the app re-reads the token each try.
      ws.onerror = () => {};
      ws.onclose = () => {
        if (socket === ws) socket = null;
        schedule();
      };
    };

    const schedule = () => {
      if (closed || retry) return;
      const delay = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
      attempt += 1;
      retry = setTimeout(() => {
        retry = null;
        void connect();
      }, delay);
    };

    void connect();

    // Same reasoning as the classroom socket: a device that has just come back deserves to be
    // reconnected now, not whenever the timer set while it was offline happens to fire.
    const stopWatching = onNetworkResume(() => {
      if (closed) return;
      if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
      if (retry) {
        clearTimeout(retry);
        retry = null;
      }
      attempt = 0;
      void connect();
    });

    return () => {
      stopWatching();
      closed = true;
      if (retry) clearTimeout(retry);
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        try {
          socket.close();
        } catch {
          // Already gone.
        }
      }
    };
  }, [enabled]);
}
