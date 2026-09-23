/** Ephemeral feedback, never arbitrary text or an unbounded animation stream. */
export const CLASS_REACTION_EMOJI = new Set(["👍", "👏", "❤️", "🙌", "❓"]);
export function acceptClassReaction(
  recent: Map<number, number>, userId: number, emoji: unknown, now: number,
): emoji is string {
  if (typeof emoji !== "string" || !CLASS_REACTION_EMOJI.has(emoji)) return false;
  if (now - (recent.get(userId) ?? -Infinity) < 1500) return false;
  // Bound the total room stream as well as each authenticated participant.
  let inWindow = 0;
  for (const [id, time] of recent) {
    if (now - time > 10_000) recent.delete(id);
    else if (now - time < 1000) inWindow++;
  }
  if (inWindow >= 8) return false;
  recent.set(userId, now);
  return true;
}
