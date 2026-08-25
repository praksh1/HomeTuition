/**
 * The support desk's own door, and the accounts that come through it.
 *
 * The owner's decision: operators do not use the app's login. An administrator issues an ID and
 * a password that works once, and the operator replaces it before they can do anything —
 * so nobody, the administrator included, knows an operator's working password.
 *
 * The half that has to be proved against a running server rather than in a unit test is the
 * enforcement. A forced password change that only the *screen* insists on is a suggestion: the
 * token handed out at sign-in is a perfectly good token, and anything that can send an HTTP
 * request could skip the screen entirely. So every check below that matters goes straight at
 * the API with that token and expects to be refused.
 *
 * Usage: PGURL=... API_URL=http://127.0.0.1:8080 node scripts/operator-tests/run.mjs
 */
import { execFileSync } from "node:child_process";

const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";

let passed = 0, failed = 0; const failures = [];
const check = (n, ok, d = "") => { if (ok) { passed++; console.log(`  ok   ${n}`); } else { failed++; failures.push(`${n}${d ? ` — ${d}` : ""}`); console.log(`  FAIL ${n}${d ? ` — ${d}` : ""}`); } };
const sql = (s) => execFileSync("psql", [PGURL, "-tAc", s], { encoding: "utf8" }).trim();

async function api(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
}

let seq = 0;
async function register(role) {
  seq += 1;
  const email = `op_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: `${role} ${seq}`, email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10" }),
  } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status}`);
  return { ...res.body, email };
}

const stamp = Date.now().toString().slice(-6);
const signIn = (loginId, password) => api("/operator/login", { method: "POST", body: { loginId, password } });

