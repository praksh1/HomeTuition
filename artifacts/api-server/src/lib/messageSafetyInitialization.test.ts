import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

// Run actual additive initialization, not a copy of its SQL or a real provider DB.
const compilation = build({
  stdin: { contents: 'export { ensureMessageSafety } from "./messageSafety";',
    resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "ts" },
  bundle: true, write: false, platform: "node", format: "cjs",
  plugins: [{ name: "schema-boundaries", setup(builder) {
    builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
    builder.onResolve({ filter: /^drizzle-orm$/ }, () => ({ path: "sql", namespace: "fixture" }));
    builder.onResolve({ filter: /\/testStudentAccess$/ }, () => ({ path: "access", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "db"
      ? "export const db={execute:query=>globalThis.execute(query)};export const messagesTable={id:'messages.id'};"
      : args.path === "sql" ? "export const sql=(strings,...values)=>strings.reduce((text,part,i)=>text+part+(values[i]??''),'');"
      : "export const admitsTestEnrolment=()=>false;" }));
  } }],
});

async function isolate(execute: (query: string) => Promise<unknown>) {
  const module = { exports: {} };
  runInNewContext((await compilation).outputFiles![0].text, { module, exports: module.exports, execute });
  return module.exports as { ensureMessageSafety(): Promise<void> };
}
const names = ["message_blocks", "message_delivery_suppressions", "user_reports", "message_reaction_suppressions"];

test("all readiness DDL is additive, dependency-correct and shared by concurrent callers", async () => {
  const calls: string[] = [];
  let release!: () => void;
  const first = new Promise<void>(resolve => { release = resolve; });
  const safety = await isolate(async query => { calls.push(query); if (calls.length === 1) await first; });
  const pending = Array.from({ length: 20 }, () => safety.ensureMessageSafety());
  assert.ok(pending.every(value => value === pending[0]));
  assert.equal(calls.length, 1);
  release();
  await Promise.all(pending);
  assert.equal(calls.length, 4);
  calls.forEach((query, index) => {
    assert.match(query, new RegExp(`^CREATE TABLE IF NOT EXISTS ${names[index]} \\(`));
    assert.doesNotMatch(query, /\b(DROP|ALTER|TRUNCATE|UPDATE|DELETE FROM)\b/i);
    assert.match(query, /REFERENCES users\(id\)/);
  });
  assert.match(calls[1], /PRIMARY KEY REFERENCES messages\(id\) ON DELETE CASCADE/);
  assert.match(calls[2], /PRIMARY KEY REFERENCES disputes\(id\) ON DELETE CASCADE/);
  assert.match(calls[2], /REFERENCES users\(id\) ON DELETE RESTRICT/);
  assert.match(calls[3], /PRIMARY KEY REFERENCES message_reactions\(id\) ON DELETE CASCADE/);
  await safety.ensureMessageSafety();
  assert.equal(calls.length, 4);
});

test("each failed DDL phase rejects all readers, stops initialization and retries idempotently", async () => {
  for (let failureAt = 1; failureAt <= 4; failureAt++) {
    const calls: string[] = [];
    let fail = true;
    const safety = await isolate(async query => {
      calls.push(query);
      if (fail && calls.length === failureAt) throw new Error(`Synthetic DDL failure ${failureAt}`);
    });
    const pending = Array.from({ length: 12 }, () => safety.ensureMessageSafety());
    const results = await Promise.allSettled(pending);
    assert.ok(results.every(value => value.status === "rejected"));
    assert.equal(calls.length, failureAt); // Never advance while suppression readiness is unknown.
    fail = false;
    await safety.ensureMessageSafety();
    assert.equal(calls.length, failureAt + 4);
    assert.match(calls[failureAt], /CREATE TABLE IF NOT EXISTS message_blocks/);
    await safety.ensureMessageSafety();
    assert.equal(calls.length, failureAt + 4);
  }
});
