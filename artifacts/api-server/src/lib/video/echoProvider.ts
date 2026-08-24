import type { JoinOptions, VideoProvider } from "./types";

/**
 * A provider that carries no video at all.
 *
 * It exists so the seam can be proved rather than asserted: with `VIDEO_PROVIDER=echo` the real
 * server serves a real room grant naming a provider that has never heard of Daily, through the
 * real route, and every classroom rule around it — who may have a room, when the door is open,
 * who gets moderator rights — behaves exactly as before.
 *
 * That is the claim the whole seam makes, and the only way to check it is to have a second
 * provider. Writing one that does nothing is much cheaper than integrating one that works, and
 * tests the same joint.
 *
 * It is safe to leave in the build. Nothing selects it unless the environment names it, and if
 * somebody ever did in production the classroom would say "this version of the app cannot open
 * echo video calls" rather than showing a black rectangle.
 */
export const echoProvider: VideoProvider = {
  name: "echo",
  capabilities: { screenShare: false, builtInChat: false },
  configured: () => true,
  ensureRoom: async (sessionId) => `https://video.invalid/echo/${sessionId}`,
  joinToken: async (sessionId: string | number, options: JoinOptions) =>
    `echo.${sessionId}.${options.isOwner ? "owner" : "guest"}`,
};
