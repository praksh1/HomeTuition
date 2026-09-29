import { randomUUID } from "node:crypto";
import { sendEmail, isEmailConfigured } from "../mailer";
import { logger } from "../logger";
import { collectProviderReadings } from "./providers";
import { collectHealthChecks } from "./health";
import {
  claimAlert,
  claimTestEmail,
  claimCheck,
  completeCheck,
  finishAlert,
  getCostHistory,
  getCostState,
  releaseCheck,
} from "./store";
import {
  emailWorthy,
  monitorIntervalMinutes,
  REFRESH_MIN_MS,
  summarize,
  warningsFor,
} from "./policy";
import type { CostHealthDashboard, CostSnapshot } from "./types";

export function alertRecipient(): string | null {
  const value = process.env.COST_HEALTH_ALERT_EMAIL?.trim();
  return value &&
    value.length <= 254 &&
    /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value)
    ? value
    : null;
}
export function monitoringEnabled() {
  return process.env.COST_HEALTH_ENABLED === "true";
}
export async function costDashboard(): Promise<CostHealthDashboard> {
  const state = await getCostState();
  const intervalMinutes = monitorIntervalMinutes();
  return {
    settings: state.settings,
    snapshot: state.snapshot,
    warnings: warningsFor(state.snapshot, state.settings),
    summary: summarize(state.snapshot),
    monitoring: {
      enabled: monitoringEnabled(),
      intervalMinutes,
      lastAttemptAt: state.lastAttemptAt,
      lastSuccessAt: state.lastSuccessAt,
      nextCheckAt:
        monitoringEnabled() && state.lastAttemptAt
          ? new Date(
              Date.parse(state.lastAttemptAt) + intervalMinutes * 60_000,
            ).toISOString()
          : null,
      refreshing: state.refreshing,
      emailConfigured: !!alertRecipient() && isEmailConfigured(),
      alertRecipient: alertRecipient(),
      lastEmailAt: state.lastEmailAt,
      lastEmailStatus: state.lastEmailStatus,
      limitation:
        "Checks run while this API is online. They cannot alert you if this monitor itself is down. Keep provider emails and an independent uptime monitor enabled. Billing is delayed by each provider; refreshing cannot make it instantaneous.",
    },
    history: await getCostHistory(),
  };
}
export async function sendCostWarnings(snapshot: CostSnapshot) {
  const state = await getCostState();
  const to = alertRecipient();
  if (!state.settings.emailAlertsEnabled || !to || !isEmailConfigured()) return;
  const warnings = warningsFor(snapshot, state.settings).filter(emailWorthy);
  // At most one digest for this check, with durable per-warning deduplication across replicas.
  const claimed = [];
  for (const warning of warnings)
    if (await claimAlert(warning.key)) claimed.push(warning);
  if (!claimed.length) return;
  const text = [
    "Fadko Cost & Health",
    "",
    ...claimed.map((w) => `${w.title}\n${w.detail}\n`),
    "These are alerts, not spending caps. No upgrade or shutdown was performed.",
    `Checked at ${snapshot.checkedAt}. Provider figures may lag billing.`,
    "Open your private Fadko Cost & Health page for connection gaps, periods and provider links.",
  ].join("\n");
  const accepted = await sendEmail({
    to,
    subject: `Fadko: ${claimed.length} cost or health warning${claimed.length === 1 ? "" : "s"}`,
    text,
  });
  for (const warning of claimed) await finishAlert(warning.key, accepted);
}
export async function refreshCosts(manual = false): Promise<boolean> {
  const leaseId = randomUUID();
  if (
    !(await claimCheck(
      leaseId,
      manual ? REFRESH_MIN_MS : monitorIntervalMinutes() * 60_000,
    ))
  )
    return false;
  try {
    const [providers, health] = await Promise.all([
      collectProviderReadings(),
      collectHealthChecks(),
    ]);
    const snapshot: CostSnapshot = {
      checkedAt: new Date().toISOString(),
      providers,
      health,
    };
    if (
      await completeCheck(leaseId, snapshot, summarize(snapshot).knownSpendUsd)
    )
      await sendCostWarnings(snapshot);
    return true;
  } finally {
    await releaseCheck(leaseId);
  }
}
export async function sendCostTestEmail(): Promise<
  "accepted" | "failed" | "not_configured" | "rate_limited"
> {
  const to = alertRecipient();
  if (!to || !isEmailConfigured()) return "not_configured";
  await getCostState();
  const key = "test-email";
  if (!(await claimTestEmail())) return "rate_limited";
  const accepted = await sendEmail({
    to,
    subject: "Fadko Cost & Health — test email",
    text: "This is your requested Cost & Health test. Email submission is connected. Provider acceptance is not a guarantee of inbox delivery. This test does not mean every usage provider is connected, does not change a plan, and cannot stop charges. Check the private page for coverage and budgets.",
  });
  await finishAlert(key, accepted);
  return accepted ? "accepted" : "failed";
}
/** Hourly by default. A cost monitor must not keep a Free Neon compute awake by polling it every minute. */
export function startCostHealthScheduler(): () => void {
  if (!monitoringEnabled()) return () => {};
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    try {
      await refreshCosts();
    } catch {
      logger.warn(
        "Owner cost monitoring check failed; keep independent provider alerts enabled",
      );
    } finally {
      if (!stopped) {
        timer = setTimeout(
          () => void tick(),
          monitorIntervalMinutes() * 60_000,
        );
        timer.unref();
      }
    }
  };
  timer = setTimeout(() => void tick(), 30_000);
  timer.unref();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
