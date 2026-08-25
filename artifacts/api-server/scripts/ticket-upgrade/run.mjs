/**
 * The upgrade the owner's own server has to survive.
 *
 * The live database has `dispute_status` with three values, a `disputes` table without the
 * three new columns, and no `ticket_events` at all. Nobody is going to run a migration by hand
 * on it — Railway redeploys on push and the server has to come up regardless. So the boot guard
 * in lib/ensureSchema.ts does the work, and this proves it does.
 *
 * The proof is not "the columns appeared". It is that a request filed *before* any of this
 * existed still reads correctly to the person who filed it, and can still be answered — which
 * is the only thing the owner's existing reporters would notice.
 *
 * Usage: PGURL=postgres://postgres@127.0.0.1:55432/postgres node scripts/ticket-upgrade/run.mjs
 */
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..");
const ADMIN = process.env.PGURL ?? "postgres://postgres@127.0.0.1:55432/postgres";
const DB = process.env.UPGRADE_DB ?? "ht_upgrade_check";
const base = ADMIN.replace(/\/[^/]*$/, "");
const TARGET = `${base}/${DB}`;
const PORT = Number(process.env.UPGRADE_PORT ?? 8090);
const API = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0; const failures = [];
const check = (n, ok, d = "") => { if (ok) { passed++; console.log(`  ok   ${n}`); } else { failed++; failures.push(`${n}${d ? ` — ${d}` : ""}`); console.log(`  FAIL ${n}${d ? ` — ${d}` : ""}`); } };
const psql = (url, q) => execFileSync("psql", [url, "-tAc", q], { encoding: "utf8" }).trim();

async function api(p, o = {}) {
  const h = { "Content-Type": "application/json" };
  if (o.token) h.Authorization = `Bearer ${o.token}`;
  const r = await fetch(`${API}/api${p}`, { method: o.method ?? "GET", headers: h, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch { b = { raw: t }; }
  return { status: r.status, body: b };
}

console.log("\nA database the way the live one looks today\n");

psql(ADMIN, `drop database if exists "${DB}"`);
psql(ADMIN, `create database "${DB}"`);
execFileSync("pnpm", ["run", "db:push"], {
  cwd: ROOT, encoding: "utf8", stdio: "pipe", env: { ...process.env, DATABASE_URL: TARGET },
});
execFileSync("psql", [TARGET, "-q", "-f", path.join(path.dirname(new URL(import.meta.url).pathname), "downgrade.sql")],
  { encoding: "utf8", stdio: "pipe" });

const statuses = () => psql(TARGET,
  "select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='dispute_status'");
check("it starts with only the three statuses it used to have",
  statuses() === "open,in_review,resolved", statuses());
check("and no history table", psql(TARGET, "select count(*) from information_schema.tables where table_name='ticket_events'") === "0");

/*
 * A reporter and a request that both predate this change — which is what the owner's database
 * is full of. The old status is `in_review`, a word this app no longer offers.
 */
// A placeholder hash: this account exists to own an old ticket, and never signs in. The agent
// below registers through the API like a real one.
const hash = "$2b$10$notarealhashthisaccountneversignsin000000000000000000";
psql(TARGET, `insert into users (name, email, password_hash, role) values ('Old Reporter', 'old@example.com', '${hash}', 'student')`);
const reporter = psql(TARGET, "select id from users where email='old@example.com'");
// Inserted and then read back, rather than using RETURNING: psql prints the command tag to
// stdout alongside the returned value, so the id would arrive with "INSERT 0 1" attached to it.
psql(TARGET,
  `insert into disputes (user_id, reason, description, status) values (${reporter}, 'Other', 'Filed before the upgrade.', 'in_review')`);
const oldTicket = psql(TARGET, `select id from disputes where user_id = ${reporter} order by id desc limit 1`);

console.log("\nThe server comes up on it\n");

const server = spawn("node", ["artifacts/api-server/dist/index.mjs"], {
  cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, DATABASE_URL: TARGET, PORT: String(PORT), SESSION_SECRET: "upgrade-check-only" },
});
let log = "";
server.stdout.on("data", (d) => { log += d.toString(); });
server.stderr.on("data", (d) => { log += d.toString(); });
const stop = () => { try { server.kill(); } catch { /* already gone */ } };
process.on("exit", stop);

for (let i = 0; i < 60; i++) {
  if (/ticket lifecycle is present|could not add the ticket lifecycle/.test(log)) break;
  await wait(500);
}
check("it starts, and says the lifecycle is in place", /ticket lifecycle is present/.test(log),
  log.split("\n").filter((l) => /ticket|error/i.test(l)).slice(0, 2).join(" | "));

check("the statuses it needs are all there now",
  statuses() === "open,in_review,resolved,opened,assigned,processing,denied,cancelled", statuses());
check("the columns it needs are there",
  psql(TARGET, "select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_name='disputes' and column_name in ('assigned_to','assigned_at','updated_at')")
    === "assigned_at,assigned_to,updated_at");
check("and the history table",
  psql(TARGET, "select count(*) from information_schema.tables where table_name='ticket_events'") === "1");

/*
 * Running it twice must be the same as running it once — Railway restarts for all sorts of
 * reasons, and a guard that only works on a database it has never seen is a guard that breaks
 * the second time it matters.
 */
stop();
await wait(1500);
const again = spawn("node", ["artifacts/api-server/dist/index.mjs"], {
  cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, DATABASE_URL: TARGET, PORT: String(PORT), SESSION_SECRET: "upgrade-check-only" },
});
let log2 = "";
again.stdout.on("data", (d) => { log2 += d.toString(); });
again.stderr.on("data", (d) => { log2 += d.toString(); });
process.on("exit", () => { try { again.kill(); } catch { /* already gone */ } });
for (let i = 0; i < 60; i++) {
  if (/ticket lifecycle is present|could not add the ticket lifecycle/.test(log2)) break;
  await wait(500);
}
check("starting again changes nothing and complains about nothing",
  /ticket lifecycle is present/.test(log2) && !/could not add/.test(log2),
  log2.split("\n").filter((l) => /ticket/i.test(l)).slice(0, 2).join(" | "));

