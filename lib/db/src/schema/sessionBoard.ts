import { integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";
import { sessionsTable } from "./sessions";

/**
 * The whiteboard of a class, kept so a server restart does not erase a lesson.
 *
 * Board state has always lived in memory in the classroom hub, which means every restart wipes
 * whatever was drawn. That is not a rare event here: the API redeploys itself on every push,
 * so shipping any change during a class took its whiteboard with it — and the teacher had no
 * warning and nothing to recover.
 *
 * A table of its own, like session_activity and for the same measured reason: Drizzle names
 * every column of a table in its INSERT and in a bare `select()`, `sessions` is read with a
 * bare select in several routes, and the API redeploys before `db:push` is run by hand. A
 * column there breaks reading classes at all until the two catch up.
 */
export const sessionBoardTable = pgTable("session_board", {
  sessionId: integer("session_id")
    .primaryKey()
    .references(() => sessionsTable.id, { onDelete: "cascade" }),
  /** Excalidraw elements, including tombstones — erasing is an edit and has to survive too. */
  scene: jsonb("scene").$type<unknown[]>(),
  /** The pictures those elements point at. An element without its picture is an empty frame. */
  files: jsonb("files").$type<unknown[]>(),
  /** Where the teacher was looking, so a restored board opens on the work rather than a corner. */
  view: jsonb("view").$type<Record<string, number> | null>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SessionBoard = typeof sessionBoardTable.$inferSelect;
