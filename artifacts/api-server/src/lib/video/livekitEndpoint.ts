export interface LiveKitEndpoint {
  socketUrl: string;
  apiOrigin: string;
}

/** One credential-free root origin for signaling and RoomService, on Cloud or our own host. */
export function parseLiveKitEndpoint(raw: string | undefined): LiveKitEndpoint | null {
  // Check the original value: URL() removes controls and normalizes dot paths before inspection.
  if (typeof raw !== "string" || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  const match = /^(wss|ws):\/\/([^/?#\\\s]+)\/?$/i.exec(raw.trim());
  if (!match || /[@%]/.test(match[2])) return null;
  const authority = /^(\[[0-9a-f:.]+\]|[^:]+)(?::([0-9]{1,5}))?$/i.exec(match[2]);
  if (!authority || (authority[2] !== undefined && Number(authority[2]) === 0)) return null;

  try {
    const socket = new URL(raw.trim());
    if (!socket.hostname || socket.username || socket.password || socket.pathname !== "/" || socket.search || socket.hash) {
      return null;
    }
    // Unencrypted development stays on an explicit loopback host, irrespective of NODE_ENV.
    if (socket.protocol === "ws:" && !["localhost", "127.0.0.1", "[::1]"].includes(authority[1].toLowerCase())) {
      return null;
    }
    const api = new URL(socket.origin);
    api.protocol = socket.protocol === "wss:" ? "https:" : "http:";
    return { socketUrl: socket.origin, apiOrigin: api.origin };
  } catch {
    return null;
  }
}
