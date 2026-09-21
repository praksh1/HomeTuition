import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CloudflareSupportAIProvider, NullSupportAIProvider, readSupportAIConfig,
  redactSupportQuestion, supportAIProviderFromEnv,
} from "./supportAiProvider.ts";

test("AI is disabled unless both the flag and a known provider are explicit", () => {
  assert.equal(readSupportAIConfig({}).enabled, false);
  assert.equal(readSupportAIConfig({ SUPPORT_AI_ENABLED: "true" }).provider, "none");
  assert.equal(readSupportAIConfig({ SUPPORT_AI_ENABLED: "TRUE", SUPPORT_AI_PROVIDER: "workers-ai" }).enabled, false);
  const config = readSupportAIConfig({ SUPPORT_AI_ENABLED: "true", SUPPORT_AI_PROVIDER: "workers-ai" });
  assert.equal(config.enabled, true);
  assert.equal(config.provider, "workers-ai");
});

test("invalid and excessive limits are bounded without enabling AI", () => {
  const config = readSupportAIConfig({
    SUPPORT_AI_ENABLED: "false",
    SUPPORT_AI_PROVIDER: "external",
    SUPPORT_AI_DAILY_LIMIT: "-10",
    SUPPORT_AI_USER_DAILY_LIMIT: "999999999",
    SUPPORT_AI_MAX_INPUT_CHARS: "999999999",
    SUPPORT_AI_MAX_OUTPUT_TOKENS: "999999999",
    SUPPORT_AI_TIMEOUT_MS: "999999999",
    SUPPORT_AI_MAX_RETRIES: "999",
  });
  assert.equal(config.enabled, false);
  assert.equal(config.dailyLimit, 0);
  assert.equal(config.userDailyLimit, 10_000);
  assert.equal(config.maxInputChars, 1_200);
  assert.equal(config.maxOutputTokens, 600);
  assert.equal(config.timeoutMs, 15_000);
  assert.equal(config.maxRetries, 2);
});

test("the null provider gives a user-safe fallback", async () => {
  const result = await new NullSupportAIProvider().generateResponse({
    question: "hello",
    knowledge: [],
    role: "student",
    locale: "en",
  });
  assert.deepEqual(result, { kind: "unavailable", reason: "disabled" });
});

test("a missing server-side key never calls Workers AI", async () => {
  let called = false;
  const provider = supportAIProviderFromEnv({
    SUPPORT_AI_ENABLED: "true", SUPPORT_AI_PROVIDER: "workers-ai",
    SUPPORT_AI_DAILY_LIMIT: "20", SUPPORT_AI_USER_DAILY_LIMIT: "3",
  }, (async () => { called = true; throw new Error("should not call"); }) as typeof fetch);
  const result = await provider.generateResponse({ question: "How do I join?", knowledge: ["Use Sessions"], role: "student", locale: "en" });
  assert.deepEqual(result, { kind: "unavailable", reason: "disabled" });
  assert.equal(called, false);
});

test("Workers AI receives only bounded, redacted question and reviewed excerpts", async () => {
  let requestBody: Record<string, unknown> | null = null;
  const request = (async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return { ok: true, json: async () => ({ success: true, result: { response: "Open Sessions and choose the lesson." } }) } as Response;
  }) as typeof fetch;
  const config = readSupportAIConfig({ SUPPORT_AI_ENABLED: "true", SUPPORT_AI_PROVIDER: "workers-ai" });
  const provider = new CloudflareSupportAIProvider("account", "secret", config, "@cf/zai-org/glm-4.7-flash", request);
  const result = await provider.generateResponse({
    question: "I am alice@example.com and my number is 9812345678. How do I join?",
    knowledge: ["Open Sessions and choose the lesson."], role: "student", locale: "en",
  });
  assert.deepEqual(result, { kind: "answer", text: "Open Sessions and choose the lesson." });
  const wire = JSON.stringify(requestBody);
  assert.equal(wire.includes("alice@example.com"), false);
  assert.equal(wire.includes("9812345678"), false);
  assert.equal(wire.includes("[email]"), true);
  assert.equal(wire.includes("[phone]"), true);
  assert.equal(redactSupportQuestion("my mail is alice@example.com"), "my mail is [email]");
  assert.equal(redactSupportQuestion("card 4111 1111 1111 1111"), "card [payment number]");
  assert.equal(redactSupportQuestion("OTP: 123456 and password=abc123"), "OTP [secret] and password [secret]");
});

test("provider errors and ungrounded calls fail closed", async () => {
  const config = readSupportAIConfig({ SUPPORT_AI_ENABLED: "true", SUPPORT_AI_PROVIDER: "workers-ai" });
  let calls = 0;
  const provider = new CloudflareSupportAIProvider("account", "secret", config, "@cf/zai-org/glm-4.7-flash",
    (async () => { calls += 1; return { ok: true, json: async () => ({ success: true, result: {} }) } as Response; }) as typeof fetch);
  const empty = await provider.generateResponse({ question: "unknown", knowledge: [], role: "unknown", locale: "en" });
  assert.deepEqual(empty, { kind: "unavailable", reason: "disabled" });
  assert.equal(calls, 0);
  const malformed = await provider.generateResponse({ question: "unknown", knowledge: ["reviewed"], role: "unknown", locale: "en" });
  assert.deepEqual(malformed, { kind: "unavailable", reason: "provider_error" });
});
