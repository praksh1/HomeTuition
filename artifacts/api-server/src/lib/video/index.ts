import { dailyProvider } from "./dailyProvider";
import { echoProvider } from "./echoProvider";
import { selectProvider } from "./select";
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
  // Carries no video. Present so the seam can be proved against the real server rather than
  // asserted — see scripts/video-tests. Nothing selects it unless the environment names it.
  echo: echoProvider,
};

export function videoProvider(): VideoProvider {
  // Read at call time rather than frozen at import, so the provider can be switched without a
  // rebuild — and so it can be switched inside a test at all.
  return selectProvider(process.env.VIDEO_PROVIDER, PROVIDERS, dailyProvider);
}

/** Every provider this build knows how to use. For diagnostics, not for choosing. */
export function knownProviders(): string[] {
  return Object.keys(PROVIDERS);
}
