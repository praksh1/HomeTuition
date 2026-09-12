import { integer, jsonb, pgTable, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { learningProgramBatchesTable } from "./learningPrograms";
import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

/** Test-only frozen promises. These are not payment receipts or a paid commerce ledger. */
export const batchTestContractsTable = pgTable("batch_test_contracts", {
  batchId: integer("batch_id").primaryKey().references(() => learningProgramBatchesTable.id, { onDelete: "restrict" }),
  snapshot: jsonb("snapshot").notNull(),
  teacherGrantId: integer("teacher_grant_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const batchTestSessionsTable = pgTable("batch_test_sessions", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => batchTestContractsTable.batchId, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "restrict" }),
}, (t) => [uniqueIndex("batch_test_sessions_lesson_idx").on(t.batchId, t.position), uniqueIndex("batch_test_sessions_session_idx").on(t.sessionId)]);

export const batchTestBookingsTable = pgTable("batch_test_bookings", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => batchTestContractsTable.batchId, { onDelete: "restrict" }),
  studentId: integer("student_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  studentGrantId: integer("student_grant_id").notNull(),
  /** Price illustration and lesson subset accepted, not money received. */
  quote: jsonb("quote").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("batch_test_bookings_student_idx").on(t.batchId, t.studentId)]);
