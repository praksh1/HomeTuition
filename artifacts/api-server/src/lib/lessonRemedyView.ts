import type { LessonRemedyStatus } from "./lessonRemedies.ts";

/** Private participant response; no phone, email, DOB, identity documents or operator notes. */
export interface LessonRemedyQuotaView {
  bookingId: number; batchId: number; classTitle: string;
  limit: number; used: number; remaining: number; noRollover: true;
}
export interface LessonRemedyCaseView {
  id: number; status: LessonRemedyStatus; reason: "student_missed" | "teacher_missed";
  teacherNonDeliveryConfirmed: boolean; requestedAt: string; replacementDeadlineAt: string;
  replacementReviewClosesAt: string | null; outcome: string | null;
  requestNote: string | null; teacherDecisionReason: string | null;
  offer: null | { id: number; status: string; startsAt: string; endsAt: string; expiresAt: string; replacementSessionId: number | null };
  actions: { withdraw: boolean; offer: boolean; reject: boolean; accept: boolean; decline: boolean; confirmDelivery: boolean; resolve: boolean };
}
export interface LessonRemedyLessonView {
  bookingId: number; batchId: number; classTitle: string; originalPosition: number;
  originalSessionId: number; title: string; startsAt: string; endsAt: string;
  studentName?: string; studentId?: number;
  canRequest: boolean; disallowedReason?: string; canReportTeacherMissed: boolean;
  case: LessonRemedyCaseView | null; quota: Pick<LessonRemedyQuotaView, "limit" | "used" | "remaining">;
}
export interface LessonRemedyListView {
  enabled: boolean; unavailableReason?: string; role: string; serverNow: string;
  truncated?: boolean; truncationReason?: string;
  quotas: LessonRemedyQuotaView[]; lessons: LessonRemedyLessonView[];
}
