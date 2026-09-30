/** Private make-up response. The server, not this screen, decides allowance and actions. */
export interface RemedyQuota {
  bookingId: number;
  batchId: number;
  classTitle: string;
  limit: number;
  used: number;
  remaining: number;
  noRollover: true;
}
export interface RemedyCase {
  id: number;
  status: string;
  reason: "student_missed" | "teacher_missed";
  teacherNonDeliveryConfirmed: boolean;
  requestedAt: string;
  replacementDeadlineAt: string;
  replacementReviewClosesAt: string | null;
  outcome: string | null;
  requestNote?: string | null;
  teacherDecisionReason?: string | null;
  offer: null | {
    id: number;
    status: string;
    startsAt: string;
    endsAt: string;
    expiresAt: string;
    replacementSessionId: number | null;
  };
  actions: {
    withdraw: boolean;
    offer: boolean;
    reject: boolean;
    accept: boolean;
    decline: boolean;
    confirmDelivery: boolean;
    resolve: boolean;
  };
}
export interface RemedyLesson {
  bookingId: number;
  batchId: number;
  classTitle: string;
  originalPosition: number;
  originalSessionId: number;
  title: string;
  startsAt: string;
  endsAt: string;
  studentName?: string;
  studentId?: number;
  canRequest: boolean;
  disallowedReason?: string;
  canReportTeacherMissed: boolean;
  case: RemedyCase | null;
  quota: Pick<RemedyQuota, "limit" | "used" | "remaining">;
}
export interface RemedyList {
  enabled: boolean;
  unavailableReason?: string;
  truncated?: boolean;
  truncationReason?: string;
  role: string;
  serverNow: string;
  quotas: RemedyQuota[];
  lessons: RemedyLesson[];
}
export type RemedyFilter = "attention" | "scheduled" | "history" | "all";
export function remedyStatusLabel(value: RemedyCase): string {
  if (value.status === "resolved") {
    return (
      (
        {
          replacement_delivered: "Make-up completed",
          student_missed_replacement: "Missed make-up reviewed",
          teacher_missed_replacement: "Teacher non-delivery reviewed",
          refund_review: "Refund review",
          no_adjustment: "Review completed",
        } as Record<string, string>
      )[value.outcome ?? ""] ?? "Review completed"
    );
  }
  return (
    (
      {
        requested: "Requested",
        offered:
          value.offer?.status === "proposed"
            ? "Date offered"
            : "Offer ended — needs review",
        accepted: "Make-up assigned",
        delivered_review: "Delivered — review window",
        review_required: "Needs support review",
        withdrawn: "Withdrawn",
      } as Record<string, string>
    )[value.status] ?? "Status unavailable"
  );
}
export function remedyGroup(
  lesson: RemedyLesson,
): Exclude<RemedyFilter, "all"> {
  if (!lesson.case) return "attention";
  if (["resolved", "withdrawn"].includes(lesson.case.status)) return "history";
  if (["accepted", "delivered_review"].includes(lesson.case.status))
    return "scheduled";
  return "attention";
}
export function remedyVisibleLessons(
  lessons: RemedyLesson[],
  filter: RemedyFilter,
  sessionId?: number,
): RemedyLesson[] {
  return lessons.filter(
    (lesson) =>
      (!sessionId || lesson.originalSessionId === sessionId) &&
      (filter === "all" || remedyGroup(lesson) === filter),
  );
}
/** Never parse a date/time in the browser's US/local zone. Both fields represent Nepal time. */
export function remedyOfferInstant(date: string, time: string): string | null {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    return null;
  const carrier = new Date(`${date}T12:00:00Z`);
  if (
    !Number.isFinite(carrier.getTime()) ||
    carrier.toISOString().slice(0, 10) !== date
  )
    return null;
  return new Date(`${date}T${time}:00+05:45`).toISOString();
}
export function remedyQuotaLabel(
  quota: Pick<RemedyQuota, "limit" | "used" | "remaining">,
): string {
  return quota.limit === 0
    ? "No courtesy allowance for this purchase"
    : `${quota.remaining} of ${quota.limit} courtesy make-ups available`;
}
