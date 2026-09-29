import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  ownerAllowed,
  validateSettings,
  monitorIntervalMinutes,
  summarize,
  warningsFor,
  threshold,
  emailWorthy,
} from "./policy.ts";
import type { CostSnapshot, ProviderReading } from "./types.ts";
const now = Date.parse("2026-09-20T12:00:00Z");
const start = "2026-09-01T00:00:00Z",
  end = "2026-10-01T00:00:00Z";
const p = (patch: Partial<ProviderReading> = {}): ProviderReading => ({
  id: "railway",
  name: "Railway",
  scope: "workspace",
  status: "connected",
  checkedAt: new Date(now).toISOString(),
  observedAt: new Date(now).toISOString(),
  dashboardUrl: "https://railway.com/dashboard",
  note: "Delayed",
  setup: [],
  meters: [],
  cost: {
    amountUsd: 12,
    projectedUsd: 18,
    periodStart: start,
    periodEnd: end,
    basis: "provider_estimate",
    note: "Not final invoice",
  },
  ...patch,
});
const snapshot = (providers: ProviderReading[]): CostSnapshot => ({
  checkedAt: new Date(now).toISOString(),
  providers,
  health: [],
});
test("only configured current owner admitted, not ordinary staff or expired operator", () => {
  const op = {
    isAdministrator: true,
    disabledAt: null,
    mustChangePassword: false,
  };
  assert.ok(ownerAllowed(7, "admin", "7", op));
  assert.ok(ownerAllowed(7, "admin", "7", null)); // verified legacy owner account
  for (const role of ["student", "teacher"])
    assert.equal(ownerAllowed(7, role, "7", op), false);
  for (const setting of [undefined, "", "0", "7,8", "07", "8", "NaN"])
    assert.equal(ownerAllowed(7, "admin", setting, op), false);
  assert.equal(ownerAllowed(8, "admin", "7", op), false);
  assert.equal(
    ownerAllowed(7, "admin", "7", { ...op, isAdministrator: false }),
    false,
  );
  assert.equal(
    ownerAllowed(7, "admin", "7", { ...op, disabledAt: new Date() }),
    false,
  );
  assert.equal(
    ownerAllowed(7, "admin", "7", { ...op, mustChangePassword: true }),
    false,
  );
});
test("settings accept only bounded money and known providers; no secret or recipient mutation", () => {
  assert.deepEqual(validateSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  for (const invalid of [NaN, Infinity, -1, 0, 1.001, 100001, "15"])
    assert.equal(
      validateSettings({ ...DEFAULT_SETTINGS, monthlyBudgetUsd: invalid }),
      null,
    );
  for (const invalid of [null, [], "test"])
    assert.equal(
      validateSettings({ ...DEFAULT_SETTINGS, providerBudgetsUsd: invalid }),
      null,
    );
  assert.equal(
    validateSettings({
      ...DEFAULT_SETTINGS,
      recipient: "attacker@example.com",
    }),
    null,
  );
  assert.equal(
    validateSettings({
      ...DEFAULT_SETTINGS,
      providerBudgetsUsd: { unknown: 15 },
    }),
    null,
  );
  assert.equal(
    validateSettings({ ...DEFAULT_SETTINGS, emailAlertsEnabled: "true" }),
    null,
  );
});
test("background cadence conserves Neon; invalid values cannot turn polling into busy loop", () => {
  assert.equal(monitorIntervalMinutes(""), 60);
  assert.equal(monitorIntervalMinutes("1"), 60);
  assert.equal(monitorIntervalMinutes("15"), 15);
  assert.equal(monitorIntervalMinutes("1440"), 1440);
  assert.equal(monitorIntervalMinutes("999999"), 60);
});
test("missing usage and disconnected costs are not fabricated zeros", () => {
  assert.equal(summarize(null, now).knownSpendUsd, null);
  assert.equal(
    summarize(snapshot([p({ cost: null })]), now).knownSpendUsd,
    null,
  );
  assert.equal(
    summarize(snapshot([p({ status: "unavailable" })]), now).knownSpendUsd,
    null,
  );
  const s = summarize(snapshot([p(), p({ id: "brevo", cost: null })]), now);
  assert.equal(s.knownSpendUsd, 12);
  assert.equal(s.projectedSpendUsd, null);
  assert.equal(s.complete, false);
});
test("stale, future and expired billing readings are not current spend", () => {
  for (const n of [
    Date.parse("2026-10-02"),
    Date.parse("2026-08-01"),
    now + 3 * 3_600_000,
  ])
    assert.equal(summarize(snapshot([p()]), n).knownSpendUsd, null);
});
test("total projection requires complete, same-period coverage", () => {
  assert.equal(
    summarize(snapshot([p(), p({ id: "brevo" })]), now).projectedSpendUsd,
    36,
  );
  assert.equal(
    summarize(
      snapshot([
        p(),
        p({
          id: "brevo",
          cost: { ...p().cost!, periodStart: "2026-09-05T00:00:00Z" },
        }),
      ]),
      now,
    ).projectedSpendUsd,
    null,
  );
});
test("quota thresholds are exact and cycle-scoped, with expired meter excluded", () => {
  assert.equal(threshold(80.1, 100), 70);
  assert.equal(threshold(95, 100), 95);
  assert.equal(threshold(100, 100), 100);
  assert.equal(threshold(7, 0), null);
  const item = p({
    id: "neon:test",
    name: "Neon",
    cost: null,
    meters: [
      {
        id: "compute",
        label: "Compute",
        used: 80.1,
        limit: 100,
        unit: "CU-hours",
        periodStart: start,
        periodEnd: end,
        source: "provider",
      },
    ],
  });
  const warning = warningsFor(snapshot([item]), DEFAULT_SETTINGS, now).find(
    (w) => w.key.startsWith("quota:"),
  )!;
  assert.ok(warning.key.includes(start));
  assert.ok(warning.detail.includes("80.1"));
  assert.ok(emailWorthy(warning));
  assert.equal(
    warningsFor(snapshot([item]), DEFAULT_SETTINGS, Date.parse(end)).filter(
      (w) => w.key.startsWith("quota:"),
    ).length,
    0,
  );
});
test("provider family budget aggregates CF services without multiplying owner budget", () => {
  const rows = [
    p({ id: "cloudflare-workers", cost: { ...p().cost!, amountUsd: 8 } }),
    p({ id: "cloudflare-r2", cost: { ...p().cost!, amountUsd: 7 } }),
  ];
  const warnings = warningsFor(snapshot(rows), DEFAULT_SETTINGS, now);
  assert.equal(
    warnings.filter((w) => w.key.startsWith("budget:cloudflare")).length,
    1,
  );
  assert.match(
    warnings.find((w) => w.key.startsWith("budget:"))!.detail,
    /\$15.00/,
  );
});
test("only known Railway dollars warn; Neon quota still warns with incomplete cost coverage", () => {
  const readings = snapshot([
    p(), // $12 known resource usage against the $15 Railway warning target.
    p({
      id: "neon:staging",
      name: "Neon",
      cost: null,
      meters: [{
        id: "compute-cu-hours",
        label: "Compute",
        used: 80.1,
        limit: 100,
        unit: "CU-hours",
        periodStart: start,
        periodEnd: end,
        source: "provider",
      }],
    }),
    p({ id: "cloudflare-workers", name: "Cloudflare Workers", cost: null }),
    p({ id: "brevo", name: "Brevo", cost: null }),
  ]);
  const summary = summarize(readings, now);
  assert.equal(summary.knownSpendUsd, 12);
  assert.equal(summary.complete, false);
  const warnings = warningsFor(readings, DEFAULT_SETTINGS, now);
  const dollarWarnings = warnings.filter((w) => w.key.startsWith("budget:"));
  assert.equal(dollarWarnings.length, 1);
  assert.match(dollarWarnings[0]!.key, /^budget:railway:/);
  assert.match(dollarWarnings[0]!.detail, /\$12\.00 against your \$15\.00/);
  assert.ok(emailWorthy(dollarWarnings[0]!));
  const quota = warnings.find((w) => w.key.startsWith("quota:neon:staging:compute-cu-hours:"));
  assert.ok(quota);
  assert.match(quota.detail, /80\.1 of 100 CU-hours/);
  assert.ok(emailWorthy(quota));
  assert.ok(!warnings.some((w) => /^(budget:neon|budget:cloudflare|budget:brevo|total:)/.test(w.key)));
});
test("LiveKit carries no default dollar budget, setup gaps do not spam email", () => {
  const warnings = warningsFor(
    snapshot([
      p({ id: "livekit" }),
      p({ id: "neon", status: "not_connected", cost: null }),
    ]),
    DEFAULT_SETTINGS,
    now,
  );
  assert.ok(!warnings.some((w) => w.key.startsWith("budget:livekit")));
  assert.ok(
    warnings
      .filter((w) => w.key.startsWith("coverage:"))
      .every((w) => !emailWorthy(w)),
  );
});
test("a configured provider failure warns without treating absent setup as an outage", () => {
  const warnings = warningsFor(
    snapshot([p({ status: "unavailable", cost: null })]),
    DEFAULT_SETTINGS,
    now,
  );
  assert.ok(
    warnings.some(
      (w) => w.key.startsWith("provider-failure:") && emailWorthy(w),
    ),
  );
});
