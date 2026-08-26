/**
 * Turning time spent in classes into a bill, in both units a provider charges in.
 *
 * ### Why this file imports nothing
 *
 * The unit tests run under `node --test --experimental-strip-types`, which cannot resolve this
 * project's extensionless workspace imports — a file that reaches for `@workspace/db` cannot be
 * loaded by the test runner at all. So the arithmetic lives here with no imports, and the
 * database query that feeds it lives next door in `videoUsage.ts`. The same split as
 * `tickets.ts` and `operators.ts`, for the same reason.
 */

/** The month a date falls in, as a half-open window: from the 1st, up to but not the next 1st. */
export function monthWindow(when: Date): { from: Date; to: Date } {
  const from = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), 1));
  const to = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth() + 1, 1));
  return { from, to };
}

/**
 * What a managed provider would charge, at a rate you supply.
 *
 * The rate is a parameter and not a constant on purpose. Vendor pricing changes and tiers
 * differ; a number baked in here would go stale quietly and then be trusted. Read your own
 * invoice, pass the rate, get an answer you can check.
 */
export function costAt(participantMinutes: number, ratePerParticipantMinute: number): number {
  return participantMinutes * ratePerParticipantMinute;
}

/**
 * Roughly how many gigabytes an SFU moves for that many participant-minutes.
 *
 * The other half of the comparison: a managed provider bills per minute, a self-hosted one bills
 * per gigabyte of egress, and choosing between them is this conversion.
 *
 * Deliberately crude, and an assumption rather than a fact: one video stream at `kbps` reaching
 * each participant. A class with every camera off costs a fraction of this; one with every
 * camera on costs more. Pass the number you actually observe.
 */
export function egressGbAt(participantMinutes: number, kbps = 1500): number {
  const bits = participantMinutes * 60 * kbps * 1000;
  return Math.round((bits / 8 / 1_000_000_000) * 100) / 100;
}
