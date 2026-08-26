import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  sessionMessageAttachmentsTable,
  sessionMessageReactionsTable,
} from "@workspace/db";
import { verifyUpload } from "./fileStore";

/**
 * Files and reactions on class messages, in one place.
 *
 * Two routes serve a class conversation — `/sessions/:id/messages` for a single class and
 * `/monthly/classes/:id/messages` for a course — and the owner's requirement is that both work
 * like the Messages tab. Written once rather than twice, because the last time this project had
 * two implementations of one conversation, they could not see each other.
 */

export interface AttachmentView {
  fileKey: string;
  fileType: string;
  fileName: string | null;
}

export interface ReactionView {
  emoji: string;
  count: number;
  /** Whether this reader is one of the people counted, so the chip can show as pressed. */
  mine: boolean;
}

/**
 * Decorate a page of class messages.
 *
 * Two queries for the whole page rather than two per message: a class of thirty on a cheap
 * phone re-reads this thread every few seconds, and a round trip per bubble is the difference
 * between a screen that opens and one that crawls.
 */
export async function decorateClassMessages<T extends { id: number }>(
  rows: T[],
  userId: number,
): Promise<(T & { attachments: AttachmentView[]; reactions: ReactionView[] })[]> {
  const ids = rows.map((r) => r.id);
  const [files, reactions] = ids.length
    ? await Promise.all([
        db.select().from(sessionMessageAttachmentsTable)
          .where(inArray(sessionMessageAttachmentsTable.messageId, ids)),
        db.select().from(sessionMessageReactionsTable)
          .where(inArray(sessionMessageReactionsTable.messageId, ids)),
      ])
    : [[], []];

  const filesBy = new Map<number, typeof files>();
  for (const f of files) filesBy.set(f.messageId, [...(filesBy.get(f.messageId) ?? []), f]);
  const reactionsBy = new Map<number, typeof reactions>();
  for (const r of reactions) reactionsBy.set(r.messageId, [...(reactionsBy.get(r.messageId) ?? []), r]);

  return rows.map((row) => {
    const on = reactionsBy.get(row.id) ?? [];
    return {
      ...row,
      attachments: (filesBy.get(row.id) ?? []).map((f) => ({
        fileKey: f.fileKey, fileType: f.fileType, fileName: f.fileName,
      })),
      /*
       * Counted, with this reader's own marked — never the list of who reacted. In a class of
       * thirty that list is thirty names shipped to every phone for a chip reading "30 👍".
       */
      reactions: Object.entries(
        on.reduce<Record<string, number>>((acc, r) => {
          acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
          return acc;
        }, {}),
      ).map(([emoji, count]) => ({
        emoji,
        count,
        mine: on.some((r) => r.emoji === emoji && r.userId === userId),
      })),
    };
  });
}

/**
 * Attach a file to a class message that has already been written.
 *
 * The file is checked against what actually landed in the bucket — who owns it, how big it
 * really is, what type it really is. Everything the app claimed when it asked for the upload
 * link was a claim.
 *
 * A file that fails does not sink the message. The words are the message and losing both is the
 * worst outcome; the sender is told the file did not go.
 */
export async function attachToClassMessage(args: {
  messageId: number;
  userId: number;
  fileKey: string;
  fileType?: string;
  fileName?: string;
}): Promise<{ attached: AttachmentView | null; problem: string | null }> {
  const verdict = await verifyUpload(args.fileKey.trim(), args.userId);
  if (!verdict.ok) return { attached: null, problem: verdict.reason };

  const [row] = await db.insert(sessionMessageAttachmentsTable).values({
    messageId: args.messageId,
    fileKey: args.fileKey.trim(),
    // The bucket's word on the type, not the phone's.
    fileType: verdict.contentType || args.fileType || "application/octet-stream",
    fileName: args.fileName?.trim() ? args.fileName.trim().slice(0, 200) : null,
  }).returning();

  return {
    attached: row ? { fileKey: row.fileKey, fileType: row.fileType, fileName: row.fileName } : null,
    problem: null,
  };
}

/** A reaction is one emoji, not a sentence. Length rather than a fixed list — see messages.ts. */
export function readReaction(raw: unknown): string | null {
  const chosen = typeof raw === "string" ? raw.trim() : "";
  if (!chosen || [...chosen].length > 4) return null;
  return chosen;
}

/**
 * React to a class message, or take it back.
 *
 * One per person per message: a different emoji replaces yours, the same one again removes it.
 * The unique index is what actually enforces the "one" — two taps in quick succession both pass
 * a read-then-write.
 */
export async function reactToClassMessage(
  messageId: number,
  userId: number,
  emoji: string,
): Promise<string | null> {
  const [existing] = await db
    .select({ id: sessionMessageReactionsTable.id, emoji: sessionMessageReactionsTable.emoji })
    .from(sessionMessageReactionsTable)
    .where(and(
      eq(sessionMessageReactionsTable.messageId, messageId),
      eq(sessionMessageReactionsTable.userId, userId),
    ));

  if (existing && existing.emoji === emoji) {
    await db.delete(sessionMessageReactionsTable).where(eq(sessionMessageReactionsTable.id, existing.id));
    return null;
  }
  if (existing) {
    await db.update(sessionMessageReactionsTable).set({ emoji })
      .where(eq(sessionMessageReactionsTable.id, existing.id));
  } else {
    await db.insert(sessionMessageReactionsTable)
      .values({ messageId, userId, emoji }).onConflictDoNothing();
  }
  return emoji;
}
