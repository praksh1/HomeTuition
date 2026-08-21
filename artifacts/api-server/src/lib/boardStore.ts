import { eq } from "drizzle-orm";
import { db, sessionBoardTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Keeping a lesson's whiteboard through a restart.
 *
 * The board lives in memory in the classroom hub, so a restart erased it. That is not a rare
 * event here — the API redeploys itself on every push, so shipping anything during a class
 * took its whiteboard with it, with no warning and nothing to recover.
 *
 * Deliberately best-effort in both directions. Saving is throttled and never throws; failing
 * to save costs a board on the next restart, while letting the failure escape would cost the
 * lesson happening right now. Loading answers "nothing stored" rather than an error, which is
 * exactly what a class that has not started yet looks like.
 */

/**
 * How long to wait after a change before writing.
 *
 * A teacher drawing produces a change every hundred milliseconds or so. Writing each one would
 * turn one lesson into thousands of round trips to Neon for a board nobody is reading. Two
 * seconds is short enough that a restart loses at most a stroke or two.
 */
const SAVE_DEBOUNCE_MS = 2_000;

/**
 * A ceiling on what is worth keeping, in characters of JSON.
 *
 * Pictures dominate: each is capped at about 1.5 MB by the app before it is sent, and a board
 * may hold up to forty. Writing 60 MB into one row on every change would be a bad trade for
 * something only read after a crash. Past this the elements are still saved and the pictures
 * are dropped, because a restored board with an empty frame is worse than one without the
 * picture — but a board with nothing at all is worse than both.
 */
const MAX_PERSISTED_CHARS = 6_000_000;

export interface StoredBoard {
  scene: unknown[];
  files: unknown[];
  view: Record<string, number> | null;
}

const pending = new Map<number, ReturnType<typeof setTimeout>>();

/** Reads back what was stored, or nulls when there is nothing — which is not an error. */
export async function loadBoard(sessionId: number): Promise<StoredBoard | null> {
  try {
    const [row] = await db
      .select({
        scene: sessionBoardTable.scene,
        files: sessionBoardTable.files,
        view: sessionBoardTable.view,
      })
      .from(sessionBoardTable)
      .where(eq(sessionBoardTable.sessionId, sessionId));
    if (!row) return null;
    return {
      scene: Array.isArray(row.scene) ? row.scene : [],
      files: Array.isArray(row.files) ? row.files : [],
      view: (row.view as Record<string, number> | null) ?? null,
    };
  } catch (err) {
    // A board that cannot be read is a board that starts empty, which is where it started
    // before any of this existed.
    logger.warn({ err, sessionId }, "could not read the stored whiteboard");
    return null;
  }
}

/** Writes now, without waiting for the debounce. Used when a class ends. */
export async function saveBoardNow(sessionId: number, board: StoredBoard): Promise<void> {
  const timer = pending.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    pending.delete(sessionId);
  }

  try {
    let files = board.files;
    const withFiles = JSON.stringify({ scene: board.scene, files });
    if (withFiles.length > MAX_PERSISTED_CHARS) {
      files = [];
      logger.warn(
        { sessionId, size: withFiles.length },
        "whiteboard too large to keep its pictures through a restart; keeping the drawing only",
      );
    }

    await db
      .insert(sessionBoardTable)
      .values({ sessionId, scene: board.scene, files, view: board.view, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: sessionBoardTable.sessionId,
        set: { scene: board.scene, files, view: board.view, updatedAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err, sessionId }, "could not keep the whiteboard; it will not survive a restart");
  }
}

/**
 * Asks for a save shortly. Repeated calls collapse into one.
 *
 * `read` is called at write time rather than the board being passed in, so what is stored is
 * the board as it is when the write happens — not a snapshot from whenever the teacher
 * happened to draw.
 */
export function saveBoardSoon(sessionId: number, read: () => StoredBoard): void {
  if (pending.has(sessionId)) return;
  pending.set(
    sessionId,
    setTimeout(() => {
      pending.delete(sessionId);
      void saveBoardNow(sessionId, read());
    }, SAVE_DEBOUNCE_MS),
  );
}

/** Forgets a board entirely — the teacher cleared it, or the class is over. */
export async function forgetBoard(sessionId: number): Promise<void> {
  const timer = pending.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    pending.delete(sessionId);
  }
  try {
    await db.delete(sessionBoardTable).where(eq(sessionBoardTable.sessionId, sessionId));
  } catch (err) {
    logger.warn({ err, sessionId }, "could not clear the stored whiteboard");
  }
}
