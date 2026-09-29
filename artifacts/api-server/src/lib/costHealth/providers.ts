import type { Meter, ProviderReading } from "./types.ts";

type Environment = Record<string, string | undefined>;
type Fetcher = typeof fetch;
type ReadOptions = { env?: Environment; fetcher?: Fetcher };
type JsonReply = { body: unknown; observedAt: string | null };

const MAX_REPLY_BYTES = 256 * 1024;
const TIMEOUT_MS = 8_000;

class SafeProviderError extends Error {}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonnegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function iso(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value))
    return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).getUTCFullYear() >= 2000
    ? new Date(parsed).toISOString()
    : null;
}

function replyDate(response: Response): string | null {
  const date = response.headers.get("Date");
  if (!date) return null;
  const parsed = Date.parse(date);
  return Number.isFinite(parsed) && new Date(parsed).getUTCFullYear() >= 2000
    ? new Date(parsed).toISOString()
    : null;
}

/** HTTP Date is a response timestamp, not a guarantee of the metric's freshness. */
function observedOrChecked(
  observedAt: string | null,
  checkedAt: string,
): string {
  return observedAt && Date.parse(observedAt) <= Date.parse(checkedAt) + 60_000
    ? observedAt
    : checkedAt;
}

function failure(status: number): string {
  if (status === 401 || status === 403)
    return "The read-only API token was rejected or lacks access.";
  if (status === 429)
    return "The provider rate limit was reached; try again later.";
  return `The provider returned HTTP ${status}.`;
}

/** Fixed provider URLs only; no caller-controlled host or redirects. Never expose response bodies. */
async function jsonRequest(
  fetcher: Fetcher,
  url: string,
  headers: Record<string, string>,
  body?: string,
): Promise<JsonReply> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { Accept: "application/json", ...headers },
      ...(body === undefined ? {} : { body }),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new SafeProviderError(
      "The provider could not be reached within eight seconds.",
    );
  }
  if (!response.ok) throw new SafeProviderError(failure(response.status));
  const reader = response.body?.getReader();
  if (!reader)
    throw new SafeProviderError("The provider returned no usable data.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_REPLY_BYTES) {
        await reader.cancel();
        throw new SafeProviderError(
          "The provider response was too large to inspect safely.",
        );
      }
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof SafeProviderError) throw error;
    throw new SafeProviderError("The provider returned no usable data.");
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return {
      body: JSON.parse(new TextDecoder().decode(bytes)) as unknown,
      observedAt: replyDate(response),
    };
  } catch {
    throw new SafeProviderError("The provider returned no usable data.");
  }
}

function noteFrom(error: unknown): string {
  // Only our own fixed messages are safe. Never include a network or API error.
  if (error instanceof SafeProviderError) return error.message;
  return "The provider could not be checked right now.";
}

function base(
  checkedAt: string,
  id: string,
  name: string,
  scope: string,
  dashboardUrl: string,
  setup: string[],
): ProviderReading {
  return {
    id,
    name,
    scope,
    status: "not_connected",
    checkedAt,
    observedAt: null,
    dashboardUrl,
    note: "Read-only monitoring is not connected.",
    setup,
    meters: [],
    cost: null,
  };
}

function window24h(now: number): { start: string; end: string } {
  return {
    start: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    end: new Date(now).toISOString(),
  };
}

function meter(
  id: string,
  label: string,
  used: number,
  unit: string,
  start: string,
  end: string,
  limit: number | null = null,
): Meter {
  return {
    id,
    label,
    used,
    limit,
    unit,
    periodStart: start,
    periodEnd: end,
    source: "provider",
  };
}

type NeonProject = { id: string; name: string };
function neonProjects(raw: string | undefined): NeonProject[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 20)
      return null;
    const ids = new Set<string>();
    const projects: NeonProject[] = [];
    for (const item of parsed) {
      const row = record(item);
      const id = row?.id;
      const name = row?.name;
      if (
        typeof id !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9-]{2,79}$/.test(id) ||
        typeof name !== "string" ||
        !name.trim() ||
        ids.has(id)
      )
        return null;
      ids.add(id);
      projects.push({ id, name: name.trim().slice(0, 80) });
    }
    return projects;
  } catch {
    return null;
  }
}

