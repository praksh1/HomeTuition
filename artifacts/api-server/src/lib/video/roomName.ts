/**
 * What a class's room is called, whoever is carrying the call.
 *
 * ## Why this is copied rather than imported
 *
 * `lib/daily.ts` has had this exact rule since the Daily integration was written, and Daily is
 * deliberately not being edited during the LiveKit trial — the whole point is that Daily keeps
 * working untouched so the owner can switch back with one environment variable. Importing this
 * out of `daily.ts` would mean editing it; leaving LiveKit to invent its own naming would mean
 * two conventions.
 *
 * So the rule lives here in provider-neutral form, and `roomName.test.ts` asserts that it and
 * `sanitizeRoomName` in `lib/daily.ts` agree on every input tried. If somebody changes one, the
 * test says so rather than a class quietly getting two different room names on two providers.
 *
 * ## Why the name has to match across providers
 *
 * `sikshya42` is how a provider event finds its way back to session 42 — see
 * `lib/sessionProof/providerEvents.ts`, which parses exactly this shape. A LiveKit room named
 * anything else would correlate to no class at all, and the evidence for a refund would silently
 * be about nothing.
 */

/**
 * The room for a class, from its id.
 *
 * Lossy in general — an id of `1-2` and one of `12` both give `sikshya12` — which is why the
 * inverse in `providerEvents.ts` is strict and refuses anything that is not `sikshya` followed
 * by digits. Session ids are integers, so for this product the mapping is one to one.
 */
export function roomNameForSession(rawId: string | number): string {
  return "sikshya" + String(rawId).replace(/[^a-zA-Z0-9]/g, "");
}
