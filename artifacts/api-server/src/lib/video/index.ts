import { dailyProvider } from "./dailyProvider";
import { echoProvider } from "./echoProvider";
import { livekitProvider } from "./livekitProvider";
import { hasNativeLiveKit, providerForPlatform, readClientPlatform, selectProvider } from "./select";
import type { VideoProvider } from "./types";

export type {
  ClientPlatform,
  JoinOptions,
  RoomGrant,
  VideoCapabilities,
  VideoProvider,
} from "./types";
export { readClientPlatform } from "./select";
export { NATIVE_MEDIA_CAPABILITY_HEADER, PLATFORM_HEADER } from "./types";

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
  /**
   * Under trial, web only. A future native build can opt in through a compatibility header,
   * but the provider remains web-only until that build and its SDK pass device checks.
   *
   * Daily and LiveKit each ship a fork of the same native WebRTC library and cannot both be in one
   * phone build, so the Android and iOS apps stay on Daily. Set `VIDEO_PROVIDER=livekit` on a
   * browser-facing deployment to try it; set it back to `daily` to undo, with no rebuild.
   */
  livekit: livekitProvider,
  // Carries no video. Present so the seam can be proved against the real server rather than
  // asserted — see scripts/video-tests. Nothing selects it unless the environment names it.
  echo: echoProvider,
};

/**
 * The provider for one caller.
 *
 * `clientPlatform` is what the client said it is — `web`, `ios`, `android`, or nothing at all.
 * It decides compatibility and nothing else. An installed client without the explicitly
 * supported native LiveKit capability keeps Daily. No class right or owner grant depends on
 * either client-controlled header.
 *
 * Omit it and you get the configured provider unfiltered, which is what the non-room callers
 * (diagnostics, the webhook path) want.
 */
export function videoProvider(clientPlatform?: string | null, nativeMediaCapability?: string | null): VideoProvider {
  // Read at call time rather than frozen at import, so the provider can be switched without a
  // rebuild — and so it can be switched inside a test at all.
  const chosen = selectProvider(process.env.VIDEO_PROVIDER, PROVIDERS, dailyProvider);
  if (clientPlatform === undefined) return chosen;
  return providerForPlatform(chosen, readClientPlatform(clientPlatform), dailyProvider, hasNativeLiveKit(nativeMediaCapability));
}

/** Every provider this build knows how to use. For diagnostics, not for choosing. */
export function knownProviders(): string[] {
  return Object.keys(PROVIDERS);
}