// GET /projects/{id} returns current project consumption even on Neon Free.
// https://api-docs.neon.tech/reference/getproject
async function neonReadings(
  now: number,
  env: Environment,
  fetcher: Fetcher,
): Promise<ProviderReading[]> {
  const checkedAt = new Date(now).toISOString();
  const setup = ["COST_HEALTH_NEON_API_KEY", "COST_HEALTH_NEON_PROJECTS_JSON"];
  const projects = neonProjects(env.COST_HEALTH_NEON_PROJECTS_JSON);
  if (!projects) {
    const card = base(
      checkedAt,
      "neon",
      "Neon",
      "Projects listed for this app",
      "https://console.neon.tech/",
      setup,
    );
    card.note = env.COST_HEALTH_NEON_PROJECTS_JSON
      ? "The named project list is invalid. Use a JSON array of {id,name}, at most 20 projects."
      : "List the staging and production project IDs to read each project's actual period.";
    return [card];
  }
  return Promise.all(
    projects.map(async (project): Promise<ProviderReading> => {
      const card = base(
        checkedAt,
        `neon:${project.id}`,
        `Neon · ${project.name}`,
        `Neon project ${project.name}`,
        `https://console.neon.tech/app/projects/${encodeURIComponent(project.id)}`,
        setup,
      );
      if (!env.COST_HEALTH_NEON_API_KEY) return card;
      try {
        const reply = await jsonRequest(
          fetcher,
          `https://console.neon.tech/api/v2/projects/${encodeURIComponent(project.id)}`,
          { Authorization: `Bearer ${env.COST_HEALTH_NEON_API_KEY}` },
        );
        const body = record(reply.body);
        const details = record(body?.project);
        const seconds = nonnegative(details?.compute_time_seconds);
        const periodStart = iso(details?.consumption_period_start);
        const periodEnd = iso(details?.consumption_period_end);
        if (
          !details ||
          details.id !== project.id ||
          seconds === null ||
          !periodStart ||
          !periodEnd ||
          Date.parse(periodEnd) <= Date.parse(periodStart)
        ) {
          card.status = "partial";
          card.note =
            "Project was reached, but current compute or consumption-period fields were unavailable.";
          card.observedAt = observedOrChecked(reply.observedAt, checkedAt);
          return card;
        }
        const plan = record(details.owner)?.subscription_type;
        const isFree = plan === "free_v3";
        card.status = "connected";
        card.observedAt = observedOrChecked(reply.observedAt, checkedAt);
        card.meters = [
          meter(
            "compute-cu-hours",
            "Compute used in provider period",
            seconds / 3600,
            "CU-hours",
            periodStart,
            periodEnd,
            isFree ? 100 : null,
          ),
        ];
        card.note = isFree
          ? "Neon Free compute allowance is 100 CU-hours per project. Usage may lag; no invoice estimate is available here."
          : "Neon reported compute for this project. Plan allowance and dollar charges are not available from this reading.";
        return card;
      } catch (error) {
        card.status = "unavailable";
        card.note = noteFrom(error);
        return card;
      }
    }),
  );
}

