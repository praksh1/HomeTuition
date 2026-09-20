/**
 * The video-settings check, driven in a real browser, on the screen the owner can actually reach.
 *
 * ## Why this suite exists at all
 *
 * There is already a script that answers "are the LiveKit credentials right?". The owner could
 * not run it, twice: first their checkout did not have it yet, then a `cmd.exe` line went into
 * PowerShell, where `&&` is not a statement separator. Two evenings lost to failures that had
 * nothing to do with video. The storage check learned the same lesson one release earlier — its
 * header records being sent to open an endpoint in a browser tab that could only ever answer
 * "Missing or invalid Authorization header".
 *
 * So the check lives on a button in the support desk, and a button nobody has clicked is not a
 * feature. This clicks it.
 *
 * ## The two cases, and why these two
 *
 * **A: a truncated secret and an `https://` address.** The likeliest real mistake — a paste
 * that was cut off, and the URL copied from the browser bar rather than from the connection
 * details. Nothing may be asked of LiveKit while this is true, because a second vague error
 * underneath a specific one leaves the reader holding two problems and no idea which caused
 * which.
 *
 * **B: correct settings, LiveKit unreachable.** Pointed at a closed port, so the connection is
 * refused locally and no test here ever touches the internet. This must come out **amber, not
 * red**: "the settings are right but this server cannot see livekit.cloud" is not a verdict on
 * the credentials, and painting it red sends somebody to regenerate a key that was fine. That
 * confusion is not hypothetical — this repository's own build environment produces exactly it.
 *
 * Both also assert the property that matters most: **the secret is never on the screen.** This
 * is read at the moment something is broken, which is precisely when people screenshot a page
 * and paste it into a chat.
 *
 * Usage: PGURL=... node scripts/video-check/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";
import { prepareBrowserAccount } from "../test-support/accountAccess.mjs";

/*
  `fileURLToPath`, not `new URL(...).pathname` — the second yields `/C:/...` on Windows and
  every path built from it then fails. The preflight this suite covers was broken that exact
  way, in the file written for the Windows machine it was meant to run on.
*/
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.env.CHECK_SITE_PORT ?? 8098);
const siteUrl = `http://localhost:${PORT}`;
const API_BAD = Number(process.env.CHECK_API_BAD_PORT ?? 8092);
const API_GOOD = Number(process.env.CHECK_API_GOOD_PORT ?? 8093);
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";
const serverRoot = path.resolve(appRoot, "..", "api-server");
const repoRoot = path.resolve(appRoot, "..", "..");

