import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull(), // "teacher" | "student" | "admin"
  passwordHash: text("password_hash").notNull(),
  /**
   * When this account was suspended, and why. Null for an account in good standing.
   *
   * A separate flag rather than deleting the row: a suspended teacher's classes, reviews and
   * attendance records all still have to exist — a complaint about somebody is not resolved by
   * making them disappear, and the record is what the next complaint is judged against.
   *
   * Checked at sign-in, so a suspension takes effect the next time they try to use the app
   * rather than only on the screens somebody remembered to guard.
   */
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspendedReason: text("suspended_reason"),
  /** The agent who did it. Kept because "who suspended this account" is always the next question. */
  suspendedBy: integer("suspended_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