async function cloudflareRows(
  fetcher: Fetcher,
  token: string,
  accountId: string,
  query: string,
  variables: Record<string, unknown>,
  field: string,
): Promise<{ rows: unknown[]; observedAt: string | null }> {
  const reply = await jsonRequest(
    fetcher,
    "https://api.cloudflare.com/client/v4/graphql",
    {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    JSON.stringify({
      query,
      variables: { accountTag: accountId, ...variables },
    }),
  );
  const body = record(reply.body);
  if (Array.isArray(body?.errors) && body.errors.length > 0)
    throw new SafeProviderError("The provider rejected this analytics query.");
  const accounts = record(record(body?.data)?.viewer)?.accounts;
  const account =
    Array.isArray(accounts) && accounts.length === 1
      ? record(accounts[0])
      : null;
  const rows = account?.[field];
  if (!Array.isArray(rows))
    throw new SafeProviderError("The provider returned no usable data.");
  return { rows, observedAt: reply.observedAt };
}

// Cloudflare says GraphQL analytics are NOT billable usage or invoice data.
// https://developers.cloudflare.com/analytics/graphql-api/
// Queries follow official Workers and R2 examples:
// https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/
// https://developers.cloudflare.com/r2/platform/metrics-analytics/
const WORKERS_QUERY = `query($accountTag: string!, $start: Time!, $end: Time!) {
  viewer { accounts(filter: {accountTag: $accountTag}) {
    workersInvocationsAdaptive(limit: 100, filter: {datetime_geq: $start, datetime_lt: $end}) {
      sum { requests }
    }
  } }
}`;
const R2_QUERY = `query($accountTag: string!, $start: Time!, $end: Time!) {
  viewer { accounts(filter: {accountTag: $accountTag}) {
    r2OperationsAdaptiveGroups(limit: 100, filter: {datetime_geq: $start, datetime_lt: $end}) {
      sum { requests }
      dimensions { actionType }
    }
  } }
}`;
const AI_QUERY = `query($accountTag: string!, $start: Time!, $end: Time!) {
  viewer { accounts(filter: {accountTag: $accountTag}) {
    aiInferenceAdaptiveGroups(limit: 100, filter: {datetime_geq: $start, datetime_lt: $end}) {
      count
    }
  } }
}`;

async function cloudflareReadings(
  now: number,
  env: Environment,
  fetcher: Fetcher,
): Promise<ProviderReading[]> {
  const checkedAt = new Date(now).toISOString();
  const setup = [
    "COST_HEALTH_CLOUDFLARE_API_TOKEN",
    "COST_HEALTH_CLOUDFLARE_ACCOUNT_ID",
  ];
  const accountId = env.COST_HEALTH_CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = env.COST_HEALTH_CLOUDFLARE_API_TOKEN?.trim();
  const specs = [
    {
      id: "cloudflare-workers",
      name: "Cloudflare Workers",
      field: "workersInvocationsAdaptive",
      query: WORKERS_QUERY,
      metric: "requests",
      label: "Worker requests (last 24 hours)",
      dashboard: "https://dash.cloudflare.com/?to=/:account/workers",
    },
    {
      id: "cloudflare-r2",
      name: "Cloudflare R2",
      field: "r2OperationsAdaptiveGroups",
      query: R2_QUERY,
      metric: "requests",
      label: "R2 operations (last 24 hours)",
      dashboard: "https://dash.cloudflare.com/?to=/:account/r2",
    },
    {
      id: "cloudflare-ai",
      name: "Cloudflare Workers AI",
      field: "aiInferenceAdaptiveGroups",
      query: AI_QUERY,
      metric: "count",
      label: "AI inference events (last 24 hours)",
      dashboard: "https://dash.cloudflare.com/?to=/:account/ai/workers-ai",
    },
  ] as const;
  return Promise.all(
    specs.map(async (spec): Promise<ProviderReading> => {
      const card = base(
        checkedAt,
        spec.id,
        spec.name,
        "Cloudflare account (includes other apps)",
        spec.dashboard,
        setup,
      );
      if (!accountId || !/^[a-fA-F0-9]{32}$/.test(accountId) || !token) {
        card.note =
          "Add an Account Analytics: Read token and a 32-character Cloudflare account ID.";
        return card;
      }
      const window = window24h(now);
      try {
        const { rows, observedAt } = await cloudflareRows(
          fetcher,
          token,
          accountId,
          spec.query,
          { start: window.start, end: window.end },
          spec.field,
        );
        card.observedAt = observedOrChecked(observedAt, checkedAt);
        if (rows.length === 0 || rows.length >= 100) {
          card.status = "partial";
          card.note =
            rows.length === 0
              ? "No analytics rows were returned; this does not prove zero billable usage."
              : "The analytics page limit was reached, so a complete count cannot be shown.";
          return card;
        }
        let total = 0;
        for (const row of rows) {
          const value =
            spec.metric === "count"
              ? record(row)?.count
              : record(record(row)?.sum)?.requests;
          const amount = nonnegative(value);
          if (amount === null) {
            card.status = "partial";
            card.note = "The analytics result omitted a requested metric.";
            return card;
          }
          total += amount;
        }
        card.status = "connected";
        card.meters = [
          meter(
            "last-24h-events",
            spec.label,
            total,
            "events",
            window.start,
            window.end,
          ),
        ];
        card.note =
          "Account-wide sampled analytics, including other apps. These counts are not billing figures; dollar cost remains unknown.";
        return card;
      } catch (error) {
        card.status = "unavailable";
        card.note = noteFrom(error);
        return card;
      }
    }),
  );
}

// https://developers.brevo.com/reference/get-account
// https://developers.brevo.com/reference/get-smtp-report
async function brevoReading(
  now: number,
  env: Environment,
  fetcher: Fetcher,
): Promise<ProviderReading> {
  const checkedAt = new Date(now).toISOString();
  const card = base(
    checkedAt,
    "brevo",
    "Brevo",
    "Brevo account, transactional email",
    "https://app.brevo.com/",
    ["COST_HEALTH_BREVO_API_KEY (or BREVO_API_KEY)"],
  );
  const key = env.COST_HEALTH_BREVO_API_KEY || env.BREVO_API_KEY;
  if (!key) return card;
  const date = checkedAt.slice(0, 10);
  const headers = { "api-key": key };
  const results = await Promise.allSettled([
    jsonRequest(fetcher, "https://api.brevo.com/v3/account", headers),
    jsonRequest(
      fetcher,
      `https://api.brevo.com/v3/smtp/statistics/reports?startDate=${date}&endDate=${date}&limit=1`,
      headers,
    ),
  ]);
  const account =
    results[0].status === "fulfilled" ? record(results[0].value.body) : null;
  const report =
    results[1].status === "fulfilled" ? record(results[1].value.body) : null;
  if (!account && !report) {
    card.status = "unavailable";
    card.note = noteFrom(
      results[0].status === "rejected"
        ? results[0].reason
        : results[1].status === "rejected"
          ? results[1].reason
          : null,
    );
    return card;
  }
  const plan = Array.isArray(account?.plan)
    ? account.plan
        .map(record)
        .find((item) => item?.type === "free" || item?.type === "payAsYouGo")
    : null;
  const planName = typeof plan?.type === "string" ? plan.type : null;
  card.observedAt = observedOrChecked(
    results[1].status === "fulfilled"
      ? results[1].value.observedAt
      : results[0].status === "fulfilled"
        ? results[0].value.observedAt
        : null,
    checkedAt,
  );
  const rows = report?.reports;
  const row = Array.isArray(rows)
    ? rows.map(record).find((item) => item?.date === date)
    : null;
  const requests = nonnegative(row?.requests);
  if (requests !== null) {
    card.status = account ? "connected" : "partial";
    card.meters = [
      meter(
        "email-requests-today",
        `Transactional email requests reported for ${date}`,
        requests,
        "emails",
        `${date}T00:00:00.000Z`,
        `${date}T23:59:59.999Z`,
        planName === "free" ? 300 : null,
      ),
    ];
    card.note = `${planName ? `Account plan: ${planName}. ` : ""}Free's published 300/day cap is shared with marketing mail; this request count covers transactional mail only and may not equal billable sends or the provider's reset clock. Dollar cost is unavailable.${env.RESEND_API_KEY ? " This app selects Resend when both email keys are set." : ""}`;
  } else {
    card.status = "partial";
    card.note = `${planName ? `Account plan: ${planName}. ` : ""}Today’s transactional email report is unavailable; an empty report is not zero usage.${env.RESEND_API_KEY ? " This app selects Resend when both email keys are set." : ""}`;
  }
  return card;
}

function videoReadings(now: number, env: Environment): ProviderReading[] {
  const checkedAt = new Date(now).toISOString();
  const selected = env.VIDEO_PROVIDER?.trim().toLowerCase() || "daily";
  const daily = base(
    checkedAt,
    "daily",
    "Daily Video",
    "Video calls, including native app fallback",
    "https://dashboard.daily.co/",
    ["Open Daily billing and set usage alerts there"],
  );
  const livekit = base(
    checkedAt,
    "livekit",
    "LiveKit Cloud",
    "Browser classroom video when selected",
    "https://cloud.livekit.io/",
    ["Open LiveKit project Usage and Billing"],
  );
  if (env.DAILY_API_KEY) {
    daily.status = "partial";
    daily.note =
      selected === "livekit"
        ? "Configured as the installed native-app and older-client fallback. Usage and charges require Daily's dashboard."
        : "Configured as the selected video service. Usage and charges require Daily's dashboard.";
  }
  if (env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET && env.LIVEKIT_URL) {
    livekit.status = "partial";
    livekit.note =
      selected === "livekit"
        ? "Configured for browser calls, including phone browsers. Installed native apps and older clients still use Daily. Usage requires LiveKit's dashboard."
        : "Credentials are present, but LiveKit is not selected for browser calls. Usage requires LiveKit's dashboard.";
  }
  return [daily, livekit];
}

// Railway's own CLI uses this query for current workspace resource usage and
// the provider's billing period. Its estimatedUsage query returns resource
// units, so it must not be shown as an estimated dollar bill here.
// https://github.com/railwayapp/cli/blob/master/src/commands/usage.rs
const RAILWAY_QUERY = `query($workspaceId: String!) {
  workspace(workspaceId: $workspaceId) {
    id name customer {
      currentUsage
      billingPeriod { start end }
      usageLimit { softLimit hardLimit isOverLimit }
    }
  }
}`;

/** A cautious trend, only after a full day of this provider's actual billing period. */
export function projectRailwayResourceSpend(
  amountUsd: number,
  periodStart: string,
  periodEnd: string,
  now: number,
): number | null {
  if (!Number.isFinite(amountUsd) || amountUsd < 0) return null;
  const start = Date.parse(periodStart);
  const end = Date.parse(periodEnd);
  const elapsed = now - start;
  const duration = end - start;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    duration <= 0 ||
    elapsed < 24 * 60 * 60 * 1000 ||
    elapsed > duration
  )
    return null;
  const estimate = amountUsd * (duration / elapsed);
  return Number.isFinite(estimate) ? Math.max(amountUsd, estimate) : null;
}

