import { PROGRAM_BETA_TEACHER_SHARE_BPS, PROGRAM_BETA_PLATFORM_SHARE_BPS,
  PROGRAM_BETA_COMPLAINT_WINDOW_HOURS } from "./programCommerce.ts";

/** The server freezes the current quote, not a client-supplied amount or commission. */
export function simulatedBatchReceipt(bookingId: number, amountNpr: number, positions: number[]) {
  if (!Number.isSafeInteger(bookingId) || bookingId <= 0 || !positions.length ||
    positions.some((p) => !Number.isSafeInteger(p) || p < 0) || new Set(positions).size !== positions.length) {
    throw new Error("Invalid simulated purchase identity or lesson subset.");
  }
  if (!Number.isSafeInteger(amountNpr) || amountNpr <= 0) throw new Error("Invalid simulated amount.");
  // Batch pricing permits tiny totals; some whole-NPR lesson allocations can be zero.
  // Compute the total split with integers before distributing remainders, never floats.
  const teacherTotal = Number(BigInt(amountNpr) * BigInt(PROGRAM_BETA_TEACHER_SHARE_BPS) / 10000n);
  const share = (total: number, i: number) => Math.floor(total / positions.length) + (i < total % positions.length ? 1 : 0);
  const allocations = positions.map((position, i) => ({
    position, grossNpr: share(amountNpr, i), teacherNpr: share(teacherTotal, i),
    fadkoNpr: share(amountNpr, i) - share(teacherTotal, i), state: "held" as const,
  }));
  return {
    reference: `TEST-BATCH-${bookingId}`, mode: "simulation" as const, event: "simulated_capture" as const,
    currency: "NPR" as const, grossNpr: amountNpr,
    teacherNpr: allocations.reduce((sum, a) => sum + a.teacherNpr, 0),
    fadkoNpr: allocations.reduce((sum, a) => sum + a.fadkoNpr, 0),
    teacherShareBps: PROGRAM_BETA_TEACHER_SHARE_BPS, fadkoShareBps: PROGRAM_BETA_PLATFORM_SHARE_BPS,
    studentFeeNpr: 0, complaintWindowHours: PROGRAM_BETA_COMPLAINT_WINDOW_HOURS,
    actualMoneyCollectedNpr: 0, actualMoneyPaidOutNpr: 0, allocations,
  };
}
export type SimulatedBatchReceipt = ReturnType<typeof simulatedBatchReceipt>;
