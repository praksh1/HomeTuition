/**
 * Choosing a provider, as arithmetic on a name and a table.
 *
 * Pure and importing nothing at runtime, deliberately: `--experimental-strip-types` cannot
 * resolve extensionless imports, so anything reachable from `lib/video/index.ts` — which
 * imports the Daily client, which imports the world — cannot be unit-tested at all. This is
 * the same split `requestAction.ts` and `sessionChanges.ts` already use for the same reason.
 *
 * The rule it encodes is small but worth stating: an unrecognised name **falls back** rather
 * than failing. A typo in an environment variable must not take video down for every class on
 * the platform, and a server that is up but silently on the wrong provider is easier to notice
 * than one that will not start.
 */
export function selectProvider<T extends { name: string }>(
  wanted: string | undefined | null,
  registry: Record<string, T>,
  fallback: T,
): T {
  const key = (wanted ?? "").trim().toLowerCase();
  if (!key) return fallback;
  return registry[key] ?? fallback;
}

/**
 * What a client says it is, or null.
 *
 * Null rather than a guess: an unrecognised platform must be treated as "I don't know", and
 * `providerForPlatform` answers a don't-know with the provider that runs everywhere. Guessing
 * "web" from silence would hand a LiveKit room to an old app build that cannot open one.
 */
export function readClientPlatform(raw: unknown): "web" | "ios" | "android" | null {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return value === "web" || value === "ios" || value === "android" ? value : null;
}

/**
 * The provider a given client can actually use.
 *
 * The configured one when it runs there; otherwise the fallback, which by construction runs
 * everywhere. This is what makes `VIDEO_PROVIDER=livekit` safe to set on a deployment that also
 * serves phones: a browser gets the trial, a phone keeps Daily, and neither is asked to run
 * something its build does not contain.
 *
 * An unknown platform gets the fallback too. That covers the case that actually matters — an
 * app build from before this header existed, which is a phone far more often than not, and
 * which must not be handed a room it cannot open.
 */
export function providerForPlatform<
  T extends { name: string; platforms: readonly string[] },
>(chosen: T, platform: string | null, fallback: T): T {
  if (platform === null) return fallback;
  return chosen.platforms.includes(platform) ? chosen : fallback;
}
