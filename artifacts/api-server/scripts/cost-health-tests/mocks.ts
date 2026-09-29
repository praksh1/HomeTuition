import type { CostSnapshot, ProviderReading, HealthCheck } from "../../src/lib/costHealth/types";

// Only outbound services and nonessential logging are replaced. HTTP auth,
// operator lookups, policy, owner route, and PostgreSQL stores remain real.
export const sent: Array<{ to: string; subject: string; text: string }> = [];
export let providerCalls = 0;
export let healthCalls = 0;
export let acceptEmail = true;
export let degradedHealth = false;
export function resetMocks() {
  sent.length = 0;
  providerCalls = 0;
  healthCalls = 0;
  acceptEmail = true;
  degradedHealth = false;
}
export function setEmailAcceptance(value: boolean) { acceptEmail = value; }
export function setDegradedHealth(value: boolean) { degradedHealth = value; }

export async function collectProviderReadings(): Promise<ProviderReading[]> {
  providerCalls++;
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  return [{ id: "railway", name: "Railway", scope: "synthetic workspace", status: "connected",
    checkedAt: now.toISOString(), observedAt: now.toISOString(), dashboardUrl: "https://railway.com/account/billing",
    note: "Synthetic provider reading", setup: [], meters: [{ id: "usage", label: "Synthetic resource spend",
      used: 12, limit: 15, unit: "USD", periodStart: start, periodEnd: end, source: "provider" }],
    cost: { amountUsd: 12, projectedUsd: 18, periodStart: start, periodEnd: end,
      basis: "measured", note: "Synthetic amount, not an invoice" } }];
}
export async function collectHealthChecks(): Promise<HealthCheck[]> {
  healthCalls++;
  return [{ id: "synthetic-api", name: "Synthetic API", status: degradedHealth ? "degraded" : "healthy",
    checkedAt: new Date().toISOString(), latencyMs: 1, note: degradedHealth ? "Synthetic failure" : "Synthetic response" }];
}
export function isEmailConfigured() { return true; }
export async function sendEmail(message: { to: string; subject: string; text: string }): Promise<boolean> {
  sent.push(message);
  return acceptEmail;
}
export const logger = { warn() {} };
export function recordActivity() {}
