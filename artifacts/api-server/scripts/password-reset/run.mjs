/**
 * The emailed password-reset link.
 *
 * There were no tests for this flow at all, which is how a defect report about it — the owner
 * using what appeared to be a two-day-old link — had nothing to check itself against.
 *
 * That report could not be reproduced. Both server paths refuse an expired token, production runs
 * byte-identical code, and the app surfaces the refusal rather than showing a false success. The
 * checks below pin down every property the report would have violated, so the next report has
 * something to contradict.
 *
 * Tokens are inserted directly where the plaintext is needed: only a SHA-256 hash is ever stored,
 * so a test cannot read back a link the server emailed. Inserting a row with a known plaintext
 * exercises exactly the same consume path.
 *
 * Usage: PGURL=... API_URL=http://127.0.0.1:8080 node scripts/password-reset/run.mjs
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const sql = (s) => execFileSync("psql", [PGURL, "-v", "ON_ERROR_STOP=1", "-tAc", s], { encoding: "utf8" }).trim();

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
}

let seq = 0;
async function register(password = "password123") {
  seq += 1;
  const email = `reset_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: `Reset Tester ${seq}`, email, password, role: "student",
    grade: "10", dateOfBirth: "2000-01-01" } });
  if (res.status > 201) throw new Error(`register: ${res.status} ${JSON.stringify(res.body)}`);
  const id = Number(sql(`select id from users where email = '${email}'`));
  return { id, email, password };
}

/** A reset link with a plaintext this test knows, issued and expiring when we say. */
function plantToken(userId, { minutesFromNow = 30, ageMinutes = 0 } = {}) {
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  sql(`insert into account_tokens (user_id, purpose, token_hash, expires_at, created_at)
       values (${userId}, 'reset_password', '${hash}',
               now() + interval '${minutesFromNow} minutes',
               now() - interval '${ageMinutes} minutes')`);
  return token;
}

const canSignIn = async (email, password) =>
  (await api("/auth/login", { method: "POST", body: { email, password } })).status === 200;

