import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/** Never joined into user/profile/classroom/support-assistant responses. Separate audited access only. */
export const identityVerificationsTable = pgTable("identity_verifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  holder: text("holder").notNull(), // self | parent; never overwrite the student's own DOB/name
  status: text("status").notNull().default("pending_upload"),
  policyVersion: text("policy_version").notNull(),
  detailsCiphertext: text("details_ciphertext"), // null after rejected-details deletion
  encryptionKeyVersion: text("encryption_key_version").notNull(),
  fileKey: text("file_key"), // dedicated private identity namespace; never evidence/profile uploads
  consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: integer("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
  rejectionCode: text("rejection_code"), // fixed codes only, never legal identity in free-form notes
  fileDeletedAt: timestamp("file_deleted_at", { withTimezone: true }),
  detailsDeletedAt: timestamp("details_deleted_at", { withTimezone: true }),
  accountClosedAt: timestamp("account_closed_at", { withTimezone: true }),
  holdStartedAt: timestamp("hold_started_at", { withTimezone: true }),
  holdReviewedAt: timestamp("hold_reviewed_at", { withTimezone: true }),
  holdReviewRequestedAt: timestamp("hold_review_requested_at", { withTimezone: true }),
  holdCaseId: integer("hold_case_id"), // reference only; do not copy ticket narrative into identity data
  holdVersion: integer("hold_version").notNull().default(0), // prevents a stale operator releasing a newer hold
}, table => [index("identity_verifications_user_idx").on(table.userId, table.id)]);

/** Sensitive reads must commit an audit event BEFORE decryption/file access, not fire-and-forget. */
export const identityAccessEventsTable = pgTable("identity_access_events", {
  id: serial("id").primaryKey(),
  verificationId: integer("verification_id").notNull().references(() => identityVerificationsTable.id, { onDelete: "restrict" }),
  actorId: integer("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  action: text("action").notNull(), // metadata_opened | document_opened | reviewed | hold | retention
  purpose: text("purpose").notNull(), // fixed purpose code, not a copy of identity details
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("identity_access_events_record_idx").on(table.verificationId, table.id)]);

/** Operational checkpoint only; contains no document, legal details or secret material. */
export const identityRetentionJobTable = pgTable("identity_retention_job", {
  name: text("name").primaryKey(),
  cursorId: integer("cursor_id").notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull().defaultNow(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastCycleAt: timestamp("last_cycle_at", { withTimezone: true }),
  failureCount: integer("failure_count").notNull().default(0),
});