console.log("\nA request filed before any of this existed\n");

const agent = await api("/auth/register", { method: "POST", body: {
  name: "Upgrade Agent", email: "upgrade_agent@example.com", password: "password123", role: "student", grade: "10",
} });
psql(TARGET, `update users set role='admin' where email='upgrade_agent@example.com'`);
const agentToken = (await api("/auth/login", { method: "POST", body: {
  email: "upgrade_agent@example.com", password: "password123",
} })).body?.token ?? agent.body?.token;

const seen = await api(`/admin/tickets/${oldTicket}`, { token: agentToken });
check("an agent can open it", seen.status === 200, `status=${seen.status}`);
check("and it has a number to quote", seen.body?.ticket?.ref === `HT-${String(oldTicket).padStart(6, "0")}`,
  seen.body?.ticket?.ref);
/*
 * `in_review` is a word this app no longer offers, and two words for one state is how somebody
 * ends up asking what the difference is. It folds into "Being worked on" rather than being
 * rewritten in the database, so nothing about the owner's existing rows has to change.
 */
check("its retired status reads as the one that replaced it",
  seen.body?.ticket?.statusLabel === "Being worked on", seen.body?.ticket?.statusLabel);
check("and the desk offers the endings it allows",
  (seen.body?.nextStatuses ?? []).some((n) => n.value === "resolved"),
  JSON.stringify((seen.body?.nextStatuses ?? []).map((n) => n.value)));

const answered = await api(`/admin/tickets/${oldTicket}`, { method: "PATCH", token: agentToken, body: {
  status: "resolved", resolution: "Sorted after the upgrade.",
} });
check("it can still be answered", answered.body?.ticket?.status === "resolved",
  `status=${answered.status} ${JSON.stringify(answered.body).slice(0, 160)}`);
check("and the answer is recorded, even though its earlier steps were not",
  (answered.body?.history ?? []).some((h) => h.note === "Sorted after the upgrade."),
  JSON.stringify((answered.body?.history ?? []).map((h) => h.label)));

stop();
try { again.kill(); } catch { /* already gone */ }
await wait(800);
psql(ADMIN, `drop database if exists "${DB}"`);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failures.length) { failures.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
