/**
 * Presentation-only helpers for the teacher's create-session allowance.
 *
 * The server remains the authority. These helpers only turn its response into honest words and
 * safely retain the useful details attached to a 402 response.
 */
export interface SessionAllowanceSummary {
  tier: string;
  tierName: string;
  limit: number;
  used: number;
  remaining: number;
  price: number;
  testAccess?: { validUntil: string; reason: string };
}

export interface SessionLimitDetails {
  message: string;
  freesAt: string | null;
  upgradeTo: string | null;
}

export function allowancePresentation(summary: SessionAllowanceSummary): {
  heading: string;
  usage: string;
  billing: string;
  isFullAtBusiestPoint: boolean;
} {
  const classWord = summary.limit === 1 ? "class" : "classes";
  const usage = summary.remaining > 0
    ? `${summary.remaining} of ${summary.limit} ${classWord} remain in your busiest 30-day period.`
    : `Your busiest 30-day period already contains all ${summary.limit} ${classWord}. A different date may still fit.`;

  return {
    heading: summary.testAccess ? `${summary.tierName} test allowance` : `${summary.tierName} teaching plan`,
    usage,
    billing: summary.testAccess
      ? "Temporary test access — no plan payment was processed."
      : `NPR ${summary.price.toLocaleString("en-US")} per 30 days`,
    isFullAtBusiestPoint: summary.remaining === 0,
  };
}

export function limitDetailsFromResponse(
  message: string,
  response: Record<string, unknown>,
): SessionLimitDetails {
  const raw = response.allowance;
  const allowance = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    message,
    freesAt: typeof allowance.freesAt === "string" ? allowance.freesAt : null,
    upgradeTo: typeof allowance.upgradeTo === "string" ? allowance.upgradeTo : null,
  };
}