async function main() {
  console.log("\nThe request tells an attacker nothing\n");
  {
    const user = await register();
    const known = await api("/auth/password/forgot", { method: "POST", body: { email: user.email } });
    const unknown = await api("/auth/password/forgot", { method: "POST", body: { email: `nobody_${Date.now()}@example.com` } });

    check("a known and an unknown address get the same status", known.status === unknown.status,
      `${known.status} vs ${unknown.status}`);
    check("and the same message", known.body?.message === unknown.body?.message,
      `${known.body?.message} vs ${unknown.body?.message}`);
    /*
      The cooldown must be a constant, not the real remaining time. Returning what is genuinely
      left would answer "does this address have an account?" for anybody who asked twice, undoing
      the generic message above.
    */
    check("and the same resend cooldown", known.body?.resendAfterSeconds === unknown.body?.resendAfterSeconds,
      `${known.body?.resendAfterSeconds} vs ${unknown.body?.resendAfterSeconds}`);
    check("which the screen can draw a timer from", known.body?.resendAfterSeconds === 60,
      String(known.body?.resendAfterSeconds));
  }

  console.log("\nA link is good once, for thirty minutes\n");
  {
    const user = await register();
    const token = plantToken(user.id);
    const first = await api("/auth/password/reset", { method: "POST", body: { token, password: "chosenbyme1" } });
    check("a fresh link works", first.status === 200, `status ${first.status} ${JSON.stringify(first.body)}`);
    check("and the new password signs in", await canSignIn(user.email, "chosenbyme1"));
    check("and the old one does not", !(await canSignIn(user.email, user.password)));

    const again = await api("/auth/password/reset", { method: "POST", body: { token, password: "somethingelse2" } });
    check("the same link cannot be used twice", again.status === 400, `status ${again.status}`);
    check("and the second attempt changed nothing", await canSignIn(user.email, "chosenbyme1"));
  }

  {
    const user = await register();
    // Issued 48 hours ago and long expired — the exact shape of the owner's report.
    const stale = plantToken(user.id, { minutesFromNow: -2865, ageMinutes: 2880 });
    const res = await api("/auth/password/reset", { method: "POST", body: { token: stale, password: "shouldnotwork1" } });
    check("a two-day-old link is refused", res.status === 400, `status ${res.status} ${JSON.stringify(res.body)}`);
    check("and the account keeps its password", await canSignIn(user.email, user.password));
  }

  {
    const user = await register();
    // One second past the boundary, to prove the expiry is the thing being checked.
    const justExpired = plantToken(user.id, { minutesFromNow: -0.02, ageMinutes: 31 });
    const res = await api("/auth/password/reset", { method: "POST", body: { token: justExpired, password: "shouldnotwork1" } });
    check("a link one moment past thirty minutes is refused", res.status === 400, `status ${res.status}`);
  }

  console.log("\nAsking again cancels the older link\n");
  {
    const user = await register();
    const first = plantToken(user.id);
    const firstHash = createHash("sha256").update(first).digest("hex");

    /*
      The real issuing path is used here rather than another planted row, because invalidating
      older tokens is `issueToken`'s job and that is what needs proving. The planted row is
      backdated past the 60-second resend window first, or the server declines to issue at all.
    */
    sql(`update account_tokens set created_at = now() - interval '5 minutes'
          where token_hash = '${firstHash}'`);
    await api("/auth/password/forgot", { method: "POST", body: { email: user.email } });

    const spent = sql(`select used_at is not null from account_tokens where token_hash = '${firstHash}'`);
    check("issuing a new link spends the previous one", spent === "t", spent);

    const res = await api("/auth/password/reset", { method: "POST", body: { token: first, password: "oldlinkwins1" } });
    check("so the older link no longer works", res.status === 400, `status ${res.status}`);
    check("and the password is untouched", await canSignIn(user.email, user.password));
  }

  console.log("\nThe new password cannot be the current one\n");
  {
    const user = await register();
    const token = plantToken(user.id);
    const same = await api("/auth/password/reset", { method: "POST", body: { token, password: user.password } });
    check("reusing the current password is refused", same.status === 400, `status ${same.status}`);
    check("and is told apart from an expired link", same.body?.code === "SAME_PASSWORD",
      JSON.stringify(same.body));
    /*
      Salted hashes are why this check has to run through verifyPassword. Comparing the two hash
      strings would never match, so the refusal above proves the comparison is real.
    */
    check("the message says what to do", /different from your current password/i.test(same.body?.error ?? ""),
      same.body?.error);

    // A typo must not cost the person their link.
    const after = await api("/auth/password/reset", { method: "POST", body: { token, password: "adifferentone1" } });
    check("the link survives that refusal and still works", after.status === 200, `status ${after.status}`);
    check("and the different password signs in", await canSignIn(user.email, "adifferentone1"));
  }

  console.log("\nTwo submissions at once change the password once\n");
  {
    const user = await register();
    const token = plantToken(user.id);
    const [a, b] = await Promise.all([
      api("/auth/password/reset", { method: "POST", body: { token, password: "racewinner111" } }),
      api("/auth/password/reset", { method: "POST", body: { token, password: "raceloser2222" } }),
    ]);
    const wins = [a, b].filter((r) => r.status === 200).length;
    check("exactly one of two simultaneous submits succeeds", wins === 1,
      `a=${a.status} b=${b.status}`);

    const winner = a.status === 200 ? "racewinner111" : "raceloser2222";
    const loser = a.status === 200 ? "raceloser2222" : "racewinner111";
    check("the winner's password is the one on the account", await canSignIn(user.email, winner));
    check("and the loser's is not", !(await canSignIn(user.email, loser)));

    const spent = sql(`select count(*) from account_tokens
                        where user_id = ${user.id} and purpose = 'reset_password' and used_at is null`);
    check("no unused reset token is left behind", spent === "0", spent);
  }

  console.log("\nThe token never reaches a log\n");
  {
    const user = await register();
    const token = plantToken(user.id);
    await api("/auth/password/reset", { method: "POST", body: { token, password: "loggingcheck1" } });
    const leaked = sql(`select count(*) from activity_log where detail::text like '%${token.slice(0, 24)}%'`);
    check("the reset token is not written to the activity log", leaked === "0", leaked);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
