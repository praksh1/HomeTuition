/** Public owner-only response types. Never include provider credentials or raw API errors. */
export type Meter = {
  id: string;
  label: string;
  used: number;
  limit: number | null;
  unit: string;
  periodStart: string;
  periodEnd: string;
  source: "provider" | "manual";
};
export type ProviderReading = {
  id: string;
  name: string;
  scope: string;
  status: "connected" | "partial" | "not_connected" | "unavailable";
  checkedAt: string;
  observedAt: string | null;
  dashboardUrl: string;
  note: string;
  setup: string[];
  meters: Meter[];
  cost: null | {
    amountUsd: number;
    projectedUsd: number | null;
    periodStart: string;
    periodEnd: string;
    basis: "provider_estimate" | "measured" | "manual";
    note: string;
  };
};
export type HealthCheck = {
  id: string;
  name: string;
  status: "healthy" | "degraded" | "unavailable";
  checkedAt: string;
  latencyMs: number | null;
  note: string;
};
export type CostHealthSettings = {
  monthlyBudgetUsd: number | null;
  providerBudgetsUsd: Record<string, number>;
  emailAlertsEnabled: boolean;
};
export type CostWarning = {
  key: string;
  severity: "attention" | "critical";
  title: string;
  detail: string;
  providerId: string | null;
};
export type CostSnapshot = {
  checkedAt: string;
  providers: ProviderReading[];
  health: HealthCheck[];
};
export type CostHealthDashboard = {
  settings: CostHealthSettings;
  snapshot: CostSnapshot | null;
  warnings: CostWarning[];
  summary: {
    knownSpendUsd: number | null;
    projectedSpendUsd: number | null;
    complete: boolean;
    note: string;
  };
  monitoring: {
    enabled: boolean;
    intervalMinutes: number;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    nextCheckAt: string | null;
    refreshing: boolean;
    emailConfigured: boolean;
    alertRecipient: string | null;
    lastEmailAt: string | null;
    lastEmailStatus: "accepted" | "failed" | null;
    limitation: string;
  };
  history: { checkedAt: string; knownSpendUsd: number | null }[];
};
