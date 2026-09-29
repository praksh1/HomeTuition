/** Browser-safe mirror of the owner dashboard response. The API remains authoritative. */
export type Meter = {
  id: string; label: string; used: number; limit: number | null; unit: string;
  periodStart: string; periodEnd: string; source: "provider" | "manual";
};
export type ProviderReading = {
  id: string; name: string; scope: string;
  status: "connected" | "partial" | "not_connected" | "unavailable";
  checkedAt: string; observedAt: string | null;
  dashboardUrl: string; note: string; setup: string[];
  meters: Meter[];
  cost: null | {
    amountUsd: number; projectedUsd: number | null; periodStart: string; periodEnd: string;
    basis: "provider_estimate" | "measured" | "manual"; note: string;
  };
};
export type HealthCheck = {
  id: string; name: string; status: "healthy" | "degraded" | "unavailable";
  checkedAt: string; latencyMs: number | null; note: string;
};
export type CostHealthSettings = {
  monthlyBudgetUsd: number | null;
  providerBudgetsUsd: Record<string, number>;
  emailAlertsEnabled: boolean;
};
export type CostWarning = {
  key: string; severity: "attention" | "critical"; title: string; detail: string;
  providerId: string | null;
};
export type CostSnapshot = {
  checkedAt: string; providers: ProviderReading[]; health: HealthCheck[];
};
export type CostHealthDashboard = {
  settings: CostHealthSettings; snapshot: CostSnapshot | null;
  warnings: CostWarning[];
  summary: { knownSpendUsd: number | null; projectedSpendUsd: number | null; complete: boolean; note: string };
  monitoring: {
    enabled: boolean; intervalMinutes: number; lastAttemptAt: string | null;
    lastSuccessAt: string | null; nextCheckAt: string | null; refreshing: boolean;
    emailConfigured: boolean; alertRecipient: string | null;
    lastEmailAt: string | null; lastEmailStatus: "accepted" | "failed" | null;
    limitation: string;
  };
  history: { checkedAt: string; knownSpendUsd: number | null }[];
};

export const BUDGET_PROVIDERS = [
  { id: "railway", name: "Railway" },
  { id: "neon", name: "Neon" },
  { id: "cloudflare", name: "Cloudflare" },
  { id: "brevo", name: "Brevo" },
] as const;

/** Neon projects and Cloudflare products share their provider's alert threshold. */
export function providerBudgetId(readingId: string): string {
  return readingId.split(/[:-]/, 1)[0];
}

/** Match the API's eligibility rule before calling a dollar target active. */
export function hasCurrentDollarReading(provider: ProviderReading, now = Date.now()): boolean {
  const cost = provider.cost;
  const observed = provider.observedAt ? Date.parse(provider.observedAt) : Number.NaN;
  return cost !== null && provider.status !== "unavailable" && provider.status !== "not_connected" &&
    Number.isFinite(observed) && now - observed < 2 * 3_600_000 &&
    now >= Date.parse(cost.periodStart) && now < Date.parse(cost.periodEnd) &&
    Number.isFinite(cost.amountUsd) && cost.amountUsd >= 0;
}

