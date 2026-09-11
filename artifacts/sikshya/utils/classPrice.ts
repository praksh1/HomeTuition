/** Display-only average. Payment amounts must come from the server, never this helper. */
export function classPriceBreakdown(total: number, lessons: number): string {
  if (!Number.isSafeInteger(total) || total < 1 || !Number.isInteger(lessons) || lessons < 1)
    return "Choose lesson dates and a full price to see the breakdown.";
  const average = (total / lessons).toLocaleString("en-NP", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Includes ${lessons} live ${lessons === 1 ? "lesson" : "lessons"} · approximately NPR ${average} per lesson. Full payment upfront, not pay-per-lesson.`;
}

export function classPublishSummary(total: number, lessons: number, ongoing: boolean): string[] {
  return [
    `You are publishing ${lessons} ${lessons === 1 ? "lesson" : "lessons"} for NPR ${total.toLocaleString("en-NP")} per student.`,
    ...(ongoing && lessons === 1 ? ["Only 1 lesson is scheduled in this 30-day period. The full price buys that single lesson. Check that this is intentional."] : []),
    "I have checked the class description, every lesson date, duration and the full price per student.",
    "This publishes a listing only. Joining and payment remain unavailable.",
  ];
}
