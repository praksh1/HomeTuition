import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { batchTestBookingsTable } from "./batchTesting";
import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

/**
 * Additive, dormant make-up foundation for the existing simulated batch checkout.
 *
 * One original purchased allocation owns one case for its entire life, including review.
 * Original position is the zero-based position in the frozen booking/receipt, not an index
 * into a teacher's editable timetable. The request transaction must verify that the booking,
 * original session, participant IDs and receipt allocation all describe that same promise.
 * These FKs alone cannot establish that cross-table relationship.
 *
 * No schema export activates remedies, grants a seat or moves money. Runtime acceptance must
 * lock the original payment/allocation and case, create linked access without a new charge,
 * record the acceptance and hold its original allocation in the same transaction. Settlement,
 * refund decisions, schedules and closure must use that same identity before activation.
 */
export const lessonRemedyCasesTable = pgTable("lesson_remedy_cases", {
  id: serial("id").primaryKey(),
  originalBookingId: integer("original_booking_id").notNull()
    .references(() => batchTestBookingsTable.id, { onDelete: "restrict" }),
  originalPosition: integer("original_position").notNull(),
  originalSessionId: integer("original_session_id").notNull()
    .references(() => sessionsTable.id, { onDelete: "restrict" }),
  studentId: integer("student_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  teacherId: integer("teacher_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  reason: text("reason").notNull(), // student_missed | teacher_missed; never a verdict by itself
  /** A student's allegation is not evidence of teacher non-delivery. */
  teacherNonDeliveryConfirmed: boolean("teacher_non_delivery_confirmed").notNull().default(false),
  teacherFailedReplacement: boolean("teacher_failed_replacement").notNull().default(false),
  status: text("status").notNull().default("requested"),
  /** Frozen allowance/deadline terms; never silently apply a later policy to an old request. */
  policyVersion: text("policy_version").notNull(),
  policySnapshot: jsonb("policy_snapshot").notNull(),
  /** Server-recorded advance notice does not mark the lesson absent or cancel original access. */
  requestedBeforeStart: boolean("requested_before_start").notNull().default(false),
  /** Preserve the original review clock even when an offer lasts longer than 48 hours. */
  originalClaimClosesAt: timestamp("original_claim_closes_at", { withTimezone: true }).notNull(),
  replacementDeadlineAt: timestamp("replacement_deadline_at", { withTimezone: true }).notNull(),
  /** A replacement has its own delivery review; it does not erase an existing original claim. */
  replacementReviewClosesAt: timestamp("replacement_review_closes_at", { withTimezone: true }),
  outcome: text("outcome"), // Human resolution, distinct from offer/session/ledger state.
  resolvedBy: integer("resolved_by").references(() => usersTable.id, { onDelete: "restrict" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("lesson_remedy_cases_original_idx").on(table.originalBookingId, table.originalPosition),
  index("lesson_remedy_cases_student_idx").on(table.studentId, table.status, table.id),
  index("lesson_remedy_cases_teacher_idx").on(table.teacherId, table.status, table.id),
  index("lesson_remedy_cases_session_idx").on(table.originalSessionId, table.id),
  check("lesson_remedy_cases_position_check", sql`${table.originalPosition} >= 0`),
  check("lesson_remedy_cases_reason_check", sql`${table.reason} IN ('student_missed', 'teacher_missed')`),
  check("lesson_remedy_cases_status_check", sql`${table.status} IN ('requested', 'offered', 'accepted', 'delivered_review', 'review_required', 'resolved', 'withdrawn')`),
  check("lesson_remedy_cases_policy_check", sql`jsonb_typeof(${table.policySnapshot}) = 'object' AND length(${table.policyVersion}) > 0`),
  check("lesson_remedy_cases_outcome_check", sql`${table.outcome} IS NULL OR ${table.outcome} IN ('replacement_delivered', 'student_missed_replacement', 'teacher_missed_replacement', 'refund_review', 'no_adjustment')`),
]);

/**
 * Offers are versioned records, not edits to the original purchased lesson. A case can have
 * one pending offer and at most one accepted offer ever: failed replacements resume this case
 * in human review rather than starting a replacement-of-a-replacement chain.
 *
 * The session ID is intentionally NOT unique. A teacher-missed group lesson may have one shared
 * replacement session with independent acceptance by each affected student. Capacity and both
 * parties' availability still need serialized runtime validation; an offer is not an enrollment.
 */
export const lessonRemedyOffersTable = pgTable("lesson_remedy_offers", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => lessonRemedyCasesTable.id, { onDelete: "restrict" }),
  version: integer("version").notNull(),
  offeredBy: integer("offered_by").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("proposed"),
  replacementSessionId: integer("replacement_session_id")
    .references(() => sessionsTable.id, { onDelete: "restrict" }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  declinedAt: timestamp("declined_at", { withTimezone: true }),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("lesson_remedy_offers_version_idx").on(table.caseId, table.version),
  uniqueIndex("lesson_remedy_offers_pending_idx").on(table.caseId).where(sql`${table.status} = 'proposed'`),
  // Acceptance remains recorded forever, including when its session later fails.
  uniqueIndex("lesson_remedy_offers_accepted_idx").on(table.caseId).where(sql`${table.acceptedAt} IS NOT NULL`),
  index("lesson_remedy_offers_session_idx").on(table.replacementSessionId, table.id),
  index("lesson_remedy_offers_expiry_idx").on(table.status, table.expiresAt),
  check("lesson_remedy_offers_version_check", sql`${table.version} > 0`),
  check("lesson_remedy_offers_time_check", sql`${table.endsAt} > ${table.startsAt} AND ${table.expiresAt} > ${table.createdAt}`),
  check("lesson_remedy_offers_status_check", sql`${table.status} IN ('proposed', 'accepted', 'declined', 'expired', 'withdrawn')`),
  check("lesson_remedy_offers_acceptance_check", sql`${table.status} <> 'accepted' OR (${table.acceptedAt} IS NOT NULL AND ${table.replacementSessionId} IS NOT NULL AND ${table.acceptedAt} < ${table.expiresAt} AND ${table.acceptedAt} < ${table.startsAt})`),
]);

/** Append-only transactional trail; public views must project approved fields, not raw detail. */
export const lessonRemedyEventsTable = pgTable("lesson_remedy_events", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => lessonRemedyCasesTable.id, { onDelete: "restrict" }),
  offerId: integer("offer_id").references(() => lessonRemedyOffersTable.id, { onDelete: "restrict" }),
  actorId: integer("actor_id").references(() => usersTable.id, { onDelete: "restrict" }),
  actorRole: text("actor_role").notNull(), // student | teacher | operator | system
  event: text("event").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  /** Optional per-case idempotency key for writes; null audit events are not deduplicated. */
  requestKey: text("request_key"),
  detail: jsonb("detail").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("lesson_remedy_events_case_idx").on(table.caseId, table.id),
  uniqueIndex("lesson_remedy_events_request_idx").on(table.caseId, table.requestKey),
  check("lesson_remedy_events_detail_check", sql`jsonb_typeof(${table.detail}) = 'object'`),
]);

export type LessonRemedyCaseRow = typeof lessonRemedyCasesTable.$inferSelect;
export type LessonRemedyOfferRow = typeof lessonRemedyOffersTable.$inferSelect;
export type LessonRemedyEventRow = typeof lessonRemedyEventsTable.$inferSelect;
