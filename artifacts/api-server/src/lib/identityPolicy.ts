import { ageOn } from "./onboardingRules.ts";

/** Private identity policy. Never merge these values into public profile or AI context objects. */
export const IDENTITY_POLICY_VERSION = "2026-09-26";
export const IDENTITY_FILE_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
export const IDENTITY_MAX_BYTES = 8 * 1024 * 1024;
export type IdentityStatus = "pending_upload" | "submitted" | "approved" | "rejected";
export type IdentityHolder = "self" | "parent";
export interface IdentityDetails {
  holder: IdentityHolder;
  legalName: string;
  documentNumber: string;
  dateOfBirth: string;
  issuingDistrict: string;
  issuingMunicipality: string;
  parentRelationship: string | null;
  consent: true;
}

export function validateIdentityDetails(input: unknown, role: string, today = new Date()):
  { ok: true; value: IdentityDetails } | { ok: false; errors: Record<string, string> } {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const errors: Record<string, string> = {};
  const text = (key: string, label: string, max: number) => {
    const value = typeof body[key] === "string" ? body[key].trim() : "";
    if (!value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) errors[key] = `Enter ${label} (up to ${max} characters).`;
    return value;
  };
  if (role !== "teacher" && role !== "student") errors.role = "Only teaching and student accounts can submit identity documents.";
  if (body.holder !== "self" && !(role === "student" && body.holder === "parent")) {
    errors.holder = role === "teacher" ? "Upload your own citizenship document." : "Choose your own or a parent's citizenship document.";
  }
  if (body.documentType !== "citizenship") errors.documentType = "A citizenship document is required. A school ID alone is not sufficient.";
  const legalName = text("legalName", "the document holder's legal name", 160);
  const documentNumber = text("documentNumber", "the citizenship number", 80);
  const dateOfBirth = text("dateOfBirth", "the document holder's date of birth", 10);
  if (ageOn(dateOfBirth, today) === null) errors.dateOfBirth = "Enter a valid date of birth, not a future date.";
  const issuingDistrict = text("issuingDistrict", "the issuing district shown on the document", 100);
  const issuingMunicipality = text("issuingMunicipality", "the issuing municipality shown on the document", 160);
  const parentRelationship = body.holder === "parent" ? text("parentRelationship", "the parent's relationship to the student", 60) : null;
  if (body.consent !== true) errors.consent = "The document holder must consent to submission and the identity privacy notice.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { holder: body.holder as IdentityHolder, legalName, documentNumber,
    dateOfBirth, issuingDistrict, issuingMunicipality, parentRelationship, consent: true } };
}

/** Approval never comes from upload, OCR, or an AI response. Student ID collection is paused. */
export function identityAccess(role: string, status: IdentityStatus | null): {
  mayBook: boolean; mayAcceptBookings: boolean;
} {
  return {
    // Keep the student/parent document implementation for a future explicit policy change,
    // but do not make a student's tuition booking depend on submitting either document.
    mayBook: role === "student",
    mayAcceptBookings: role === "teacher" && status === "approved",
  };
}

const DAY = 86_400_000;
/** One calendar year after closure, clamping a leap-day anniversary to February 28. */
export function identityDetailsDeleteAfter(closedAt: Date | null): Date | null {
  if (!closedAt) return null;
  const due = new Date(closedAt);
  const month = due.getUTCMonth();
  due.setUTCFullYear(due.getUTCFullYear() + 1);
  if (due.getUTCMonth() !== month) due.setUTCDate(0);
  return due;
}
/** Pending-review records are not abandoned uploads: never silently delete a live review queue. */
export function identityFileDeleteAfter(status: IdentityStatus, reviewedAt: Date | null): Date | null {
  if (status === "submitted" || status === "pending_upload" || !reviewedAt) return null;
  return new Date(reviewedAt.getTime() + (status === "approved" ? 90 : 30) * DAY);
}

export function identityRetentionAction(input: {
  status: IdentityStatus; reviewedAt: Date | null; fileDeletedAt: Date | null;
  holdStartedAt: Date | null; holdReviewedAt: Date | null; now: Date;
  accountClosedAt?: Date | null; createdAt?: Date; detailsDeletedAt?: Date | null;
}): "keep" | "delete_file" | "delete_rejected_details" | "delete_closed_details" | "delete_abandoned_details" | "review_hold" {
  if (input.holdStartedAt) {
    const lastReview = input.holdReviewedAt ?? input.holdStartedAt;
    return input.now.getTime() >= lastReview.getTime() + 90 * DAY ? "review_hold" : "keep";
  }
  const closureDue = identityDetailsDeleteAfter(input.accountClosedAt ?? null);
  if (closureDue && input.now >= closureDue && (!input.detailsDeletedAt || !input.fileDeletedAt)) return "delete_closed_details";
  if (input.status === "pending_upload" && input.createdAt && input.now.getTime() >= input.createdAt.getTime() + 30 * DAY
    && (!input.detailsDeletedAt || !input.fileDeletedAt)) return "delete_abandoned_details";
  const due = identityFileDeleteAfter(input.status, input.reviewedAt);
  if (!due || input.now < due) return "keep";
  if (input.status === "rejected") return "delete_rejected_details";
  return input.fileDeletedAt ? "keep" : "delete_file";
}

/** Explicit allowlist: even own-account status responses never include legal identity or storage keys. */
export function identityStatusSummary(row: {
  id: number; status: IdentityStatus; holder: IdentityHolder; createdAt: Date;
  reviewedAt: Date | null; fileDeletedAt: Date | null;
}) {
  return { id: row.id, status: row.status, holder: row.holder, submittedAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    fileDeleteAfter: identityFileDeleteAfter(row.status, row.reviewedAt)?.toISOString() ?? null,
    documentDeleted: !!row.fileDeletedAt };
}
