/**
 * Provider boundary for the optional Support Assistant model.
 *
 * The API currently has no model binding, so the only live provider is the null provider. Keeping
 * the interface here means Phase 3 can add Workers AI without making routes, ticket logic or the
 * mobile app import a vendor SDK.
 */

export interface SupportAIConfig {
  enabled: boolean;
  provider: "none" | "workers-ai" | "external";
  dailyLimit: number;
  userDailyLimit: number;
  maxInputChars: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxRetries: number;
}

export interface SupportAIContext {
  question: string;
  /** Reviewed article excerpts only; never a raw database dump. */
  knowledge: readonly string[];
  role: "teacher" | "student" | "admin" | "unknown";
  locale: "en" | "ne";
}

export type SupportAIResult =
  | { kind: "answer"; text: string }
  | { kind: "unavailable"; reason: "disabled" | "budget" | "provider_error" | "timeout" };

export interface SupportAIProvider {
  generateResponse(context: SupportAIContext, signal?: AbortSignal): Promise<SupportAIResult>;
}

const MAX_INPUT_CHARS = 1_200;
const MAX_OUTPUT_TOKENS = 600;
const MAX_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;

function boundedInt(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function envValue(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" ? value.trim() : undefined;
}

/** Parse operational limits in one place; an absent/invalid value never enables AI. */
export function readSupportAIConfig(env: Record<string, string | undefined>): SupportAIConfig {
  const enabled = envValue(env, "SUPPORT_AI_ENABLED") === "true";
  const requestedProvider = envValue(env, "SUPPORT_AI_PROVIDER");
  const provider = enabled && (requestedProvider === "workers-ai" || requestedProvider === "external")
    ? requestedProvider
    : "none";
  return {
    enabled: enabled && provider !== "none",
    provider,
    dailyLimit: boundedInt(envValue(env, "SUPPORT_AI_DAILY_LIMIT"), 0, 100_000),
    userDailyLimit: boundedInt(envValue(env, "SUPPORT_AI_USER_DAILY_LIMIT"), 0, 10_000),
    maxInputChars: boundedInt(envValue(env, "SUPPORT_AI_MAX_INPUT_CHARS"), MAX_INPUT_CHARS, MAX_INPUT_CHARS),
    maxOutputTokens: boundedInt(envValue(env, "SUPPORT_AI_MAX_OUTPUT_TOKENS"), 300, MAX_OUTPUT_TOKENS),
    timeoutMs: boundedInt(envValue(env, "SUPPORT_AI_TIMEOUT_MS"), 6_000, MAX_TIMEOUT_MS),
    maxRetries: boundedInt(envValue(env, "SUPPORT_AI_MAX_RETRIES"), 1, MAX_RETRIES),
  };
}

export class NullSupportAIProvider implements SupportAIProvider {
  async generateResponse(_context: SupportAIContext, _signal?: AbortSignal): Promise<SupportAIResult> {
    return { kind: "unavailable", reason: "disabled" };
  }
}
