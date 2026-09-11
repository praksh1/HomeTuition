import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * A teacher's structured Learning Program: the parent promise, and the ordered path through it.
 *
 * ## Two new tables rather than columns anywhere
 *
 * Deliberate, and measured. `.agents/memory/schema-change-deploy-window.md`: the API redeploys on
 * every push while `db:push` is a command the owner runs by hand, so code is always newer than the
 * database for a while. Drizzle names every column it knows about in `INSERT` and in a bare
 * `select()`, so a **new column on an existing table takes sign-in and registration down** in that
 * window — that was measured, not guessed. A **new table cannot**: nothing that already exists
 * refers to it, so every existing query is unaffected and only this feature waits.
 *
 * So there is no program column on `sessions`, on `recurring_sessions`, on `recurring_days` or on
 * any enrolment. The backlog is explicit about the same thing for a different reason: existing
 * purchases and refund calculations depend on the current shape of those tables, and old contracts
 * keep their original promises. The parent is introduced *alongside* them and migrated later,
 * explicitly.
 *
 * ## What is deliberately absent
 *
 * The program rows themselves still carry no price or commercial terms. Phase 3 adds separate
 * shadow-ledger tables below, after the owner approved the beta terms on 2026-09-10. Keeping them
 * separate means a published Program remains editorial content and each simulated purchase keeps
 * its own frozen agreement. No provider, checkout, real collection, refund or payout exists here.
 */

/** The only three states. A program is being written, is public, or has been put away. */
export const LEARNING_PROGRAM_STATUSES = ["draft", "published", "archived"] as const;
export type LearningProgramStatus = (typeof LEARNING_PROGRAM_STATUSES)[number];

