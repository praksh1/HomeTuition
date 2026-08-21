/**
 * Matching a person's name the way people actually type it.
 *
 * Reported with examples, and every one of them failed against the substring match this
 * replaces: looking for "Ram Prasad", a student might type `RamPrasad`, `ram p rasa d`,
 * `ram pra sad`, or `r ampr asad`. Those are the same letters in the same order with the
 * spaces in the wrong places — which is what a phone keyboard, a thumb, and a name the
 * student has only ever heard out loud will produce.
 *
 * The rule is therefore: **spacing and punctuation carry no meaning**. Both sides are reduced
 * to bare letters and digits before anything is compared. Word order still counts for
 * something, so a query given as separate words also matches when those words appear in any
 * order — "prasad ram" finds Ram Prasad.
 *
 * Pure and dependency-free so it can be tested on its own; see search.test.ts, which encodes
 * the reported examples directly.
 */

/**
 * Letters and digits only, lowercased, with accents flattened.
 *
 * Accents matter here beyond tidiness: a name typed on a Nepali keyboard and the same name
 * typed on an English one should find each other.
 */
export function normalise(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** The query's words, each normalised, with empties dropped. */
function words(query: string): string[] {
  return query
    .split(/\s+/)
    .map(normalise)
    .filter((w) => w.length > 0);
}

/**
 * Whether `haystack` matches what the person typed.
 *
 * Three chances, cheapest first:
 *
 * 1. The whole query, spaces removed, appears in the haystack with spaces removed. This is
 *    what makes `r ampr asad` find Ram Prasad.
 * 2. Every word of the query appears somewhere. This is what makes `prasad ram` and
 *    `maths ram` work — order and adjacency stop mattering.
 * 3. Nothing else. A match that needs more imagination than this is a wrong answer presented
 *    confidently, which is worse than no answer.
 */
export function matches(haystack: string, query: string): boolean {
  const q = normalise(query);
  if (q.length === 0) return true;

  const hay = normalise(haystack);
  if (hay.includes(q)) return true;

  const parts = words(query);
  if (parts.length > 1 && parts.every((part) => hay.includes(part))) return true;

  return false;
}

/**
 * How well something matches, for ordering results. Higher is better; 0 is no match.
 *
 * The owner asked for "the closest matching results" rather than a yes/no filter, so a name
 * that starts with what was typed should come before one that merely contains it, and both
 * before a match found only in a bio.
 */
export function score(fields: { value: string; weight: number }[], query: string): number {
  const q = normalise(query);
  if (q.length === 0) return 1;

  let best = 0;
  for (const { value, weight } of fields) {
    const hay = normalise(value);
    if (!hay) continue;

    let field = 0;
    if (hay === q) field = 4;
    else if (hay.startsWith(q)) field = 3;
    else if (hay.includes(q)) field = 2;
    else {
      const parts = words(query);
      if (parts.length > 1 && parts.every((part) => hay.includes(part))) field = 1;
    }

    if (field > 0) best = Math.max(best, field * weight);
  }
  return best;
}
