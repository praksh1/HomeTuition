import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

export const sessionEnrollmentsTable = pgTable("session_enrollments", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => sessionsTable.id, { onDelete: "cascade" }),
  studentId: integer("student_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  paymentStatus: text("payment_status").notNull().default("pending"), // pending | paid | refunded
  paymentMethod: text("payment_method"), // esewa | khalti
  /** The provider's transaction id, recorded when a payment is confirmed. */
  paymentReference: text("payment_reference"),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSessionEnrollmentSchema = createInsertSchema(sessionEnrollmentsTable).omit({
  id: true,
  enrolledAt: true,
});
export type InsertSessionEnrollment = z.infer<typeof insertSessionEnrollmentSchema>;
export type SessionEnrollment = typeof sessionEnrollmentsTable.$inferSelect;
