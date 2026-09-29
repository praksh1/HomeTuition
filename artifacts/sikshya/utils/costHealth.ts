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
