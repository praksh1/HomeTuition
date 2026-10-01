/**
 * /drop-info has separate legacy cancellation, linked class-purchase and
 * departed receipt responses. Enrollment alone does not make a price quote.
 * Never fill an absent quote with zero or offer an unpriced cancellation.
 */
export interface DropInfo {
  enrolled: boolean;
  canDrop: boolean;
  left?: boolean;
  refundAmount?: number | null;
  refundPaid?: boolean;
  businessDaysLeft?: number | null;
  businessDaysTotal?: number;
  reason?: string | null;
  originalSessionId?: number;
  bookingId?: number;
  position?: number;
  pricePaid?: number;
  studentRefund?: number;
  teacherShare?: number;
  platformShare?: number;
  full?: boolean;
  known?: boolean;
  headline?: string;
  detail?: string;
  deadlineHours?: number;
}

export interface DropQuote extends DropInfo {
  pricePaid: number;
  studentRefund: number;
  teacherShare: number;
  platformShare: number;
  full: boolean;
  known: true;
  headline: string;
  detail: string;
  deadlineHours: number;
}

const amount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const positiveId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export function isLinkedDropLesson(info: DropInfo): info is DropInfo & {
  originalSessionId: number; bookingId: number; position: number;
} {
  return info.enrolled === true && info.canDrop === false &&
    positiveId(info.originalSessionId) && positiveId(info.bookingId) && amount(info.position);
}

/** A well-formed server quote, not a new calculation or permission decision. */
export function hasDropQuote(info: DropInfo): info is DropQuote {
  return amount(info.pricePaid) && amount(info.studentRefund) &&
    amount(info.teacherShare) && amount(info.platformShare) &&
    info.studentRefund + info.teacherShare + info.platformShare === info.pricePaid &&
    typeof info.full === "boolean" && info.known === true &&
    typeof info.headline === "string" && info.headline.length > 0 &&
    typeof info.detail === "string" && info.detail.length > 0 && amount(info.deadlineHours);
}
