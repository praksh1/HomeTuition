/** Deliberately small, lesson-friendly set; mirrored by the server's allowlist. */
export const CLASS_REACTIONS = [
  { emoji: "👍", label: "Got it" },
  { emoji: "👏", label: "Well done" },
  { emoji: "❤️", label: "Love this" },
  { emoji: "🙌", label: "Thank you" },
  { emoji: "❓", label: "Please explain" },
] as const;
export const REACTION_COOLDOWN_MS = 1500;
