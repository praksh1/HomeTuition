/**
 * The teacher's dashboard, from a screenshot a teacher sent.
 *
 * Two things were wrong on the one screen they open every day: classes from last week sat under
 * "Upcoming Sessions" with a Start button that refuses when pressed, and every date was
 * Gregorian for somebody whose whole app is in Bikram Sambat.
 *
 * Usage: PGURL=... node scripts/dashboard-tests/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { getChromium } from "../board-tests/harness.mjs";
import { prepareBrowserAccount } from "../test-support/accountAccess.mjs";

const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const PORT = Number(process.env.DASH_SITE_PORT ?? 8099);
const siteUrl = `http://localhost:${PORT}`;
const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";
let passed = 0, failed = 0; const failures = [];
const check = (n, ok, d = "") => { if (ok) { passed++; console.log(`   PASS  ${n}`); } else { failed++; failures.push(`${n} — ${d}`); console.log(`   FAIL  ${n} — ${d}`); } };
const sql = (s) => execFileSync("psql", [PGURL, "-tAc", s], { encoding: "utf8" }).trim();
async function api(p, o = {}) {
  const h = { "Content-Type": "application/json" };
  if (o.token) h.Authorization = `Bearer ${o.token}`;
  const r = await fetch(`${API}/api${p}`, { method: o.method ?? "GET", headers: h, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch { b = { raw: t }; }
  return { status: r.status, body: b };
}
const server = spawn(process.execPath, [path.join(appRoot, "server", "serve.js")], { cwd: appRoot, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
const stop = () => { try { server.kill(); } catch {} };
process.on("exit", stop);
for (let i = 0; i < 40; i++) { try { if ((await fetch(siteUrl)).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }

const email = `dash_${Date.now()}@example.com`;
const t = (await api("/auth/register", { method: "POST", body: { name: "Dash Teacher", email, password: "password123", role: "teacher", subject: "Maths", bio: "x" } })).body;
prepareBrowserAccount(t.user.id);
sql(`update teacher_profiles set approval_status = 'approved', subscription_active = true where user_id = ${t.user.id}`);

// One class still to come, and one that came and went without being started.
const soon = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
await api("/sessions", { method: "POST", token: t.token, body: { subject: "Maths", topic: "Still to come", date: soon, duration: 60, maxStudents: 20, price: 500 } });
const stale = await api("/sessions", { method: "POST", token: t.token, body: { subject: "Maths", topic: "Never started", date: soon, duration: 60, maxStudents: 20, price: 500 } });
if (!stale.body?.id) { console.error('create failed:', stale.status, JSON.stringify(stale.body)); process.exit(1); }
sql(`update sessions set date = now() - interval '4 days' where id = ${stale.body.id}`);

const listed = await api(`/sessions?teacherId=${t.user.id}&status=upcoming&limit=40`, { token: t.token });
const staleRow = (listed.body.sessions ?? []).find((s) => s.id === stale.body.id);
check("the server says which classes are over", staleRow?.expired === true, JSON.stringify(staleRow)?.slice(0, 140));
const freshRow = (listed.body.sessions ?? []).find((s) => s.topic === "Still to come");
check("and which are not", freshRow?.expired === false, JSON.stringify(freshRow)?.slice(0, 140));

const chromium = await getChromium();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on("dialog", async (d) => { await d.accept(); });
await page.addInitScript((tok) => window.localStorage.setItem("@sikshya_token", tok), t.token);
await page.goto(`${siteUrl}/(teacher)`, { waitUntil: "networkidle" });
await page.waitForTimeout(4500);
const body = await page.evaluate(() => document.body.innerText);

check("a class still to come is on the dashboard", /Still to come/.test(body), body.slice(0, 400).replace(/\n/g, " | "));
check("a class that came and went is not", !/Never started/.test(body), body.slice(0, 500).replace(/\n/g, " | "));
check("and the teacher is told they exist", /passed without being started/i.test(body), body.slice(0, 500).replace(/\n/g, " | "));

/*
 * The date, in the calendar the teacher reads. Bikram Sambat is the default, and its month
 * names appear nowhere in a Gregorian rendering — so this cannot pass on the wrong one.
 */
check("dates are in Bikram Sambat, not Gregorian",
  /Baisakh|Jestha|Ashadh|Shrawan|Bhadra|Ashwin|Kartik|Mangsir|Poush|Magh|Falgun|Chaitra/.test(body),
  body.slice(0, 500).replace(/\n/g, " | "));

await browser.close(); stop();
console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) { console.log("\nFailures:"); failures.forEach(f => console.log("  - " + f)); }
process.exit(failed === 0 ? 0 : 1);