/*
  A port nothing is listening on, chosen by opening one and closing it again.

  This is what makes case B need no internet: `RoomServiceClient` gets ECONNREFUSED from the
  loopback interface immediately, which is the same class of failure as a firewall and reaches
  the same branch of `describeReachFailure`.
*/
const deadPort = await new Promise((resolve) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

let passed = 0, failed = 0; const failures = [];
const check = (n, ok, d = "") => { if (ok) { passed++; console.log(`   PASS  ${n}`); } else { failed++; failures.push(`${n} — ${d}`); console.log(`   FAIL  ${n} — ${d}`); } };
const sql = (s) => execFileSync("psql", [PGURL, "-tAc", s], { encoding: "utf8" }).trim();

async function api(base, p, o = {}) {
  const h = { "Content-Type": "application/json" };
  if (o.token) h.Authorization = `Bearer ${o.token}`;
  const r = await fetch(`${base}/api${p}`, { method: o.method ?? "GET", headers: h, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch { b = { raw: t }; }
  return { status: r.status, body: b };
}

/*
  The secret both servers are given.

  Deliberately not a word: an earlier unit test asserted a leak by searching for "short" and
  failed against the message "too short to be a real one". A needle that could have come from
  the prose proves nothing either way.
*/
const SECRET_GOOD = "Zq7x".repeat(11);
const SECRET_TRUNCATED = "Zq7x";

const base = {
  ...process.env,
  DATABASE_URL: PGURL,
  SESSION_SECRET: process.env.SESSION_SECRET ?? "video-check-test-secret",
  VIDEO_PROVIDER: "livekit",
  LIVEKIT_API_KEY: "APIvideocheck01",
};

/** A: the paste was cut off, and the address came from the browser bar. */
const apiBad = spawn(process.execPath, [path.join(serverRoot, "dist", "index.mjs")], {
  cwd: repoRoot,
  env: { ...base, PORT: String(API_BAD), LIVEKIT_API_SECRET: SECRET_TRUNCATED, LIVEKIT_URL: "https://fadko-test.livekit.cloud" },
  stdio: "ignore",
});

/** B: everything correct, and nothing at the other end. */
const apiGood = spawn(process.execPath, [path.join(serverRoot, "dist", "index.mjs")], {
  cwd: repoRoot,
  env: { ...base, PORT: String(API_GOOD), LIVEKIT_API_SECRET: SECRET_GOOD, LIVEKIT_URL: `wss://127.0.0.1:${deadPort}` },
  stdio: "ignore",
});

const server = spawn(process.execPath, [path.join(appRoot, "server", "serve.js")], { cwd: appRoot, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
const stop = () => {
  for (const p of [server, apiBad, apiGood]) { try { p.kill(); } catch {} }
};
process.on("exit", stop);

for (let i = 0; i < 40; i++) { try { if ((await fetch(siteUrl)).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
for (const port of [API_BAD, API_GOOD]) {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/healthz`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
}

const BAD = `http://127.0.0.1:${API_BAD}`;
const GOOD = `http://127.0.0.1:${API_GOOD}`;

const stamp = Date.now();
const account = (await api(BAD, "/auth/register", { method: "POST", body: {
  name: "Owner", email: `vchk_${stamp}@example.com`, password: "password123", role: "student", grade: "10", dateOfBirth: "2000-01-01",
} })).body;
prepareBrowserAccount(account.user.id);
sql(`update users set role = 'admin' where id = ${account.user.id}`);
const agent = (await api(BAD, "/auth/login", { method: "POST", body: {
  email: `vchk_${stamp}@example.com`, password: "password123",
} })).body;

/* ---------- The door, before the screen ---------- */

const anonymous = await api(BAD, "/admin/video/check");
check("the endpoint alone tells a browser nothing", anonymous.status === 401, `status=${anonymous.status}`);

const student = (await api(BAD, "/auth/register", { method: "POST", body: {
  name: "Student", email: `vchks_${stamp}@example.com`, password: "password123", role: "student", grade: "10", dateOfBirth: "2000-01-01",
} })).body;
prepareBrowserAccount(student.user.id);
check("a student cannot run the check", (await api(BAD, "/admin/video/check", { token: student.token })).status === 403);

/* ---------- The screen ---------- */

const chromium = await getChromium();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on("dialog", async (d) => { await d.accept(); });
const builtApi = (process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");

/** Point the built app at whichever of the two servers this case is about. */
let target = BAD;
await page.route(`${builtApi}/**`, async (route) => {
  await route.continue({ url: route.request().url().replace(builtApi, target) });
});
await page.addInitScript((tok) => window.localStorage.setItem("@sikshya_token", tok), agent.token);

async function runCheck() {
  await page.goto(`${siteUrl}/(admin)`, { waitUntil: "networkidle" });
  await page.waitForTimeout(4500);
  const button = page.locator('[data-testid="admin-video-check"]');
  if (await button.count() === 0) return null;
  await button.first().click();
  await page.waitForTimeout(3500);
  return page.evaluate(() => document.body.innerText);
}

/* ---------- Case A: a truncated secret and the wrong scheme ---------- */

console.log("\n  A — the paste was cut off, and the address came from the browser bar\n");

const bodyA = await runCheck();
const snipA = (bodyA ?? "").slice(0, 900).replace(/\n/g, " | ");
check("the support desk offers the check", bodyA !== null);
check("it says the secret is too short", /too short to be a real one/i.test(bodyA), snipA);
check("and calls it a cut-off paste, not a wrong key", /cut off|copy it again/i.test(bodyA), snipA);
check("it spells out the wss:// address that was meant", /wss:\/\/fadko-test\.livekit\.cloud/.test(bodyA), snipA);
/*
  Nothing is asked of LiveKit while a setting is already known to be wrong. If the reach check
  had run, its wording would be here — and the reader would be holding two problems.
*/
check("and nothing is asked of LiveKit yet", !/could not reach|accepted the credentials|refused the key/i.test(bodyA), snipA);
check("no part of the secret is on the screen", !/Zq7x/.test(bodyA), snipA);

/*
  Every remedy names the place, not just one of them.

  The first version of this suite asserted that "Railway" appeared anywhere on the page and
  passed while both actual remedies — "copy it again from the dashboard" and "change https:// to
  wss://" — said nothing about where to make the change. That is the destination-not-route
  failure this project has already paid for twice, caught only because the word happened to be
  absent. Asserted per finding now, so a remedy cannot go vague again without failing.
*/
const remediesA = (await api(BAD, "/admin/video/check", { token: agent.token })).body.findings.filter((f) => f.fix);
check("every remedy names where to make the change",
  remediesA.length >= 2 && remediesA.every((f) => /Railway/.test(f.fix)),
  JSON.stringify(remediesA.map((f) => f.fix)));

/* ---------- Case B: right settings, nothing at the other end ---------- */

console.log("\n  B — the settings are right and this server cannot see LiveKit\n");

target = GOOD;
const bodyB = await runCheck();
const snipB = (bodyB ?? "").slice(0, 900).replace(/\n/g, " | ");
check("the key is accepted as well-formed", /API key is set/i.test(bodyB), snipB);
check("the secret is accepted as full length", /not shown/i.test(bodyB), snipB);
check("a join token can be signed", /join token can be signed/i.test(bodyB), snipB);
/*
  The distinction this whole module exists to draw. "Cannot reach" must never be worded as a
  verdict on the credentials.
*/
check("being unable to reach LiveKit is not blamed on the credentials",
  /cannot reach/i.test(bodyB) && !/refused the key/i.test(bodyB), snipB);
check("and it says so at the top rather than making the reader work it out",
  /could not open a connection to LiveKit to double-check/i.test(bodyB), snipB);
check("no part of the secret is on the screen", !/Zq7x/.test(bodyB), snipB);

/*
  The response body, not just the rendering. The screen could be hiding a secret the API sent,
  and a value that reached the browser has already left the server.
*/
const raw = JSON.stringify((await api(GOOD, "/admin/video/check", { token: agent.token })).body);
check("and the API never sent it in the first place", !raw.includes("Zq7x"), raw.slice(0, 400));
check("the length is reported instead", /44 characters/.test(raw), raw.slice(0, 400));

await browser.close(); stop();
console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) { console.log("\nFailures:"); failures.forEach(f => console.log("  - " + f)); }
process.exit(failed === 0 ? 0 : 1);