async function run() {
  console.log("\nBootstrapping the first administrator\n");

  /*
   * Somebody has to be first, and it cannot be through the app — that is the whole design.
   * This is the one SQL step the owner performs once, and everything after it is the UI.
   */
  const seed = await register("student");
  sql(`update users set role = 'admin' where id = ${seed.user.id}`);
  sql(`insert into operator_accounts (user_id, login_id, is_administrator, must_change_password)
       values (${seed.user.id}, 'boss${stamp}', true, false)`);
  const boss = await signIn(`boss${stamp}`, "password123");
  check("the first administrator can sign in with their ID", boss.status === 200, `status=${boss.status}`);
  check("and is told they are one", boss.body?.operator?.isAdministrator === true);
  const bossToken = boss.body?.token;

  console.log("\nIssuing an operator ID\n");

  const made = await api("/operator/accounts", { method: "POST", token: bossToken, body: {
    loginId: `Bina.Karki${stamp}`, name: "Bina Karki",
  } });
  check("an administrator can create an operator", made.status === 201, `status=${made.status} ${JSON.stringify(made.body)}`);
  check("the ID is folded to one form", made.body?.loginId === `bina.karki${stamp}`, made.body?.loginId);
  check("and a one-time password comes back, once", /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(made.body?.oneTimePassword ?? ""),
    made.body?.oneTimePassword);
  const otp = made.body.oneTimePassword;

  /*
   * Only the hash is kept. If the password itself were recoverable, an administrator could act
   * as any operator and every name against a support decision would stop meaning anything.
   */
  const stored = sql(`select u.password_hash from users u
     join operator_accounts o on o.user_id = u.id where o.login_id = 'bina.karki${stamp}'`);
  check("only its hash is stored", stored.length > 20 && !stored.includes(otp), `stored=${stored.slice(0, 24)}…`);

  const listed = await api("/operator/accounts", { token: bossToken });
  const row = (listed.body?.operators ?? []).find((o) => o.loginId === `bina.karki${stamp}`);
  check("the new ID appears in the administrator's list", !!row);
  check("marked as not yet signed in", row?.awaitingFirstSignIn === true, JSON.stringify(row));
  check("and the list never carries a password", !JSON.stringify(listed.body).includes(otp));

  const dupe = await api("/operator/accounts", { method: "POST", token: bossToken, body: {
    loginId: `bina.karki${stamp}`, name: "Someone Else",
  } });
  check("the same ID cannot be issued twice", dupe.status === 409, `status=${dupe.status}`);

  console.log("\nThe one-time password buys exactly one thing\n");

  const first = await signIn(`bina.karki${stamp}`, otp);
  check("the operator can sign in with it", first.status === 200, `status=${first.status}`);
  check("and is told they must choose a password", first.body?.operator?.mustChangePassword === true);
  const freshToken = first.body?.token;

  /*
   * The check this whole suite exists for. The token is real; the screen is skippable.
   */
  const queue = await api("/admin/tickets", { token: freshToken });
  check("but that token opens nothing on the desk", queue.status === 403, `status=${queue.status}`);
  check("and says why, so the app can send them to the right screen",
    queue.body?.code === "must_change_password", JSON.stringify(queue.body));
  const people = await api("/admin/users", { token: freshToken });
  check("not the people screen either", people.status === 403, `status=${people.status}`);
  const overview = await api("/admin/overview", { token: freshToken });
  check("nor the overview", overview.status === 403, `status=${overview.status}`);

  console.log("\nChanging it\n");

  const noCurrent = await api("/operator/password", { method: "POST", token: freshToken, body: {
    newPassword: "a-brand-new-password",
  } });
  check("a change without the current password is refused", noCurrent.status === 401, `status=${noCurrent.status}`);

  const tooShort = await api("/operator/password", { method: "POST", token: freshToken, body: {
    currentPassword: otp, newPassword: "short",
  } });
  check("a short password is refused", tooShort.status === 400, `status=${tooShort.status}`);

  const sameAsId = await api("/operator/password", { method: "POST", token: freshToken, body: {
    currentPassword: otp, newPassword: `bina.karki${stamp}`,
  } });
  check("and one that is just the operator ID", sameAsId.status === 400, `status=${sameAsId.status}`);

  const stillShut = await api("/admin/tickets", { token: freshToken });
  check("none of those refusals opened the desk by accident", stillShut.status === 403, `status=${stillShut.status}`);

  const changed = await api("/operator/password", { method: "POST", token: freshToken, body: {
    currentPassword: otp, newPassword: "a-brand-new-password",
  } });
  check("a good password is accepted", changed.status === 200, `status=${changed.status} ${JSON.stringify(changed.body)}`);

  const nowOpen = await api("/admin/tickets", { token: freshToken });
  check("and the same token now opens the desk", nowOpen.status === 200, `status=${nowOpen.status}`);

  const oldPassword = await signIn(`bina.karki${stamp}`, otp);
  check("the one-time password no longer works", oldPassword.status === 401, `status=${oldPassword.status}`);
  const newPassword = await signIn(`bina.karki${stamp}`, "a-brand-new-password");
  check("their own does", newPassword.status === 200, `status=${newPassword.status}`);
  check("and they are no longer asked to change it", newPassword.body?.operator?.mustChangePassword === false);
  const operatorToken = newPassword.body?.token;

  console.log("\nWhat an operator may not do\n");

  const peek = await api("/operator/accounts", { token: operatorToken });
  check("an operator cannot see the list of operators", peek.status === 403, `status=${peek.status}`);
  const selfMade = await api("/operator/accounts", { method: "POST", token: operatorToken, body: {
    loginId: `sneaky${stamp}`, name: "Second Me", isAdministrator: true,
  } });
  check("nor create one", selfMade.status === 403, `status=${selfMade.status}`);
  check("and nothing was written for the attempt",
    sql(`select count(*) from operator_accounts where login_id = 'sneaky${stamp}'`) === "0");

  console.log("\nWho else is turned away\n");

  const student = await register("student");
  const teacher = await register("teacher");
  for (const [who, account] of [["a student", student], ["a teacher", teacher]]) {
    const asUser = await api("/operator/me", { token: account.token });
    check(`${who} is not an operator`, asUser.status === 403, `status=${asUser.status}`);
  }
  const wrongPassword = await signIn(`bina.karki${stamp}`, "not-the-password");
  check("a wrong password is refused", wrongPassword.status === 401, `status=${wrongPassword.status}`);
  const noSuchId = await signIn(`nobody${stamp}`, "not-the-password");
  check("and an ID that does not exist gets the identical answer",
    noSuchId.status === wrongPassword.status && noSuchId.body?.error === wrongPassword.body?.error,
    `${noSuchId.status} ${noSuchId.body?.error} vs ${wrongPassword.status} ${wrongPassword.body?.error}`);

  console.log("\nWithdrawing an ID\n");

  const opRow = (await api("/operator/accounts", { token: bossToken })).body.operators
    .find((o) => o.loginId === `bina.karki${stamp}`);
  const off = await api(`/operator/accounts/${opRow.id}/disabled`, { method: "POST", token: bossToken, body: { disabled: true } });
  check("an administrator can switch an ID off", off.status === 200, `status=${off.status}`);
  const afterOff = await signIn(`bina.karki${stamp}`, "a-brand-new-password");
  check("and they can no longer sign in", afterOff.status === 403, `status=${afterOff.status}`);
  check("told to ask their administrator", afterOff.body?.code === "operator_disabled", JSON.stringify(afterOff.body));
  const staleToken = await api("/admin/tickets", { token: operatorToken });
  check("a token issued before the switch-off stops working too", staleToken.status === 403, `status=${staleToken.status}`);

  const selfOff = await api(`/operator/accounts/${(await api("/operator/accounts", { token: bossToken })).body.operators.find((o) => o.loginId === `boss${stamp}`).id}/disabled`,
    { method: "POST", token: bossToken, body: { disabled: true } });
  check("an administrator cannot switch off their own ID", selfOff.status === 400, `status=${selfOff.status}`);
  check("and is still signed in afterwards",
    (await api("/operator/accounts", { token: bossToken })).status === 200);

  const back = await api(`/operator/accounts/${opRow.id}/disabled`, { method: "POST", token: bossToken, body: { disabled: false } });
  check("an ID can be put back in service", back.status === 200, `status=${back.status}`);
  check("and works again", (await signIn(`bina.karki${stamp}`, "a-brand-new-password")).status === 200);

  console.log("\nForgetting a password\n");

  const reissued = await api(`/operator/accounts/${opRow.id}/password`, { method: "POST", token: bossToken });
  check("an administrator can issue a fresh one", reissued.status === 200, `status=${reissued.status}`);
  check("which is a new one", reissued.body?.oneTimePassword !== otp);
  const withOld = await signIn(`bina.karki${stamp}`, "a-brand-new-password");
  check("the operator's own password stops working", withOld.status === 401, `status=${withOld.status}`);
  const withNew = await signIn(`bina.karki${stamp}`, reissued.body.oneTimePassword);
  check("the new one works", withNew.status === 200, `status=${withNew.status}`);
  check("and they must choose again", withNew.body?.operator?.mustChangePassword === true);
  check("and the desk is shut until they do",
    (await api("/admin/tickets", { token: withNew.body.token })).status === 403);

  console.log("\nThe last administrator\n");

  const bossRow = (await api("/operator/accounts", { token: bossToken })).body.operators
    .find((o) => o.loginId === `boss${stamp}`);
  const second = await api("/operator/accounts", { method: "POST", token: bossToken, body: {
    loginId: `deputy${stamp}`, name: "Deputy", isAdministrator: true,
  } });
  check("a second administrator can be made", second.status === 201, `status=${second.status}`);
  const deputyRow = (await api("/operator/accounts", { token: bossToken })).body.operators
    .find((o) => o.loginId === `deputy${stamp}`);
  const offDeputy = await api(`/operator/accounts/${deputyRow.id}/disabled`, { method: "POST", token: bossToken, body: { disabled: true } });
  check("and withdrawn again while another remains", offDeputy.status === 200, `status=${offDeputy.status}`);

  /*
   * The desk cannot lock itself out of existence, and the rule that guarantees it is the
   * self-disable refusal above rather than the last-administrator count: an administrator is
   * always a live administrator, so withdrawing somebody else always leaves at least them.
   * What is checked here is the outcome that matters — after all that, an administrator is
   * still standing and can still issue IDs.
   */
  const stillRunning = await api("/operator/accounts", { method: "POST", token: bossToken, body: {
    loginId: `after${stamp}`, name: "Issued After The Cull",
  } });
  check("and the desk can still issue IDs afterwards", stillRunning.status === 201, `status=${stillRunning.status}`);
  const liveAdmins = sql(`select count(*) from operator_accounts where is_administrator and disabled_at is null`);
  check("with an administrator still standing", Number(liveAdmins) >= 1, `live=${liveAdmins}`);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) { failures.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
}

run().catch((err) => { console.error(err); process.exit(1); });
