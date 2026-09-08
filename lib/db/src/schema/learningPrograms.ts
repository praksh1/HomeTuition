import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

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
 * No price, no fee, no commission, no payout, no provider, no ledger and no enrolment. None of
 * those numbers is decided — `.agents/backlog/2026-09-07-learning-program-managed-marketplace.md`
 * lists nine commercial questions still open — and a column invites a convenient constant to be
 * put in it and later read as settled. Phase 3 adds the ledger; this is Phase 1.
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

export type LearningProgramRow = typeof learningProgramsTable.$inferSelect;
export type LearningProgramModuleRow = typeof learningProgramModulesTable.$inferSelect;
