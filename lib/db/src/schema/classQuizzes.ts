import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { learningProgramBatchesTable } from "./learningPrograms";
import { usersTable } from "./users";

export interface QuizQuestion {
  id: string;
  prompt: string;
  kind: "choice" | "short";
  options: string[];
  answer: string;
  points: number;
  confirmed: boolean;
}
/** Published content is immutable. Corrections require a new draft, not changing a student's test. */
export const classQuizzesTable = pgTable("class_quizzes", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => learningProgramBatchesTable.id, { onDelete: "cascade" }),
  teacherId: integer("teacher_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  requestKey: text("request_key"),
  title: text("title").notNull(),
  questions: jsonb("questions").$type<QuizQuestion[]>().notNull(),
  status: text("status").notNull().default("draft"),
  revision: integer("revision").notNull().default(1),
  dueAt: timestamp("due_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
}, t => [index("class_quizzes_batch_idx").on(t.batchId, t.id), uniqueIndex("class_quizzes_request_idx").on(t.batchId, t.requestKey)]);

/** One final, server-graded answer set per student; duplicate submit returns the original. */
export const classQuizAttemptsTable = pgTable("class_quiz_attempts", {
  id: serial("id").primaryKey(),
  quizId: integer("quiz_id").notNull().references(() => classQuizzesTable.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(),
  answers: jsonb("answers").$type<Record<string, string>>().notNull(),
  score: integer("score").notNull(),
  possible: integer("possible").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("class_quiz_attempt_once_idx").on(t.quizId, t.studentId)]);
