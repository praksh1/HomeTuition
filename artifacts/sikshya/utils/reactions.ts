/**
 * The reactions the app offers, in one place.
 *
 * Six, and no more: a long grid of every emoji is a search problem on a phone. These are the
 * ones a lesson actually needs — understood, thank you, well done, and the three that carry a
 * feeling.
 *
 * Shared by the private conversation and both class conversations, because the owner's
 * requirement is that chat works the same everywhere, and two lists would drift apart the first
 * time somebody edited one of them.
 */
export const REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "🙏"];

export interface Reaction {
  emoji: string;
  count: number;
  /** Whether this reader is one of the people counted, so the chip can show as pressed. */
  mine: boolean;
}

export interface Attachment {
  fileKey: string;
  fileType: string;
  fileName: string | null;
}

/** What to call a file when the sender's phone gave it no name — the key itself is a UUID. */
export function attachmentLabel(file: Attachment): string {
  return file.fileName ?? (file.fileType.startsWith("image/") ? "Photo" : "File");
}

/**
 * What one tap does to the reactions already on a message.
 *
 * Pure, so the rule the server enforces can be checked without a server: one reaction per
 * person, a different emoji replaces yours, the same one again removes it. The screen shows
 * this immediately and reconciles afterwards — a tap that waits for a round trip on a poor
 * connection feels broken.
 */
export function applyReaction(current: Reaction[], emoji: string): Reaction[] {
  const alreadyMine = current.some((r) => r.emoji === emoji && r.mine);
  // Whatever this person had before goes, whether they are replacing it or taking it back.
  const withoutMine = current
    .map((r) => (r.mine ? { ...r, count: r.count - 1, mine: false } : r))
    .filter((r) => r.count > 0);
  if (alreadyMine) return withoutMine;
  return withoutMine.some((r) => r.emoji === emoji)
    ? withoutMine.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r))
    : [...withoutMine, { emoji, count: 1, mine: true }];
}
