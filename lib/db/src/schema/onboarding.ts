import { date, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/** Private onboarding facts. None of these fields belong in a public teacher response. */
export const userOnboardingTable = pgTable("user_onboarding", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  dateOfBirth: date("date_of_birth"),
  phone: text("phone"),
  province: text("province"),
  district: text("district"),
  localLevel: text("local_level"),
  locality: text("locality"),
  institutionName: text("institution_name"),
  affiliationStatus: text("affiliation_status"), // affiliated | independent | not_specified
  guardianName: text("guardian_name"),
  guardianEmail: text("guardian_email"),
  guardianPhone: text("guardian_phone"),
  guardianRelationship: text("guardian_relationship"),
  profilePhotoKey: text("profile_photo_key"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const teacherCredentialsTable = pgTable(
  "teacher_credentials",
  {
    id: serial("id").primaryKey(),
    teacherId: integer("teacher_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(),
    fileKey: text("file_key").notNull(),
    originalName: text("original_name").notNull(),
    contentType: text("content_type").notNull(),
    status: text("status").notNull().default("submitted"), // submitted | opened | approved | rejected | withdrawn
    openedAt: timestamp("opened_at", { withTimezone: true }),
    openedBy: integer("opened_by").references(() => usersTable.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: integer("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [index("teacher_credentials_teacher_idx").on(table.teacherId, table.documentType, table.id)],
);

/** Content is allowed to save, but a match creates a reviewable case for an operator. */
export const moderationFlagsTable = pgTable(
  "moderation_flags",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    surface: text("surface").notNull(),
    subjectId: integer("subject_id"),
    excerpt: text("excerpt").notNull(),
    matchedTerms: text("matched_terms").array().notNull().default([]),
    status: text("status").notNull().default("open"),
    resolvedBy: integer("resolved_by").references(() => usersTable.id, { onDelete: "set null" }),
    resolution: text("resolution"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [index("moderation_flags_status_idx").on(table.status, table.id)],
);

export type UserOnboarding = typeof userOnboardingTable.$inferSelect;
export type TeacherCredential = typeof teacherCredentialsTable.$inferSelect;
export type ModerationFlag = typeof moderationFlagsTable.$inferSelect;
