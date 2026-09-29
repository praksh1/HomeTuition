import type { HealthCheck } from "./types";

// Fixed, public, read-only targets. Never fetch owner-supplied arbitrary URLs or private hosts.
const TARGETS = [
  {
    id: "production-api",
    name: "Production API",
    url: "https://workspaceapi-server-production-5a63.up.railway.app/api/healthz",
  },
  {
    id: "production-web",
    name: "Production website",
    url: "https://hometuition.praksh-dhakal.workers.dev/",
  },
  {
    id: "preview-web",
    name: "Preview website",
    url: "https://hometuition-preview.praksh-dhakal.workers.dev/",
  },
  {
    id: "preview-api",
    name: "Preview API",
    url: "https://hometuition-api-staging-production.up.railway.app/api/healthz",
  },
];
export async function collectHealthChecks(): Promise<HealthCheck[]> {
  return Promise.all(
    TARGETS.map(async (target) => {
      const start = Date.now();
      try {
        const response = await fetch(target.url, {
          redirect: "error",
          signal: AbortSignal.timeout(8000),
          headers: { "User-Agent": "Fadko-Owner-Health/1.0" },
        });
        const success = response.ok;
        await response.body?.cancel();
        return {
          id: target.id,
          name: target.name,
          status: success ? ("healthy" as const) : ("degraded" as const),
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - start,
          note: success
            ? "Public endpoint answered. This does not test sign-in, payment or live audio/video."
            : `Public endpoint returned HTTP ${response.status}. Check the service dashboard.`,
        };
      } catch {
        return {
          id: target.id,
          name: target.name,
          status: "unavailable" as const,
          checkedAt: new Date().toISOString(),
          latencyMs: null,
          note: "Public endpoint did not answer within eight seconds. This may be a service or network problem; no cause has been assumed.",
        };
      }
    }),
  );
}
