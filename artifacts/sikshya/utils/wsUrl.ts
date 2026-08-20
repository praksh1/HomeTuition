import { Platform } from "react-native";

/**
 * Where the WebSocket server lives.
 *
 * Mirrors `getApiBase()` in utils/api.ts so a socket always follows the API to whatever host
 * it is actually on. There are now two kinds of socket — the classroom and the per-user
 * notification channel — and they were built from two copies of this logic, which is exactly
 * how one of them ends up pointing at the wrong host after a deploy.
 *
 * http -> ws, https -> wss.
 */
export function wsUrl(params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();

  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) {
    const base = explicit.replace(/\/+$/, "").replace(/^http/, "ws");
    return `${base}/api/ws?${query}`;
  }

  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `wss://${domain}/api/ws?${query}`;

  if (Platform.OS === "web" && typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/api/ws?${query}`;
  }

  return `ws://localhost:80/api/ws?${query}`;
}
