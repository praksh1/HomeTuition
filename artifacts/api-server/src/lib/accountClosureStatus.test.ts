import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import type { db } from "@workspace/db";
import { accountClosureCompleted } from "./accountClosureStatus.ts";

function sourceFor(rows: Array<Array<Record<string, unknown>> | Error>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const dialect = new PgDialect();
  const source = { execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
    calls.push(dialect.sqlToQuery(query));
    const next = rows.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, "Unexpected database read");
    return { rows: next };
  } } as unknown as Pick<typeof db, "execute">;
  return { source, calls };
}

test("legacy deployments without a closure table remain available after only a presence read", async () => {
  const { source, calls } = sourceFor([[{ table_name: null }]]);
  assert.equal(await accountClosureCompleted(42, source), false);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /to_regclass\('account_closure_requests'\)/);
});

test("only a completed closure matches, and the user ID is a bound query parameter", async () => {
  for (const closed of [false, true]) {
    const { source, calls } = sourceFor([[{ table_name: "account_closure_requests" }], closed ? [{ "?column?": 1 }] : []]);
    assert.equal(await accountClosureCompleted(42, source), closed);
    assert.equal(calls.length, 2);
    assert.match(calls[1]!.sql, /user_id=\$1 AND status='closed'/);
    assert.deepEqual(calls[1]!.params, [42]);
  }
});

test("presence and status read failures propagate rather than claiming an account is open", async () => {
  const scenarios: Array<Array<Array<Record<string, unknown>> | Error>> = [
    [Error("catalog unavailable")],
    [[{ table_name: "account_closure_requests" }], Error("status unavailable")],
  ];
  for (const rows of scenarios) {
    const { source } = sourceFor(rows);
    await assert.rejects(accountClosureCompleted(42, source), /unavailable/);
  }
});

test("the narrow adapter cannot install closure/identity features and Store retains ordered fresh user locks", () => {
  const adapter = readFileSync(new URL("./accountClosureStatus.ts", import.meta.url), "utf8");
  assert.doesNotMatch(adapter, /identityAccountClosure|ensureIdentitySchema|ensureAccountClosureSchema|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bCREATE\b/);
  const store = readFileSync(new URL("./lessonRemedyStore.ts", import.meta.url), "utf8");
  assert.match(store, /import \{ accountClosureCompleted \} from "\.\/accountClosureStatus"/);
  assert.doesNotMatch(store, /from "\.\/accountClosureStore"/);
  const locks = store.slice(store.indexOf("async function openAccounts"), store.indexOf("async function allocationState"));
  assert.match(locks, /sort\(\(a, b\) => a - b\)/);
  assert.match(locks, /orderBy\(asc\(usersTable\.id\)\)\.for\("update"\)/);
  assert.match(locks, /rows\.length !== ids\.length \|\| rows\.some\(\(row\) => row\.suspendedAt\)/);
  assert.match(locks, /accountClosureCompleted\(id, tx\)/);
  assert.doesNotMatch(locks, /catch\b/);
});
