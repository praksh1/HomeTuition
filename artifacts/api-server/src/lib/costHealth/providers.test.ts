import assert from "node:assert/strict";
import test from "node:test";
import {
  collectProviderReadings,
  projectRailwayResourceSpend,
} from "./providers.ts";

const NOW = Date.parse("2026-09-29T12:00:00.000Z");
const DATE_HEADER = { Date: "Tue, 29 Sep 2026 12:00:00 GMT" };

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: DATE_HEADER });
}

test("Neon Free uses project CU seconds and the provider's own consumption period", async () => {
  const requested: string[] = [];
  const readings = await collectProviderReadings(NOW, {
    env: {
      COST_HEALTH_NEON_API_KEY: "synthetic-neon-key",
      COST_HEALTH_NEON_PROJECTS_JSON: JSON.stringify([
        { id: "staging-123456", name: "Staging" },
      ]),
    },
    fetcher: (async (url: string) => {
      requested.push(url);
      return json({
        project: {
          id: "staging-123456",
          compute_time_seconds: 288360,
          consumption_period_start: "2026-09-01T00:00:00Z",
          consumption_period_end: "2026-10-01T00:00:00Z",
          owner: { subscription_type: "free_v3" },
        },
      });
    }) as typeof fetch,
  });
  const neon = readings.find((item) => item.id === "neon:staging-123456");
  assert.equal(neon?.status, "connected");
  assert.equal(neon.meters[0]?.used, 80.1);
  assert.equal(neon.meters[0]?.limit, 100);
  assert.equal(neon.meters[0]?.periodStart, "2026-09-01T00:00:00.000Z");
  assert.equal(neon.cost, null);
  assert.equal(neon.observedAt, "2026-09-29T12:00:00.000Z");
  assert.deepEqual(requested, [
    "https://console.neon.tech/api/v2/projects/staging-123456",
  ]);
});

test("Neon omits an unknown metric instead of turning a sentinel period into usage", async () => {
  const readings = await collectProviderReadings(NOW, {
    env: {
      COST_HEALTH_NEON_API_KEY: "synthetic-neon-key",
      COST_HEALTH_NEON_PROJECTS_JSON: JSON.stringify([
        { id: "new-project-999", name: "New project" },
      ]),
    },
    fetcher: (async () =>
      json({
        project: {
          id: "new-project-999",
          compute_time_seconds: 0,
          consumption_period_start: "0001-01-01T00:00:00Z",
          consumption_period_end: "0001-01-01T00:00:00Z",
        },
      })) as typeof fetch,
  });
  const neon = readings.find((item) => item.id === "neon:new-project-999");
  assert.equal(neon?.status, "partial");
  assert.deepEqual(neon.meters, []);
  assert.equal(neon.cost, null);
});

test("Railway reports resource usage and a separate straight-line forecast after one day", async () => {
  const periodStart = "2026-09-01T00:00:00Z";
  const periodEnd = "2026-10-01T00:00:00Z";
  const readings = await collectProviderReadings(NOW, {
    env: {
      COST_HEALTH_RAILWAY_API_TOKEN: "synthetic-railway-key",
      COST_HEALTH_RAILWAY_WORKSPACE_ID: "workspace-123456",
    },
    fetcher: (async (_url: string, init?: RequestInit) => {
      const posted = JSON.parse(String(init?.body));
      assert.equal(posted.variables.workspaceId, "workspace-123456");
      return json({
        data: {
          workspace: {
            id: "workspace-123456",
            name: "Fadko",
            customer: {
              currentUsage: 7.5,
              billingPeriod: { start: periodStart, end: periodEnd },
              usageLimit: { softLimit: 10, hardLimit: 20, isOverLimit: false },
            },
          },
        },
      });
    }) as typeof fetch,
  });
  const railway = readings.find((item) => item.id === "railway");
  assert.equal(railway?.cost?.amountUsd, 7.5);
  assert.equal(railway?.cost?.basis, "measured");
  assert.equal(railway?.cost?.projectedUsd, 7.5 * (30 / 28.5));
  assert.equal(railway?.meters[0]?.limit, 20);
  assert.match(railway?.cost?.note ?? "", /plan fee/);
});

test("Railway missing currentUsage remains unknown, never zero", async () => {
  const readings = await collectProviderReadings(NOW, {
    env: {
      COST_HEALTH_RAILWAY_API_TOKEN: "synthetic-railway-key",
      COST_HEALTH_RAILWAY_WORKSPACE_ID: "workspace-123456",
    },
    fetcher: (async () =>
      json({
        data: {
          workspace: {
            id: "workspace-123456",
            customer: {
              currentUsage: null,
              billingPeriod: {
                start: "2026-09-01T00:00:00Z",
                end: "2026-10-01T00:00:00Z",
              },
            },
          },
        },
      })) as typeof fetch,
  });
  const railway = readings.find((item) => item.id === "railway");
  assert.equal(railway?.status, "partial");
  assert.equal(railway?.cost, null);
  assert.deepEqual(railway?.meters, []);
});

