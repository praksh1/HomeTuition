import { createMeetingToken, ensureDailyRoom } from "../daily";
import type { JoinOptions, VideoProvider } from "./types";

/**
 * Daily.co, behind the common interface.
 *
 * A thin wrapper on purpose. `lib/daily.ts` is unchanged and still holds everything specific to
 * Daily — room properties, expiry, repair of drifted settings — because the point of this file
 * is to be the only thing that has to be duplicated when a second provider arrives, not to
 * become a second copy of the first one.
 */
export const dailyProvider: VideoProvider = {
  name: "daily",

  /**
   * Everywhere, which is why it is the fallback.
   *
   * The phone builds contain Daily's native SDK and the browser gets Prebuilt. Any client that
   * cannot use the configured provider — or that does not say what it is — is given this one,
   * so there is no combination of settings and app versions that leaves somebody without video.
   */
  platforms: ["web", "ios", "android"],

  capabilities: {
    /**
     * Web only, in practice.
     *
     * Daily Prebuilt can share a screen in a browser. The native path is a WebView and a
     * WebView cannot, which is why this app carries its own chat and its own controls. The
     * classroom already gates the button on platform; this states the fact once so the next
     * provider does not have to rediscover it.
     */
    screenShare: true,
    builtInChat: true,
  },

  configured() {
    return Boolean(process.env.DAILY_API_KEY);
  },

  ensureRoom(sessionId) {
    return ensureDailyRoom(sessionId);
  },

  joinToken(sessionId: string | number, options: JoinOptions) {
    return createMeetingToken(sessionId, options);
  },
};
