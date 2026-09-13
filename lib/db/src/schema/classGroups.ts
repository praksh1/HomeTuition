import {
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { learningProgramBatchesTable } from "./learningPrograms";
import { usersTable } from "./users";

/** Persistent conversation for one new-style class group. Monthly classes keep their old table. */
export const classGroupMessagesTable = pgTable(
  "class_group_messages",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id")
      .notNull()
      .references(() => learningProgramBatchesTable.id, {
        onDelete: "cascade",
      }),
    senderId: integer("sender_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    senderName: text("sender_name").notNull(),
    senderRole: text("sender_role").notNull(),
    body: text("body").notNull(),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("class_group_messages_batch_idx").on(t.batchId, t.id)],
);

/** Per-person read position for one class conversation. */
export const classGroupMessageReadsTable = pgTable(
  "class_group_message_reads",
  {
    batchId: integer("batch_id")
      .notNull()
      .references(() => learningProgramBatchesTable.id, {
        onDelete: "cascade",
      }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    lastReadMessageId: integer("last_read_message_id").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.batchId, t.userId] }),
    index("class_group_message_reads_user_idx").on(t.userId, t.batchId),
  ],
);

/** A teacher-set task for one batch. It is never attached to an old recurring-class id. */
export const classGroupHomeworkTable = pgTable(
  "class_group_homework",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id")
      .notNull()
      .references(() => learningProgramBatchesTable.id, {
        onDelete: "cascade",
      }),
    teacherId: integer("teacher_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    instructions: text("instructions"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("class_group_homework_batch_idx").on(t.batchId, t.id)],
);

/** One student's answer per task. Text-first keeps it usable on a weak connection. */
export const classGroupHomeworkSubmissionsTable = pgTable(
  "class_group_homework_submissions",
  {
    id: serial("id").primaryKey(),
    homeworkId: integer("homework_id")
      .notNull()
      .references(() => classGroupHomeworkTable.id, { onDelete: "cascade" }),
    studentId: integer("student_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    note: text("note").notNull(),
    status: text("status").notNull().default("submitted"),
    feedback: text("feedback"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("class_group_homework_submission_once_idx").on(
      t.homeworkId,
      t.studentId,
    ),
    index("class_group_homework_submissions_task_idx").on(t.homeworkId, t.id),
  ],
);

/**
 * Photos and PDFs attached to new-style homework.
 *
 * Kept in an additive table rather than adding nullable columns to the task and submission
 * tables. That lets an already-running server create the feature safely, and each file keeps
 * an explicit purpose so a student's answer can never be mistaken for a class handout.
 */
export const classGroupHomeworkFilesTable = pgTable(
  "class_group_homework_files",
  {
    id: serial("id").primaryKey(),
    homeworkId: integer("homework_id")
      .notNull()
      .references(() => classGroupHomeworkTable.id, { onDelete: "cascade" }),
    submissionId: integer("submission_id").references(
      () => classGroupHomeworkSubmissionsTable.id,
      { onDelete: "cascade" },
    ),
    uploaderId: integer("uploader_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    fileKey: text("file_key").notNull(),
    fileType: text("file_type").notNull(),
    fileName: text("file_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("class_group_homework_files_key_idx").on(t.fileKey),
    index("class_group_homework_files_task_idx").on(t.homeworkId, t.id),
    index("class_group_homework_files_submission_idx").on(t.submissionId, t.id),
  ],
);

/** Teacher-curated class material. URL is optional: a useful note may stand alone. */
export const classGroupMaterialsTable = pgTable(
  "class_group_materials",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id")
      .notNull()
      .references(() => learningProgramBatchesTable.id, {
        onDelete: "cascade",
      }),
    teacherId: integer("teacher_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    note: text("note"),
    url: text("url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("class_group_materials_batch_idx").on(t.batchId, t.id)],
);
