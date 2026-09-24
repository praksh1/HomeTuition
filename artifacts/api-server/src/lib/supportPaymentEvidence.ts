/** Read-only explanation of Fadko records. Never a provider reconciliation or refund decision. */
export interface SupportPaymentInput {
  enrollmentId: number; status: string; method: string | null; reference: string | null;
  batch?: { bookingId: number; position: number; receipt: unknown };
  refunds: { id: number; amount: number; status: string; requestedAt: Date; paidAt: Date | null }[];
}
export function explainSupportPayment(input: SupportPaymentInput): string[] {
  const simulated = input.status === "test" || /^SIM-|^TEST-/.test(input.reference ?? "");
  const facts = [simulated
    ? `Enrollment #${input.enrollmentId}: test/simulated booking; this is not a real-money charge.`
    : `Enrollment #${input.enrollmentId}: Fadko records status “${input.status}”; ${input.reference ? "a payment reference is stored" : "no payment reference is stored"}. Provider settlement has not been independently checked.`];
  // Do not return payment references, arbitrary method text, platform shares or operator notes.
  if (["esewa", "khalti"].includes(input.method ?? "")) facts.push(`Recorded payment method: ${input.method}. Any approved refund follows the original payment method; contact support if it has changed.`);
  if (input.batch) {
    const receipt = input.batch.receipt as { mode?: unknown; currency?: unknown; grossNpr?: unknown; actualMoneyCollectedNpr?: unknown; allocations?: { position?: unknown; grossNpr?: unknown }[] } | null;
    const allocation = Array.isArray(receipt?.allocations) ? receipt.allocations.find((part) => part?.position === input.batch!.position) : undefined;
    const validAmount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    if (receipt?.mode === "simulation" && receipt.currency === "NPR" && receipt.actualMoneyCollectedNpr === 0 && validAmount(receipt.grossNpr) && validAmount(allocation?.grossNpr)) {
      facts.push(`Test receipt for booking #${input.batch.bookingId}: NPR ${receipt.grossNpr.toLocaleString("en-US")} simulated course total; NPR ${allocation.grossNpr.toLocaleString("en-US")} allocated to this lesson. Actual money collected: NPR 0. These are not separate charges.`);
    } else facts.push(`Booking #${input.batch.bookingId}: the test receipt could not be safely matched to this lesson. A person should check the original record; no amount has been inferred.`);
  }
  if (!input.refunds.length) facts.push("No refund row was found for your account and this lesson. This does not prove that no request or provider refund exists elsewhere.");
  else {
    for (const row of input.refunds.slice(0, 5)) facts.push(
      `Refund record #${row.id}: NPR ${row.amount.toLocaleString("en-US")}, ${simulated ? "linked to a test/simulated enrollment; not proof of real money returned" : row.status === "paid" ? "marked paid in Fadko; not independently confirmed with the provider" : row.status === "owed" ? "recorded as owed, not paid" : "state requires human review"}. Recorded ${row.requestedAt.toISOString()}${row.paidAt ? `; marked paid ${row.paidAt.toISOString()}` : ""}.`,
    );
    if (input.refunds.length > 5) facts.push("Showing the five latest refund records for this lesson; older records need a full review.");
  }
  return facts;
}
