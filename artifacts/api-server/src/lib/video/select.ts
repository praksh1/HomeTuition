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
