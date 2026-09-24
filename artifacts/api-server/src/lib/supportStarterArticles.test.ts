import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORT_STARTER_ARTICLES, starterReviewFor } from "./supportStarterArticles.ts";
import { resolveSupport } from "./supportAssistant.ts";
test("starter guides are bounded, unique, and point to existing source files", () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  assert.equal(new Set(SUPPORT_STARTER_ARTICLES.map((a) => a.slug)).size, SUPPORT_STARTER_ARTICLES.length);
  for (const item of SUPPORT_STARTER_ARTICLES) {
    assert.ok(item.answer.length <= 3000 && item.keywords.length <= 20 && item.reviewCheck);
    for (const source of item.sources) assert.ok(existsSync(resolve(root, source)), source);
    assert.ok(starterReviewFor(item.slug, item.answer));
    assert.equal(starterReviewFor(item.slug, `${item.answer} altered`), null);
  }
});
test("draft starter guides do not influence public replies; reviewed guides are retrievable", () => {
  const rows = SUPPORT_STARTER_ARTICLES.map((a) => ({ ...a, id: a.slug, status: "draft" as const, reviewedBy: null }));
  assert.equal(resolveSupport("What is simulated payment?", rows).articles.length, 0);
  const published = rows.map((a) => ({ ...a, status: "published" as const, reviewedBy: "operator" }));
  assert.equal(resolveSupport("What is simulated payment?", published).articles[0]?.id, "fadko-test-payment");
  assert.equal(resolveSupport("I have a whiteboard pdf issue", published).articles[0]?.id, "fadko-whiteboard-file");
});
