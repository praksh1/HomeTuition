import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
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

/** Immutable simulated capture. Never included in real receipts, revenue or payouts. */
export const batchTestPaymentsTable = pgTable("batch_test_payments", {
  bookingId: integer("booking_id").primaryKey().references(() => batchTestBookingsTable.id, { onDelete: "restrict" }),
  receipt: jsonb("receipt").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only decisions for the simulated money held against each purchased lesson. */
export const batchTestLedgerEntriesTable = pgTable("batch_test_ledger_entries", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => batchTestBookingsTable.id, { onDelete: "restrict" }),
  /** Zero-based position from the frozen batch snapshot and immutable receipt. */
  position: integer("position").notNull(),
  actorId: integer("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  event: text("event").notNull(),
  fromState: text("from_state").notNull(),
  toState: text("to_state").notNull(),
  grossNpr: integer("gross_npr").notNull(),
  teacherNpr: integer("teacher_npr").notNull(),
  fadkoNpr: integer("fadko_npr").notNull(),
  detail: jsonb("detail").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("batch_test_ledger_booking_idx").on(t.bookingId, t.id)]);
