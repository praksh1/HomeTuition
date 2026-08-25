import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { recurringSessionsTable } from "./recurringSessions";
import { usersTable } from "./users";

/**
 * A piece of homework a teacher set for a monthly class.
 *
 * The file is optional. A teacher on a cheap phone should be able to set homework by typing
 * "exercise 4, page 62" without first finding a way to produce a PDF — the owner's teachers are
 * as likely to be working from a textbook as from a computer.
 */
export const homeworkTable = pgTable(
  "homework",
  {
    id: serial("id").primaryKey(),
    recurringId: integer("recurring_id")
      .notNull()
      .references(() => recurringSessionsTable.id, { onDelete: "cascade" }),
    teacherId: integer("teacher_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** Which month it was set in, so a student's own month shows their own homework. */
    cycleIndex: integer("cycle_index").notNull(),
    title: text("title").notNull(),
    instructions: text("instructions"),
    /** The question sheet in the file store, if there is one. */
    fileKey: text("file_key"),
    fileType: text("file_type"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    /** open | closed. Closed stops new submissions without deleting anything. */
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("homework_class_idx").on(table.recurringId, table.cycleIndex),
    index("homework_teacher_idx").on(table.teacherId, table.id),
  ],
);

/**
 * One student's answer to one piece of homework, and what the teacher did with it.
 *
 * **One row per student per homework**, enforced below. The owner asked for each submission to
 * be unique and answered individually, and a student who uploads twice has replaced their
 * answer rather than added a second one — so the teacher marking it is never looking at two
 * files wondering which is the real one.
 *
 * The teacher can answer in three ways, and all three live here rather than in three tables
 * because they are one act: a reply to this student about this piece of work.
 *
 * - `feedback` — words back to that student, and only that student.
 * - `annotatedKey` — the work marked up and handed back as a file, which is what a teacher
 *   who prefers to write on paper and photograph it will do.
 * - `annotation` — marks made on top of the work in the app, kept as data rather than baked
 *   into an image so the original is never overwritten and the marking can be redrawn.
 */
export const homeworkSubmissionsTable = pgTable(
  "homework_submissions",
  {
    id: serial("id").primaryKey(),
    homeworkId: integer("homework_id")
      .notNull()
      .references(() => homeworkTable.id, { onDelete: "cascade" }),
    studentId: integer("student_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** What the student handed in. */
    fileKey: text("file_key").notNull(),
    fileType: text("file_type").notNull(),
    note: text("note"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    /** submitted | returned. */
    status: text("status").notNull().default("submitted"),
    /** The teacher's words back, to this student alone. */
    feedback: text("feedback"),
    /** The marked-up file, when the teacher marked it outside the app and uploaded it back. */
    annotatedKey: text("annotated_key"),
    annotatedType: text("annotated_type"),
    /**
     * Marking drawn on top of the work in the app, as data.
     *
     * Kept separately from the file on purpose: the student's original is never overwritten,
     * so a disagreement about what was handed in can always be settled by the file itself.
     */
    annotation: text("annotation"),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
  },
  (table) => [
    // One answer per student per piece of homework. Uploading again replaces it.
    uniqueIndex("homework_submissions_once_idx").on(table.homeworkId, table.studentId),
    index("homework_submissions_student_idx").on(table.studentId, table.id),
    index("homework_submissions_status_idx").on(table.homeworkId, table.status),
  ],
);

export type Homework = typeof homeworkTable.$inferSelect;
export type HomeworkSubmission = typeof homeworkSubmissionsTable.$inferSelect;