export const learningProgramsTable = pgTable(
  "learning_programs",
  {
    id: serial("id").primaryKey(),
    /** The independent teacher who owns this. The only account that may change it. */
    teacherId: integer("teacher_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("draft"),
    /** One of `PROGRAM_TYPES` in `api-server/src/lib/learningPrograms.ts`. Checked at the route. */
    type: text("type").notNull(),

    /*
      The editable draft.

      Every one of these is nullable, because a half-written program is a real and permitted state
      — the brief allows saving an incomplete draft and refuses only publication. NULL says "not
      written yet" exactly, and the publish validator reads it as missing rather than as an answer.
    */
    title: text("title"),
    summary: text("summary"),
    outcome: text("outcome"),
    intendedLearner: text("intended_learner"),
    startingLevel: text("starting_level"),
    teachingLanguage: text("teaching_language"),
    prerequisites: text("prerequisites"),
    equipment: text("equipment"),
    referenceName: text("reference_name"),
    /**
     * `official | teacher_supplied | none`, and it is the whole honesty mechanism.
     *
     * A teacher saying they follow a syllabus is not Fadko saying the syllabus is endorsed. This
     * field carries that difference to the student verbatim; nothing in the read path is allowed
     * to promote `teacher_supplied` to `official`.
     */
    referenceSource: text("reference_source").notNull().default("none"),

    /*
      What was actually published, and which version of it.

      The snapshot is the immutability. Public reads are served from it and never from the columns
      above, so a teacher editing their draft cannot change what a student already saw; only an
      explicit re-publish can, and that increments the version. Keeping the frozen copy in one
      jsonb column is the smallest model that preserves it — a versions table would hold the same
      one row per program until somebody needs the history, and nothing yet does.
    */
    version: integer("version").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedSnapshot: jsonb("published_snapshot"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // The teacher's own list, newest first.
    index("learning_programs_teacher_idx").on(table.teacherId, table.status, table.id),
    // The public list: published only, and it is the only index a browsing student needs.
    index("learning_programs_public_idx").on(table.status, table.publishedAt),
  ],
);

/**
 * One step of the path, in order.
 *
 * A table rather than a jsonb array on the program because a module is the thing Phase 2 attaches
 * lessons, materials and homework to; those need a row to point at. `position` is normalised to
 * 0..n-1 on every save and rows are updated in place where the positions line up, so an id stays
 * with its step for as long as the step stays where it is.
 */
export const learningProgramModulesTable = pgTable(
  "learning_program_modules",
  {
    id: serial("id").primaryKey(),
    programId: integer("program_id")
      .notNull()
      .references(() => learningProgramsTable.id, { onDelete: "cascade" }),
    /** 0-based, dense, and the only thing that decides the order a student reads them in. */
    position: integer("position").notNull(),
    title: text("title"),
    outcome: text("outcome"),
    description: text("description"),
    practicePrompt: text("practice_prompt"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("learning_program_modules_program_idx").on(table.programId, table.position)],
);

/**
 * One scheduled run of a published Learning Program.
 *
 * Commercial and schedule promises live here rather than on the reusable Program. A teacher may
 * offer the same Program at different times without rewriting what the Program teaches. Public
 * reads use `publishedSnapshot`, so editing a later draft never silently changes an offer a
 * student already saw. This foundation exposes no checkout or enrolment action.
 */
export const learningProgramBatchesTable = pgTable(
  "learning_program_batches",
  {
    id: serial("id").primaryKey(),
    programId: integer("program_id")
      .notNull()
      .references(() => learningProgramsTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("draft"),
    capacity: integer("capacity"),
    totalTuitionNpr: integer("total_tuition_npr"),
    version: integer("version").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedSnapshot: jsonb("published_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("learning_program_batches_program_idx").on(table.programId, table.status, table.id),
    index("learning_program_batches_public_idx").on(table.status, table.publishedAt),
  ],
);

/** A lesson promised by one batch, ordered by position and stored as an absolute instant. */
/** A stable group survives successive prepaid periods. Anchor freezes on first publication. */
export const learningProgramTuitionGroupsTable = pgTable("learning_program_tuition_groups", {
  id: serial("id").primaryKey(),
  programId: integer("program_id").notNull().references(() => learningProgramsTable.id, { onDelete: "cascade" }),
  anchorAt: timestamp("anchor_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("learning_program_tuition_groups_program_idx").on(table.programId)]);

/** Absence means an existing fixed course; never reinterpret historical batches as tuition. */
export const learningProgramBatchPeriodsTable = pgTable("learning_program_batch_periods", {
  batchId: integer("batch_id").primaryKey().references(() => learningProgramBatchesTable.id, { onDelete: "cascade" }),
  groupId: integer("group_id").notNull().references(() => learningProgramTuitionGroupsTable.id, { onDelete: "cascade" }),
  periodIndex: integer("period_index").notNull(),
}, (table) => [uniqueIndex("learning_program_batch_periods_group_idx").on(table.groupId, table.periodIndex)]);

export const learningProgramBatchLessonsTable = pgTable(
  "learning_program_batch_lessons",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id")
      .notNull()
      .references(() => learningProgramBatchesTable.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("learning_program_batch_lessons_position_idx").on(table.batchId, table.position),
    index("learning_program_batch_lessons_start_idx").on(table.batchId, table.startsAt),
  ],
);

/**
 * A simulated Learning Program purchase used to prove Fadko's accounting before a gateway is
 * connected. `payment_status` is deliberately `test_confirmed`, never `paid`: no report may turn
 * test access into revenue. Commercial terms are frozen here so later edits to a Program cannot
 * rewrite an old student's agreement.
 */
export const learningProgramEnrollmentsTable = pgTable(
  "learning_program_enrollments",
  {
    id: serial("id").primaryKey(),
    programId: integer("program_id")
      .notNull()
      .references(() => learningProgramsTable.id, { onDelete: "restrict" }),
    studentId: integer("student_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    programVersion: integer("program_version").notNull(),
    totalTuitionNpr: integer("total_tuition_npr").notNull(),
    paidLessonCount: integer("paid_lesson_count").notNull(),
    teacherShareBps: integer("teacher_share_bps").notNull(),
    platformShareBps: integer("platform_share_bps").notNull(),
    studentFeeNpr: integer("student_fee_npr").notNull().default(0),
    complaintWindowHours: integer("complaint_window_hours").notNull(),
    payoutWeekday: integer("payout_weekday").notNull(),
    paymentStatus: text("payment_status").notNull().default("test_confirmed"),
    paymentReference: text("payment_reference"),
    termsSnapshot: jsonb("terms_snapshot").notNull(),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("learning_program_enrollments_student_program_idx").on(table.studentId, table.programId),
    index("learning_program_enrollments_teacher_statement_idx").on(table.programId, table.id),
  ],
);

/** One immutable slice of the simulated purchase. Only its state changes through the ledger. */
export const learningProgramAllocationsTable = pgTable(
  "learning_program_allocations",
  {
    id: serial("id").primaryKey(),
    enrollmentId: integer("enrollment_id")
      .notNull()
      .references(() => learningProgramEnrollmentsTable.id, { onDelete: "cascade" }),
    lessonNumber: integer("lesson_number").notNull(),
    grossAmountNpr: integer("gross_amount_npr").notNull(),
    teacherAmountNpr: integer("teacher_amount_npr").notNull(),
    platformAmountNpr: integer("platform_amount_npr").notNull(),
    state: text("state").notNull().default("future"),
    stateChangedAt: timestamp("state_changed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("learning_program_allocations_lesson_idx").on(table.enrollmentId, table.lessonNumber),
    index("learning_program_allocations_state_idx").on(table.state, table.id),
  ],
);

/** Append-only explanation of every simulated enrolment and allocation decision. */
export const learningProgramLedgerEntriesTable = pgTable(
  "learning_program_ledger_entries",
  {
    id: serial("id").primaryKey(),
    enrollmentId: integer("enrollment_id")
      .notNull()
      .references(() => learningProgramEnrollmentsTable.id, { onDelete: "cascade" }),
    allocationId: integer("allocation_id").references(() => learningProgramAllocationsTable.id, {
      onDelete: "cascade",
    }),
    actorId: integer("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
    event: text("event").notNull(),
    fromState: text("from_state"),
    toState: text("to_state"),
    grossAmountNpr: integer("gross_amount_npr").notNull(),
    detail: jsonb("detail").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("learning_program_ledger_enrollment_idx").on(table.enrollmentId, table.id),
    index("learning_program_ledger_created_idx").on(table.createdAt, table.id),
  ],
);

export type LearningProgramRow = typeof learningProgramsTable.$inferSelect;
export type LearningProgramModuleRow = typeof learningProgramModulesTable.$inferSelect;
export type LearningProgramBatchRow = typeof learningProgramBatchesTable.$inferSelect;
export type LearningProgramBatchLessonRow = typeof learningProgramBatchLessonsTable.$inferSelect;
export type LearningProgramEnrollmentRow = typeof learningProgramEnrollmentsTable.$inferSelect;
export type LearningProgramAllocationRow = typeof learningProgramAllocationsTable.$inferSelect;
export type LearningProgramLedgerEntryRow = typeof learningProgramLedgerEntriesTable.$inferSelect;