export function usd(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "Not available"
    : `USD $${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function measuredAt(value: string | null | undefined): string {
  if (!value) return "No reading yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString();
}

export function periodLabel(start: string, end: string): string {
  const first = new Date(start);
  const last = new Date(end);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return "Period unavailable";
  return `${first.toLocaleDateString()}–${last.toLocaleDateString()}`;
}

export function meterFraction(meter: Meter): number | null {
  if (!Number.isFinite(meter.used) || meter.limit === null || !Number.isFinite(meter.limit) || meter.limit <= 0) return null;
  return Math.min(1, Math.max(0, meter.used / meter.limit));
}

export function budgetDraft(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Empty is intentionally unset, never a zero-dollar cap or a guessed default. */
export function parseBudget(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("Enter a positive USD amount with up to two decimal places, or leave it blank.");
  return value;
}

export function visibleSummary(dashboard: CostHealthDashboard): { known: string; projection: string; detail: string } {
  const known = usd(dashboard.summary.knownSpendUsd);
  const projection = dashboard.summary.complete ? usd(dashboard.summary.projectedSpendUsd) : "Not available";
  return { known, projection, detail: dashboard.summary.note };
}

export type CostHealthHistoryRange = "1D" | "7D" | "30D";
export type CostHealthHistoryPoint = {
  checkedAt: string;
  timestamp: number;
  amountUsd: number;
};
export type CostHealthHistoryChart = {
  rangeStart: number;
  rangeEnd: number;
  points: CostHealthHistoryPoint[];
  /** Chronological groups only: provider coverage is not known to be comparable. */
  segments: CostHealthHistoryPoint[][];
  latestPoint: CostHealthHistoryPoint | null;
  /** Age of the latest plotted check, not proof that its provider data is current. */
  isStale: boolean;
  /** Checks in the selected range that have no valid dollar amount. */
  missingCount: number;
  limitations: string[];
};

const HISTORY_RANGE_DAYS: Record<CostHealthHistoryRange, number> = { "1D": 1, "7D": 7, "30D": 30 };
const HISTORY_STALE_MS = 2 * 3_600_000;

/**
 * Plot only reported usage. The API stores neither provider membership nor billing
 * periods for historical aggregates, so even adjacent amounts cannot establish a
 * spend trend. Render markers, not a connected line or a percentage change.
 */
export function buildCostHealthHistoryChart(
  history: Readonly<CostHealthDashboard["history"]>,
  range: CostHealthHistoryRange,
  now = Date.now(),
): CostHealthHistoryChart {
  const rangeStart = now - HISTORY_RANGE_DAYS[range] * 24 * 3_600_000;
  const readings = history
    .map((reading) => ({ ...reading, timestamp: Date.parse(reading.checkedAt) }))
    .filter((reading) => Number.isFinite(reading.timestamp) && reading.timestamp >= rangeStart && reading.timestamp <= now)
    .sort((a, b) => a.timestamp - b.timestamp);
  const points: CostHealthHistoryPoint[] = [];
  const segments: CostHealthHistoryPoint[][] = [];
  let segment: CostHealthHistoryPoint[] = [];
  let missingCount = 0;

  for (let index = 0; index < readings.length; index += 1) {
    const reading = readings[index];
    const amount = reading.knownSpendUsd;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      missingCount += 1;
      segment = [];
      continue;
    }
    const point = { checkedAt: reading.checkedAt, timestamp: reading.timestamp, amountUsd: amount };
    const previous = segment[segment.length - 1];
    // Isolate ambiguous same-time checks and reset boundaries. Billing periods are
    // unavailable, so a calendar boundary is deliberately conservative too.
    const sameTime = readings[index - 1]?.timestamp === point.timestamp || readings[index + 1]?.timestamp === point.timestamp;
    const previousSameTime = previous && readings[index - 2]?.timestamp === previous.timestamp;
    if (previous && (
      sameTime || previousSameTime || point.timestamp - previous.timestamp >= HISTORY_STALE_MS ||
      point.amountUsd < previous.amountUsd ||
      new Date(point.timestamp).getUTCMonth() !== new Date(previous.timestamp).getUTCMonth()
    )) segment = [];
    if (segment.length === 0) segments.push(segment);
    segment.push(point);
    points.push(point);
  }

  const latestPoint = points[points.length - 1] ?? null;
  return {
    rangeStart,
    rangeEnd: now,
    points,
    segments,
    latestPoint,
    isStale: latestPoint === null || now - latestPoint.timestamp >= HISTORY_STALE_MS,
    missingCount,
    limitations: [
      "Reported usage only; these amounts are not a total bill or invoice.",
      "History does not identify the providers or billing periods behind each amount. Readings cannot establish a comparable spending trend.",
      "Ranges filter the latest 48 stored checks available from the server; they may not cover the full selected period. Missing readings are not zero.",
    ],
  };
}
