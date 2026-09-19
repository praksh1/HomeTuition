import assert from "node:assert/strict";
import { test } from "node:test";
import { NullSupportAIProvider, readSupportAIConfig } from "./supportAiProvider.ts";

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
