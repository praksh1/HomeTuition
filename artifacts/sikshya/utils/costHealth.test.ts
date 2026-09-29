import assert from "node:assert/strict";
import test from "node:test";
import { buildCostHealthHistoryChart, hasCurrentDollarReading, meterFraction, parseBudget, providerBudgetId, usd, visibleSummary, type CostHealthDashboard, type ProviderReading } from "./costHealth.ts";

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

test("a saved dollar target is active only with a current provider cost reading", () => {
  const now = Date.parse("2026-09-29T15:00:00Z");
  const provider = {
    status: "connected", observedAt: "2026-09-29T14:00:00Z",
    cost: { amountUsd: 8.5, periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-10-01T00:00:00Z" },
  } as ProviderReading;
  assert.equal(hasCurrentDollarReading(provider, now), true);
  assert.equal(hasCurrentDollarReading({ ...provider, cost: null }, now), false);
  assert.equal(hasCurrentDollarReading({ ...provider, observedAt: "2026-09-29T12:00:00Z" }, now), false);
  assert.equal(hasCurrentDollarReading({ ...provider, status: "unavailable" }, now), false);
});

const chartNow = Date.parse("2026-09-29T15:00:00Z");
const hour = 3_600_000;
const historyReading = (hoursAgo: number, knownSpendUsd: number | null) => ({
  checkedAt: new Date(chartNow - hoursAgo * hour).toISOString(), knownSpendUsd,
});

test("history ranges include exact boundaries and retain only actual recorded readings", () => {
  const history = [
    historyReading(24 * 30 + 1, 1), historyReading(24 * 30, 2), historyReading(24 * 7, 3),
    historyReading(24, 4), historyReading(0, 5),
  ];
  const original = structuredClone(history);
  for (const [range, amounts] of [
    ["1D", [4, 5]], ["7D", [3, 4, 5]], ["30D", [2, 3, 4, 5]],
  ] as const) {
    const chart = buildCostHealthHistoryChart(history, range, chartNow);
    assert.deepEqual(chart.points.map((point) => point.amountUsd), amounts);
    assert.equal(chart.rangeEnd, chartNow);
    assert.equal(chart.latestPoint?.timestamp, chartNow);
  }
  assert.deepEqual(history, original);
});

test("null-only history stays empty and does not fabricate a zero or trend", () => {
  const chart = buildCostHealthHistoryChart([historyReading(2, null), historyReading(1, null)], "1D", chartNow);
  assert.deepEqual(chart.points, []);
  assert.deepEqual(chart.segments, []);
  assert.equal(chart.latestPoint, null);
  assert.equal(chart.missingCount, 2);
  assert.equal(chart.isStale, true);
  assert.match(chart.limitations.join(" "), /not a total bill or invoice/);
  assert.match(chart.limitations.join(" "), /cannot establish a comparable spending trend/);
  assert.match(chart.limitations.join(" "), /latest 48/);
});

test("a real zero remains a recorded point, and empty history has no latest point", () => {
  const chart = buildCostHealthHistoryChart([historyReading(0, 0)], "1D", chartNow);
  assert.equal(chart.latestPoint?.amountUsd, 0);
  assert.equal(chart.points.length, 1);
  assert.equal(chart.missingCount, 0);
  assert.equal(chart.isStale, false);
  assert.equal(buildCostHealthHistoryChart([], "30D", chartNow).latestPoint, null);
});

test("missing and invalid amounts break chronological groups without becoming zero", () => {
  const chart = buildCostHealthHistoryChart([
    historyReading(8, 1), historyReading(7, null), historyReading(6, 2),
    historyReading(5, Number.NaN), historyReading(4, 3), historyReading(3, Number.POSITIVE_INFINITY),
    historyReading(2, 4), historyReading(1, -1), historyReading(0, 5),
  ], "1D", chartNow);
  assert.deepEqual(chart.points.map((point) => point.amountUsd), [1, 2, 3, 4, 5]);
  assert.deepEqual(chart.segments.map((segment) => segment.length), [1, 1, 1, 1, 1]);
  assert.equal(chart.missingCount, 4);
});

test("history is chronological and excludes invalid dates, future checks, and out-of-range values", () => {
  const chart = buildCostHealthHistoryChart([
    historyReading(-1, 90), historyReading(1, 3), { checkedAt: "not a date", knownSpendUsd: 99 },
    historyReading(3, 1), historyReading(25, 80), historyReading(2, 2), historyReading(-0.001, 100),
  ], "1D", chartNow);
  assert.deepEqual(chart.points.map((point) => point.amountUsd), [1, 2, 3]);
  assert.equal(chart.latestPoint?.timestamp, chartNow - hour);
  assert.equal(chart.isStale, false);
});

test("decreases, long gaps, and month rollovers never share a chronological group", () => {
  const chart = buildCostHealthHistoryChart([
    historyReading(5, 8), historyReading(4, 9), historyReading(3, 2), historyReading(0, 3),
  ], "1D", chartNow);
  assert.deepEqual(chart.segments.map((segment) => segment.map((point) => point.amountUsd)), [[8, 9], [2], [3]]);
  const rollover = buildCostHealthHistoryChart([
    { checkedAt: "2026-08-31T23:30:00Z", knownSpendUsd: 8 },
    { checkedAt: "2026-09-01T00:30:00Z", knownSpendUsd: 9 },
  ], "1D", Date.parse("2026-09-01T01:00:00Z"));
  assert.deepEqual(rollover.segments.map((segment) => segment.length), [1, 1]);
});

test("stale historical amounts remain visible without being labelled current", () => {
  const stale = buildCostHealthHistoryChart([historyReading(2, 5)], "7D", chartNow);
  assert.equal(stale.points.length, 1);
  assert.equal(stale.isStale, true);
  assert.equal(buildCostHealthHistoryChart([historyReading(1.99, 5)], "7D", chartNow).isStale, false);
  assert.equal(buildCostHealthHistoryChart([historyReading(-1, 5)], "7D", chartNow).isStale, true);
});

test("ambiguous same-time checks are isolated instead of forming a vertical change", () => {
  const chart = buildCostHealthHistoryChart([
    historyReading(3, 1), historyReading(2, 2), historyReading(2, 3), historyReading(1, 4), historyReading(0, 5),
  ], "1D", chartNow);
  assert.deepEqual(chart.segments.map((segment) => segment.map((point) => point.amountUsd)), [[1], [2], [3], [4, 5]]);
});
