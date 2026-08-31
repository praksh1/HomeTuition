import { db, moderationFlagsTable } from "@workspace/db";
import { flaggedTerms } from "./moderationRules";

export async function flagContent(args: {
  userId: number;
  surface: string;
  subjectId?: number | null;
  text: string;
}): Promise<boolean> {
  const matched = flaggedTerms(args.text);
  if (matched.length === 0) return false;
  try {
    await db.insert(moderationFlagsTable).values({
      userId: args.userId,
      surface: args.surface,
      subjectId: args.subjectId ?? null,
      excerpt: args.text.trim().slice(0, 500),
      matchedTerms: matched,
      status: "open",
    });
    return true;
  } catch {
    // Moderation storage being unavailable must not turn a valid registration or class into a
    // half-completed operation. The boot guard logs the missing-table problem separately.
    return false;
  }
}

export { flaggedTerms } from "./moderationRules";
