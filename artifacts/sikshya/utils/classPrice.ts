/** Display-only average. Payment amounts must come from the server, never this helper. */
export function classPriceBreakdown(total: number, lessons: number): string {
  if (!Number.isSafeInteger(total) || total < 1 || !Number.isInteger(lessons) || lessons < 1)
    return "Choose lesson dates and a full price to see the breakdown.";
  const average = (total / lessons).toLocaleString("en-NP", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Includes ${lessons} live ${lessons === 1 ? "lesson" : "lessons"} · approximately NPR ${average} per lesson. Full payment upfront, not pay-per-lesson.`;
}

export interface ClassEarningsEstimate {
  totalNpr: number;
  averagePerLessonNpr: number;
}

/**
 * Display-only estimate from the server-published teaching terms. The booking
 * ledger remains the authority for every real allocation and payout.
 */
export function classEarningsEstimate(
  total: number,
  lessons: number,
  teacherShareBps: number,
): ClassEarningsEstimate | null {
  if (
    !Number.isSafeInteger(total) || total < 1 ||
    !Number.isInteger(lessons) || lessons < 1 ||
    !Number.isInteger(teacherShareBps) || teacherShareBps < 1 || teacherShareBps > 10_000
  ) return null;
  const totalNpr = Number(BigInt(total) * BigInt(teacherShareBps) / 10_000n);
  return { totalNpr, averagePerLessonNpr: totalNpr / lessons };
}

export function classPublishSummary(total: number, lessons: number, ongoing: boolean): string[] {
  return [
    `You are publishing ${lessons} ${lessons === 1 ? "lesson" : "lessons"} for NPR ${total.toLocaleString("en-NP")} per student.`,
    ...(ongoing && lessons === 1 ? ["Only 1 lesson is scheduled in this 30-day period. The full price buys that single lesson. Check that this is intentional."] : []),
    "I have checked the class description, every lesson date, duration and the full price per student.",
    "These details are exactly what students will see. Check every date and the total price before publishing.",
    "Once a student books, the promised details are locked. You are responsible for delivering all paid lessons. Changes to booked lessons require the support process, not silent edits.",
    "Publishing does not charge anyone. Simulated checkout creates a test booking only; no real payment is collected.",
  ];
}
