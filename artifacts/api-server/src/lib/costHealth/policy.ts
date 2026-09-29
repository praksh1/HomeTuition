import type {
  CostHealthSettings,
  CostSnapshot,
  CostWarning,
  ProviderReading,
} from "./types.ts";

export const DEFAULT_SETTINGS: CostHealthSettings = {
  monthlyBudgetUsd: null,
  providerBudgetsUsd: { railway: 15, neon: 15, cloudflare: 15, brevo: 15 },
  emailAlertsEnabled: true,
};
export const REFRESH_MIN_MS = 5 * 60_000;
export function monitorIntervalMinutes(
  value = process.env.COST_HEALTH_INTERVAL_MINUTES,
): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 15 && n <= 1440 ? Math.ceil(n) : 60;
}
export function ownerAllowed(
  userId: number,
  role: string,
  configuredOwner: string | undefined,
  operator: {
    isAdministrator: boolean;
    disabledAt: unknown;
    mustChangePassword: boolean;
  } | null,
): boolean {
  return (
    !!configuredOwner &&
    /^[1-9]\d*$/.test(configuredOwner) &&
    Number(configuredOwner) === userId &&
    role === "admin" &&
    (!operator ||
      (operator.isAdministrator &&
        !operator.disabledAt &&
        !operator.mustChangePassword))
  );
}
export function providerFamily(id: string): string {
  return id.split(/[:-]/)[0];
}
export function validateSettings(raw: unknown): CostHealthSettings | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (
    Object.keys(r).some(
      (k) =>
        ![
          "monthlyBudgetUsd",
          "providerBudgetsUsd",
          "emailAlertsEnabled",
        ].includes(k),
    )
  )
    return null;
  const money = (n: unknown) =>
    typeof n === "number" &&
    Number.isFinite(n) &&
    n >= 0.01 &&
    n <= 100_000 &&
    Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
  if (r.monthlyBudgetUsd !== null && !money(r.monthlyBudgetUsd)) return null;
  if (
    typeof r.emailAlertsEnabled !== "boolean" ||
    !r.providerBudgetsUsd ||
    typeof r.providerBudgetsUsd !== "object" ||
    Array.isArray(r.providerBudgetsUsd)
  )
    return null;
  const budgets = r.providerBudgetsUsd as Record<string, unknown>;
  if (
    Object.keys(budgets).some(
      (k) =>
        ![
          "railway",
          "neon",
          "cloudflare",
          "brevo",
          "livekit",
          "daily",
        ].includes(k) || !money(budgets[k]),
    )
  )
    return null;
  return {
    monthlyBudgetUsd: r.monthlyBudgetUsd as number | null,
    providerBudgetsUsd: Object.fromEntries(
      Object.entries(budgets).map(([k, v]) => [k, v as number]),
    ),
    emailAlertsEnabled: r.emailAlertsEnabled,
  };
}
function validCost(p: ProviderReading, now: number) {
  const c = p.cost;
  return c &&
    p.status !== "unavailable" &&
    p.status !== "not_connected" &&
    p.observedAt &&
    now - Date.parse(p.observedAt) < 2 * 3_600_000 &&
    now >= Date.parse(c.periodStart) &&
    now < Date.parse(c.periodEnd) &&
    Number.isFinite(c.amountUsd) &&
    c.amountUsd >= 0
    ? c
    : null;
}
export function summarize(snapshot: CostSnapshot | null, now = Date.now()) {
  const costs =
    snapshot?.providers
      .map((p) => validCost(p, now))
      .filter((c) => c !== null) ?? [];
  const samePeriod =
    costs.length > 0 &&
    costs.every(
      (c) =>
        c.periodStart === costs[0].periodStart &&
        c.periodEnd === costs[0].periodEnd,
    );
  const complete =
    !!snapshot && costs.length === snapshot.providers.length && samePeriod;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    knownSpendUsd: costs.length
      ? round(costs.reduce((n, c) => n + c.amountUsd, 0))
      : null,
    projectedSpendUsd:
      complete &&
      costs.every(
        (c) =>
          c.projectedUsd !== null &&
          Number.isFinite(c.projectedUsd) &&
          c.projectedUsd >= 0,
      )
        ? round(costs.reduce((n, c) => n + c.projectedUsd!, 0))
        : null,
    complete,
    note: complete
      ? "Provider readings for the same billing period; estimates are not an invoice."
      : "Partial coverage. Known amounts may cover different billing periods; missing providers are not zero. No complete monthly forecast is available.",
  };
}
export function threshold(value: number, limit: number): number | null {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(limit) ||
    limit <= 0 ||
    value < 0
  )
    return null;
  return (
    [100, 95, 85, 70].find((level) => (value / limit) * 100 >= level) ?? null
  );
}
export function warningsFor(
  snapshot: CostSnapshot | null,
  settings: CostHealthSettings,
  now = Date.now(),
): CostWarning[] {
  if (!snapshot)
    return [
      {
        key: "no-reading",
        severity: "attention",
        title: "First check needed",
        detail:
          "Refresh to collect provider readings. Nothing has been assumed to be zero.",
        providerId: null,
      },
    ];
  const warnings: CostWarning[] = [];
  if (now - Date.parse(snapshot.checkedAt) > 2 * 3_600_000)
    warnings.push({
      key: "stale",
      severity: "attention",
      title: "Readings need a refresh",
      detail:
        "The last completed check is more than two hours old. Do not treat these values as current.",
      providerId: null,
    });
  for (const p of snapshot.providers) {
    if (p.status !== "connected")
      warnings.push({
        key:
          p.status === "unavailable"
            ? `provider-failure:${p.id}:${snapshot.checkedAt.slice(0, 10)}`
            : `coverage:${p.id}`,
        severity: "attention",
        title: `${p.name}: ${p.status === "partial" ? "partial coverage" : p.status === "not_connected" ? "not connected" : "usage check unavailable"}`,
        detail: p.note,
        providerId: p.id,
      });
    if (
      p.status === "unavailable" ||
      p.status === "not_connected" ||
      !p.observedAt ||
      now - Date.parse(p.observedAt) > 2 * 3_600_000
    )
      continue;
    for (const meter of p.meters) {
      if (
        now < Date.parse(meter.periodStart) ||
        now >= Date.parse(meter.periodEnd) ||
        meter.limit === null
      )
        continue;
      const level = threshold(meter.used, meter.limit);
      if (level !== null)
        warnings.push({
          key: `quota:${p.id}:${meter.id}:${meter.periodStart}:${level}`,
          severity: level >= 95 ? "critical" : "attention",
          title: `${p.name}: ${level}% allowance warning`,
          detail: `${meter.label}: ${meter.used.toLocaleString("en-US")} of ${meter.limit.toLocaleString("en-US")} ${meter.unit}. Check the provider before its allowance runs out.`,
          providerId: p.id,
        });
    }
  }
  for (const [family, budget] of Object.entries(settings.providerBudgetsUsd)) {
    const readings = snapshot.providers.filter(
      (p) => providerFamily(p.id) === family,
    );
    // Group per real billing period, never add projects with different renewal dates.
    const periods = new Map<
      string,
      { amount: number; projection: number | null; count: number }
    >();
    for (const p of readings) {
      const c = validCost(p, now);
      if (!c) continue;
      const key = `${c.periodStart}:${c.periodEnd}`;
      const group = periods.get(key) ?? { amount: 0, projection: 0, count: 0 };
      group.amount += c.amountUsd;
      group.count++;
      group.projection =
        group.projection !== null &&
        c.projectedUsd !== null &&
        Number.isFinite(c.projectedUsd) &&
        c.projectedUsd >= 0
          ? group.projection + c.projectedUsd
          : null;
      periods.set(key, group);
    }
    for (const [period, g] of periods) {
      const level = threshold(g.amount, budget);
      if (level !== null)
        warnings.push({
          key: `budget:${family}:${period}:${level}`,
          severity: level >= 95 ? "critical" : "attention",
          title: `${family}: ${level}% budget warning`,
          detail: `Known usage is $${g.amount.toFixed(2)} against your $${budget.toFixed(2)} alert budget. This is not a provider spending cap.`,
          providerId: family,
        });
      if (g.projection !== null && g.projection > budget)
        warnings.push({
          key: `forecast:${family}:${period}`,
          severity: "attention",
          title: `${family}: forecast above budget`,
          detail: `Estimated forecast is $${g.projection.toFixed(2)} versus your $${budget.toFixed(2)} budget${g.count < readings.length ? "; coverage is incomplete" : ""}. Estimates can change.`,
          providerId: family,
        });
    }
  }
  const summary = summarize(snapshot, now);
  if (
    settings.monthlyBudgetUsd !== null &&
    summary.complete &&
    summary.knownSpendUsd !== null
  ) {
    const level = threshold(summary.knownSpendUsd, settings.monthlyBudgetUsd);
    if (level !== null)
      warnings.push({
        key: `total:${snapshot.providers[0]?.cost?.periodStart}:${level}`,
        severity: level >= 95 ? "critical" : "attention",
        title: `Total budget: ${level}% warning`,
        detail: `$${summary.knownSpendUsd.toFixed(2)} of $${settings.monthlyBudgetUsd.toFixed(2)}. Alerts do not stop spending.`,
        providerId: null,
      });
  }
  for (const h of snapshot.health)
    if (h.status !== "healthy")
      warnings.push({
        key: `health:${h.id}:${h.checkedAt.slice(0, 10)}`,
        severity: "critical",
        title: `${h.name}: check failed`,
        detail: h.note,
        providerId: null,
      });
  return warnings;
}
/** Setup gaps stay on the page; do not email the same incomplete-integration notice hourly. */
export function emailWorthy(w: CostWarning): boolean {
  return /^(quota|budget|forecast|total|health|provider-failure):/.test(w.key);
}
