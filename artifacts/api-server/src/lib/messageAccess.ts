import { eq } from "drizzle-orm";
import { db, messageAttachmentsTable, messagesTable } from "@workspace/db";

/**
 * May this person open a file that was sent in a conversation?
 *
 * ### Why this exists at all
 *
 * `GET /storage/file` lets in the person who uploaded a file, a support agent, the reporter of
 * the dispute it is attached to, and the people a homework belongs to. A photo sent in a
 * message is none of those — so without this, sending somebody a picture produced a bubble
 * they could see and a file they could not open.
 *
 * The sender's own screen works perfectly either way, because the sender *is* the uploader.
 * That is exactly how a fault like this survives being tried out by whoever built it, and why
 * the test for it signs in as the recipient.
 *
 * ### Who
 *
 * The two people in the conversation, and nobody else. Not an agent by way of this check —
 * the route already decides about agents on its own, and a private message is not a support
 * report.
 *
 * The message is looked up from the file rather than the other way round, because the caller
 * has a key and nothing else. A key attached to no message falls through, and the caller
 * refuses it.
 */
export async function mayOpenMessageFile(key: string, userId: number): Promise<boolean> {
  const rows = await db
    .select({ senderId: messagesTable.senderId, receiverId: messagesTable.receiverId })
    .from(messageAttachmentsTable)
    .innerJoin(messagesTable, eq(messagesTable.id, messageAttachmentsTable.messageId))
    .where(eq(messageAttachmentsTable.fileKey, key));

  // A key can hang off more than one message — the same photo sent on to somebody else. Any
  // one of them being yours is enough, and `some` says that more plainly than a cleverer
  // query would.
  return rows.some((m) => m.senderId === userId || m.receiverId === userId);
}