async function railwayReading(
  now: number,
  env: Environment,
  fetcher: Fetcher,
): Promise<ProviderReading> {
  const checkedAt = new Date(now).toISOString();
  const setup = [
    "COST_HEALTH_RAILWAY_API_TOKEN",
    "COST_HEALTH_RAILWAY_WORKSPACE_ID",
  ];
  const card = base(
    checkedAt,
    "railway",
    "Railway",
    "Railway workspace resource usage",
    "https://railway.com/account/billing",
    setup,
  );
  const workspaceId = env.COST_HEALTH_RAILWAY_WORKSPACE_ID?.trim();
  const token = env.COST_HEALTH_RAILWAY_API_TOKEN?.trim();
  if (!workspaceId || !/^[a-zA-Z0-9_-]{8,80}$/.test(workspaceId) || !token) {
    card.note =
      "Add a workspace-capable Railway API token and workspace ID. A project token cannot read workspace usage.";
    return card;
  }
  try {
    const reply = await jsonRequest(
      fetcher,
      "https://backboard.railway.com/graphql/v2",
      {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      JSON.stringify({ query: RAILWAY_QUERY, variables: { workspaceId } }),
    );
    const body = record(reply.body);
    if (Array.isArray(body?.errors) && body.errors.length > 0)
      throw new SafeProviderError(
        "The provider rejected this analytics query.",
      );
    const workspace = record(record(body?.data)?.workspace);
    if (!workspace || workspace.id !== workspaceId)
      throw new SafeProviderError("The provider returned no usable data.");
    const customer = record(workspace.customer);
    const usage = nonnegative(customer?.currentUsage);
    const billing = record(customer?.billingPeriod);
    const periodStart = iso(billing?.start);
    const periodEnd = iso(billing?.end);
    card.observedAt = observedOrChecked(reply.observedAt, checkedAt);
    if (
      usage === null ||
      !periodStart ||
      !periodEnd ||
      Date.parse(periodEnd) <= Date.parse(periodStart)
    ) {
      card.status = "partial";
      card.note =
        "The workspace was reached, but its current usage or billing period was unavailable.";
      return card;
    }
    const limitData = record(customer?.usageLimit);
    const hardLimit = nonnegative(limitData?.hardLimit);
    const softLimit = nonnegative(limitData?.softLimit);
    card.status = "connected";
    card.scope =
      typeof workspace.name === "string" && workspace.name.trim()
        ? `Railway workspace ${workspace.name.trim().slice(0, 80)}`
        : card.scope;
    card.meters = [
      meter(
        "resource-usage-usd",
        "Resource usage in Railway billing period",
        usage,
        "USD",
        periodStart,
        periodEnd,
        hardLimit,
      ),
    ];
    card.cost = {
      amountUsd: usage,
      projectedUsd: projectRailwayResourceSpend(
        usage,
        periodStart,
        periodEnd,
        now,
      ),
      periodStart,
      periodEnd,
      basis: "measured",
      note: "Actual amount is Railway-reported resource usage. Forecast is a straight-line estimate after one full day; neither includes the plan fee, credits, taxes or other charges.",
    };
    card.note = `${softLimit === null ? "" : `Railway soft usage limit: $${softLimit}. `}Actual amount covers resources only; forecast extrapolates that usage and is not a provider bill.`;
    return card;
  } catch (error) {
    card.status = "unavailable";
    card.note = noteFrom(error);
    return card;
  }
}

/** Read-only provider checks. A missing API field is never converted to zero dollars or usage. */
export async function collectProviderReadings(
  now = Date.now(),
  options: ReadOptions = {},
): Promise<ProviderReading[]> {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const [railway, neon, cloudflare, brevo] = await Promise.all([
    railwayReading(now, env, fetcher),
    neonReadings(now, env, fetcher),
    cloudflareReadings(now, env, fetcher),
    brevoReading(now, env, fetcher),
  ]);
  return [railway, ...neon, ...cloudflare, brevo, ...videoReadings(now, env)];
}
