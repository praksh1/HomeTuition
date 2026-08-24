import { dailyProvider } from "./dailyProvider";
import type { VideoProvider } from "./types";

export type { JoinOptions, RoomGrant, VideoCapabilities, VideoProvider } from "./types";

/**
 * Which provider is carrying the video.
 *
 * Chosen from the environment, like payments and email and file storage in this codebase: the
 * mode follows from what is configured rather than from a flag somebody has to remember to
 * flip. `VIDEO_PROVIDER` names it; Daily is the default because it is what is deployed.
 *
 * Adding a second provider is: write the file, add it here, set the variable. Nothing in the
 * routes or the classroom screens changes.
 */
const PROVIDERS: Record<string, VideoProvider> = {
  daily: dailyProvider,
};

export function videoProvider(): VideoProvider {
  const wanted = (process.env.VIDEO_PROVIDER ?? "daily").trim().toLowerCase();
  return PROVIDERS[wanted] ?? dailyProvider;
}

/** Every provider this build knows how to use. For diagnostics, not for choosing. */
export function knownProviders(): string[] {
  return Object.keys(PROVIDERS);
}