test("a successful provider response without HTTP Date still has a retrieval timestamp", async () => {
  const readings = await collectProviderReadings(NOW, {
    env: {
      COST_HEALTH_RAILWAY_API_TOKEN: "synthetic-railway-key",
      COST_HEALTH_RAILWAY_WORKSPACE_ID: "workspace-123456",
    },
    fetcher: (async () =>
      new Response(
        JSON.stringify({
          data: {
            workspace: {
              id: "workspace-123456",
              customer: {
                currentUsage: 12,
                billingPeriod: {
                  start: "2026-09-01T00:00:00Z",
                  end: "2026-10-01T00:00:00Z",
                },
              },
            },
          },
        }),
        { status: 200 },
      )) as typeof fetch,
  });
  const railway = readings.find((item) => item.id === "railway");
  assert.equal(railway?.status, "connected");
  assert.equal(railway.observedAt, "2026-09-29T12:00:00.000Z");
  assert.equal(railway.cost?.amountUsd, 12);
});

test("straight-line forecast waits a full day and stays within the actual period", () => {
  const start = "2026-09-01T00:00:00Z";
  const end = "2026-10-01T00:00:00Z";
  assert.equal(
    projectRailwayResourceSpend(
      3,
      start,
      end,
      Date.parse("2026-09-01T23:59:00Z"),
    ),
    null,
  );
  assert.equal(
    projectRailwayResourceSpend(
      3,
      start,
      end,
      Date.parse("2026-09-02T00:00:00Z"),
    ),
    90,
  );
  assert.equal(
    projectRailwayResourceSpend(
      3,
      start,
      end,
      Date.parse("2026-10-02T00:00:00Z"),
    ),
    null,
  );
});

test("Cloudflare GraphQL errors and empty datasets never become zero-dollar usage", async () => {
  const readings = await collectProviderReadings(NOW, {
    env: {
      COST_HEALTH_CLOUDFLARE_API_TOKEN: "synthetic-token",
      COST_HEALTH_CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    },
    fetcher: (async (_url: string, init?: RequestInit) => {
      const posted = JSON.parse(String(init?.body));
      return String(posted.query).includes("r2OperationsAdaptiveGroups")
        ? json({
            data: {
              viewer: { accounts: [{ r2OperationsAdaptiveGroups: [] }] },
            },
          })
        : json({ errors: [{ message: "secret should not appear in card" }] });
    }) as typeof fetch,
  });
  const workers = readings.find((item) => item.id === "cloudflare-workers");
  const r2 = readings.find((item) => item.id === "cloudflare-r2");
  assert.equal(workers?.status, "unavailable");
  assert.equal(workers?.cost, null);
  assert.doesNotMatch(workers?.note ?? "", /secret/);
  assert.equal(r2?.status, "partial");
  assert.deepEqual(r2?.meters, []);
});

test("Brevo compares transactional requests to the published Free cap without inventing cost", async () => {
  const readings = await collectProviderReadings(NOW, {
    env: {
      BREVO_API_KEY: "synthetic-brevo-key",
      RESEND_API_KEY: "synthetic-resend-key",
    },
    fetcher: (async (url: string) =>
      url.endsWith("/account")
        ? json({
            plan: [{ type: "free", credits: 250, creditsType: "sendLimit" }],
          })
        : json({
            reports: [{ date: "2026-09-29", requests: 37 }],
          })) as typeof fetch,
  });
  const brevo = readings.find((item) => item.id === "brevo");
  assert.equal(brevo?.status, "connected");
  assert.equal(brevo?.meters[0]?.used, 37);
  assert.equal(brevo?.meters[0]?.limit, 300);
  assert.equal(brevo?.cost, null);
  assert.match(brevo?.note ?? "", /marketing mail/);
  assert.match(brevo?.note ?? "", /selects Resend/);
});

test("both video providers remain visible when LiveKit is selected for browsers", async () => {
  const readings = await collectProviderReadings(NOW, {
    env: {
      VIDEO_PROVIDER: "livekit",
      DAILY_API_KEY: "synthetic-daily-key",
      LIVEKIT_API_KEY: "synthetic-livekit-key",
      LIVEKIT_API_SECRET: "synthetic-secret",
      LIVEKIT_URL: "wss://example.invalid",
    },
  });
  assert.equal(readings.find((item) => item.id === "daily")?.status, "partial");
  assert.equal(
    readings.find((item) => item.id === "livekit")?.status,
    "partial",
  );
  assert.match(
    readings.find((item) => item.id === "daily")?.note ?? "",
    /fallback/,
  );
});
