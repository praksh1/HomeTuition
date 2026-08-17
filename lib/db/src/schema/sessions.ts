import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { usersTable } from "./users";

export const sessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  teacherId: integer("teacher_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  teacherName: text("teacher_name").notNull(),
  subject: text("subject").notNull(),
  topic: text("topic").notNull(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  duration: integer("duration").notNull().default(60),
  maxStudents: integer("max_students").notNull().default(20),
  enrolledCount: integer("enrolled_count").notNull().default(0),
  price: integer("price").notNull().default(0),
  status: text("status").notNull().default("upcoming"), // upcoming | live | completed | cancelled
  /**
   * When the teacher actually started the class, which is often not when it was scheduled.
   * Staleness must be judged from this: a teacher who starts a 12:30 class at 15:00 is still
   * teaching, and expiring it against the scheduled slot would eject the whole class.
   */
  startedAt: timestamp("started_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({
  id: true,
  enrolledCount: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessionsTable.$inferSelect;
