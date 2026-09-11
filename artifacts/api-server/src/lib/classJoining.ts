import type { ProgramBatchSnapshot } from "./programBatches.ts";

/** Preview only: this is not a reservation, payment authorization or attendance finding. */
export function classJoiningPreview(snapshot: ProgramBatchSnapshot, nowMs: number) {
  if (!Number.isFinite(nowMs)) throw new Error("A server time is required.");
  const remaining = snapshot.lessons.filter((lesson) => Date.parse(lesson.startsAt) > nowMs);
  const started = nowMs >= Date.parse(snapshot.tuitionPeriod?.startsAt ?? snapshot.lessons[0]!.startsAt);
  const late = started && snapshot.allowLateJoining === true && !!snapshot.tuitionPeriod;
  const available = remaining.length > 0 && (!started || late);
  // Round once to nearest whole NPR, half up. BigInt avoids overflow at the safe-integer limit.
  const numerator = BigInt(snapshot.totalTuitionNpr) * BigInt(remaining.length);
  const denominator = BigInt(snapshot.lessons.length);
  const amount = Number((2n * numerator + denominator) / (2n * denominator));
  return {
    previewOnly: true as const,
    calculatedAt: new Date(nowMs).toISOString(),
    status: !available ? "closed" as const : late ? "remaining_lessons" as const : "full_offer" as const,
    totalLessonCount: snapshot.lessons.length,
    remainingLessonCount: available ? remaining.length : 0,
    // "Started", not "completed": a schedule alone is not delivery evidence.
    startedLessonCount: snapshot.lessons.length - remaining.length,
    amountNpr: available && amount >= 1 ? amount : null,
    lessonPositions: available ? remaining.map((lesson) => lesson.position) : [],
    validBefore: available ? remaining[0]!.startsAt : null,
    periodEndsAt: snapshot.tuitionPeriod?.endsAt ?? null,
  };
}
