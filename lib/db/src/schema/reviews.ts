import { integer, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

export const reviewsTable = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    teacherId: integer("teacher_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    studentId: integer("student_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /**
     * The session this review is about. A review is earned by attending one specific
     * session, and pinning it here is what stops a student leaving unlimited reviews for
     * the same teacher. Nullable only because seeded/legacy rows predate the column.
     */
    sessionId: integer("session_id").references(() => sessionsTable.id, { onDelete: "cascade" }),
    studentName: text("student_name").notNull(),
    rating: real("rating").notNull(),
    comment: text("comment").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The database is the real guarantee: two requests arriving at once would both pass an
    // application-level "already reviewed?" check. Postgres treats NULLs as distinct, so
    // legacy rows with no session_id are unaffected.
    uniqueIndex("reviews_student_session_unique").on(table.studentId, table.sessionId),
  ],
);

export const insertReviewSchema = createInsertSchema(reviewsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviewsTable.$inferSelect;
