import assert from "node:assert/strict";
import test from "node:test";
import { meterFraction, parseBudget, providerBudgetId, usd, visibleSummary, type CostHealthDashboard } from "./costHealth.ts";

test("missing spend is never rendered as zero, while a real zero is visible", () => {
  assert.equal(usd(null), "Not available");
  assert.equal(usd(0), "USD $0.00");
  assert.equal(usd(Number.NaN), "Not available");
});

test("an incomplete dashboard cannot display a combined projection", () => {
  const dashboard = {
    summary: { knownSpendUsd: 8.5, projectedSpendUsd: 24, complete: false, note: "Only two providers reported." },
  } as CostHealthDashboard;
  assert.deepEqual(visibleSummary(dashboard), { known: "USD $8.50", projection: "Not available", detail: "Only two providers reported." });
});

test("a meter without a real limit never invents a filled proportion", () => {
  const meter = { used: 80, limit: null } as Parameters<typeof meterFraction>[0];
  assert.equal(meterFraction(meter), null);
  assert.equal(meterFraction({ ...meter, limit: 100 }), 0.8);
});

test("budget entry is optional and rejects invalid money", () => {
  assert.equal(parseBudget(""), null);
  assert.equal(parseBudget("15"), 15);
  assert.equal(parseBudget("15.25"), 15.25);
  assert.throws(() => parseBudget("0"));
  assert.throws(() => parseBudget("-5"));
  assert.throws(() => parseBudget("15.123"));
});

test("project and product cards use the shared provider alert budget", () => {
  assert.equal(providerBudgetId("neon:staging"), "neon");
  assert.equal(providerBudgetId("cloudflare-workers"), "cloudflare");
  assert.equal(providerBudgetId("railway"), "railway");
});
