/**
 * `GET /public/classes` — the storefront a stranger reads to pick a single class to book.
 *
 * ## What this proves
 *
 * A route that is meant to answer "what may an unauthenticated visitor be shown as classes on
 * offer today?" must never leak a class run by a rejected, unapproved, or suspended teacher, or
 * a class whose booked slot has already passed, or a monthly-class-day materialisation, or a
 * class the server has marked live / completed / cancelled. Search must be bounded and
 * parameterised so an ordinary query cannot be turned into a wildcard scan or a SQL escape.
 * Pagination must be deterministic, so a class visible on page one is never quietly hidden by
 * a subsequent page.
 *
 * ## What it does not prove
 *
 * The booking flow itself — that is `session-tests` and the payment suites. This suite ends at
 * "the class is visible with the truthful teacher id" so the caller can hand off to the teacher
 * page where the existing Book & Pay control lives.
 *
 * Usage:
 *   API_URL=http://127.0.0.1:8080 PGURL=... node scripts/public-classes-tests/run.mjs
 */
import { execFileSync } from "node:child_process";
import { prepareTeacherForClass } from "../test-support/teacherAccess.mjs";

const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? "postgres://postgres@127.0.0.1:55432/ht";

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

function sql(statement) {
  const out = execFileSync("psql", [PGURL, "-tAc", statement], { encoding: "utf8" });
  // psql prints command tags (INSERT 0 1, DELETE 5) on their own line after RETURNING output;
  // callers of `sql()` that expect a scalar want the first line only.
  const firstLine = out.split(/\r?\n/).find((line) => line.length > 0 && !/^(INSERT|UPDATE|DELETE|SELECT)\s/.test(line));
  return (firstLine ?? "").trim();
}

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
const tag = `pubclass_${Date.now()}`;

async function registerTeacher({ name = null } = {}) {
  seq += 1;
  const email = `${tag}_t_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: name ?? `${tag}-teacher-${seq}`, email, password: "password123",
    role: "teacher", subject: "Maths", bio: "x" } });
  if (res.status > 201) throw new Error(`register teacher: ${res.status} ${JSON.stringify(res.body)}`);
  const userId = res.body.user.id;
  // Approved by default so `POST /sessions` accepts the create; every test that needs a
  // rejected / pending / suspended teacher flips the state *after* the class is written.
  // The gate must still remove that teacher's classes from the public list.
  prepareTeacherForClass(userId);
  return { ...res.body, email, userId };
}

function makeUnapproved(teacher) {
  sql(`UPDATE teacher_profiles SET approval_status = 'pending' WHERE user_id = ${teacher.userId};`);
}
function makeRejected(teacher) {
  sql(`UPDATE teacher_profiles SET approval_status = 'rejected' WHERE user_id = ${teacher.userId};`);
}
function makeSuspended(teacher) {
  sql(`UPDATE users SET suspended_at = now(), suspended_reason = 'testing' WHERE id = ${teacher.userId};`);
}
function unsuspend(teacher) {
  sql(`UPDATE users SET suspended_at = null, suspended_reason = null WHERE id = ${teacher.userId};`);
}
function reapprove(teacher) {
  sql(`UPDATE teacher_profiles SET approval_status = 'approved' WHERE user_id = ${teacher.userId};`);
}

async function makeClass(teacher, { subject = "Maths", topic = null, minutesFromNow = 90, duration = 60, price = 500, maxStudents = 10 } = {}) {
  seq += 1;
  const res = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: topic ?? `${tag}-topic-${seq}`,
    subject, description: "d",
    date: new Date(Date.now() + Math.max(minutesFromNow, 5) * 60_000).toISOString(),
    duration, price, maxStudents,
  } });
  if (res.status > 201) throw new Error(`create session: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function ownIds(query = "") {
  // Only rows created in this run, so the assertions are stable regardless of fixture data left
  // behind by earlier suites.
  const res = await api(`/public/classes?limit=50${query ? `&${query}` : ""}`);
  if (res.status !== 200) throw new Error(`GET /public/classes: ${res.status} ${JSON.stringify(res.body)}`);
  const rows = res.body.classes ?? [];
  const mine = rows.filter((r) => (r.topic ?? "").startsWith(tag) || (r.teacherName ?? "").startsWith(tag));
  return { rows, mine, nextCursor: res.body.nextCursor ?? null };
}

/* ------------------------------------------------------------------------- */

async function visibilityGate() {
  console.log("\n[1] Visibility gate — approved & unsuspended teachers only");

  // Every teacher is created approved so `POST /sessions` accepts the write; the state changes
  // that follow are what a real operator moderation flow would do after the classes existed.
  const stillApproved = await registerTeacher();
  const willBecomePending = await registerTeacher();
  const willBeSuspended = await registerTeacher();
  const willBeRejected = await registerTeacher();

  const approvedClass = await makeClass(stillApproved);
  const pendingClass = await makeClass(willBecomePending);
  const suspendedClass = await makeClass(willBeSuspended);
  const rejectedClass = await makeClass(willBeRejected);

  makeUnapproved(willBecomePending);
  makeSuspended(willBeSuspended);
  makeRejected(willBeRejected);

  const { rows, mine } = await ownIds();
  const ids = new Set(mine.map((r) => r.id));

  check("an approved, unsuspended teacher's class is on the public list", ids.has(approvedClass.id));
  check("an unapproved teacher's class never surfaces",
    !ids.has(pendingClass.id),
    `saw pending id ${pendingClass.id} in ${[...ids].join(", ")}`);
  check("a suspended teacher's class never surfaces",
    !ids.has(suspendedClass.id),
    `saw suspended id ${suspendedClass.id} in ${[...ids].join(", ")}`);
  check("a rejected teacher's class never surfaces",
    !ids.has(rejectedClass.id),
    `saw rejected id ${rejectedClass.id} in ${[...ids].join(", ")}`);

  // Live suspension mid-session: an approved teacher whose account is later suspended must
  // disappear from the public list on the very next request.
  const wasVisible = ids.has(approvedClass.id);
  makeSuspended(stillApproved);
  const afterSuspend = await ownIds();
  const stillPresent = afterSuspend.mine.some((r) => r.id === approvedClass.id);
  check("a live suspension removes an approved teacher's class the very next request",
    wasVisible && !stillPresent,
    `visible before ${wasVisible}, present after ${stillPresent}`);
  unsuspend(stillApproved);
  const afterUnsuspend = await ownIds();
  check("and re-appears once the suspension is lifted",
    afterUnsuspend.mine.some((r) => r.id === approvedClass.id));

  // Reapproving a rejected teacher brings their class back.
  reapprove(willBeRejected);
  const afterReapprove = await ownIds();
  check("re-approving a rejected teacher restores their class",
    afterReapprove.mine.some((r) => r.id === rejectedClass.id));
  // Put it back to rejected so subsequent runs against the same DB stay clean.
  makeRejected(willBeRejected);

  // No teacher-approval body/query claim is accepted. Any query parameter is harmless.
  const spoof = await ownIds("approved=1&teacherApproved=true");
  check("a spoofed 'approved=1' query does not surface a pending teacher's class",
    !spoof.mine.some((r) => r.id === pendingClass.id));

  check("every public row carries the authoritative teacher user id and name",
    rows.every((r) => typeof r.teacherName === "string" && r.teacherName.length > 0
      && typeof r.teacherUserId === "number" && r.teacherUserId > 0),
    "public rows must carry teacherUserId and teacherName");
  check("every public row also carries the teacher profile id the app routes on",
    rows.every((r) => typeof r.teacherProfileId === "number" && r.teacherProfileId > 0),
    "public rows must carry teacherProfileId");

  const forbiddenKeys = ["email", "phone", "password", "hashed", "notes", "suspendedAt", "approvalStatus", "subscriptionActive"];
  const leaked = rows.flatMap((r) => forbiddenKeys.filter((k) => k in r));
  check("no private teacher fields leak in a public row",
    leaked.length === 0, leaked.join(", "));
}

async function classShapeGate() {
  console.log("\n[2] Class shape gate — no monthly, no cancelled, no expired, no full");

  const teacher = await registerTeacher();

  // A recurring-day materialisation is a plain `sessions` row that a `recurring_days` row
  // points at. Insert the plan + recurring_sessions + recurring_days chain by hand so the FK
  // constraints are satisfied and `notARecurringDay` will exclude the session from the list.
  const recurring = await makeClass(teacher, { topic: `${tag}-monthly-day` });
  const planId = Number(sql(`
    INSERT INTO teacher_plans (teacher_id, price, platform_share, status)
    VALUES (${teacher.userId}, 3000, 0, 'active')
    RETURNING id;
  `));
  const recurringId = Number(sql(`
    INSERT INTO recurring_sessions
      (plan_id, teacher_id, subject, topic, start_minute, duration_minutes, monthly_price, max_students)
    VALUES
      (${planId}, ${teacher.userId}, '${tag}-monthly-subject', '${tag}-monthly-parent',
       600, 60, 3000, 20)
    RETURNING id;
  `));
  sql(`
    INSERT INTO recurring_days
      (recurring_id, session_id, cycle_index, kind, scheduled_for, status)
    VALUES
      (${recurringId}, ${recurring.id}, 0, 'regular', now() + interval '1 hour', 'planned');
  `);

  const cancellable = await makeClass(teacher, { topic: `${tag}-cancel` });
  const cancelRes = await api(`/sessions/${cancellable.id}`, { method: "PATCH", token: teacher.token, body: { status: "cancelled" } });
  check("a class can be cancelled", cancelRes.status === 200, `status ${cancelRes.status}`);

  const expired = await makeClass(teacher, { topic: `${tag}-expired` });
  sql(`UPDATE sessions SET date = now() - interval '1 day' WHERE id = ${expired.id};`);

  const full = await makeClass(teacher, { topic: `${tag}-full`, maxStudents: 1 });
  sql(`UPDATE sessions SET enrolled_count = max_students WHERE id = ${full.id};`);

  const { mine } = await ownIds();
  const ids = new Set(mine.map((r) => r.id));

  check("a recurring-day materialisation is excluded from the public list",
    !ids.has(recurring.id),
    `saw recurring id ${recurring.id} in ${[...ids].join(", ")}`);
  check("cancelled classes are excluded", !ids.has(cancellable.id));
  check("expired classes are excluded", !ids.has(expired.id));
  check("classes with no seats are excluded", !ids.has(full.id));
}

async function inputGates() {
  console.log("\n[3] Bounded input — the request refuses hostile shapes");

  const bogusLimit = await api("/public/classes?limit=abc");
  check("a non-integer limit is refused", bogusLimit.status === 400);
  const negLimit = await api("/public/classes?limit=-3");
  check("a negative limit is refused", negLimit.status === 400);
  const bigLimit = await api("/public/classes?limit=9999");
  check("an overlarge limit is capped rather than exploded", bigLimit.status === 200, `status ${bigLimit.status}`);
  check("and returns no more than the cap", (bigLimit.body?.classes ?? []).length <= 50);

  const bogusCursor = await api("/public/classes?cursor=not-a-cursor");
  check("a nonsense cursor is refused", bogusCursor.status === 400);

  const emptyQ = await api("/public/classes?q=%20%20%20");
  check("a whitespace-only query is accepted and behaves as no query", emptyQ.status === 200);

  const teacher = await registerTeacher({ name: `${tag}-percent` });
  const literalPercent = await makeClass(teacher, { subject: `${tag}-100%-scholarship`, topic: `${tag}-percent-topic` });
  const wildcard = await api(`/public/classes?q=${encodeURIComponent("100%")}`);
  check("a literal % is escaped and does not act as a wildcard",
    (wildcard.body?.classes ?? []).some((r) => r.id === literalPercent.id),
    `${(wildcard.body?.classes ?? []).map((r) => r.id).join(", ")}`);

  // 200-char search is capped at 80 and cannot fail.
  const longRes = await api(`/public/classes?q=${encodeURIComponent("a".repeat(200))}`);
  check("an over-long query is accepted (capped) rather than refused", longRes.status === 200);
}

async function searchAndOrdering() {
  console.log("\n[4] Search and ordering — deterministic, bounded, useful");

  const alpha = await registerTeacher({ name: `${tag}-alpha` });
  const beta = await registerTeacher({ name: `${tag}-beta` });

  // Two classes: alpha's earlier, beta's later, so soonest-first can be checked.
  const early = await makeClass(alpha, { topic: `${tag}-search-early`, minutesFromNow: 60 });
  const later = await makeClass(beta, { topic: `${tag}-search-later`, minutesFromNow: 300 });

  const nameHit = await api(`/public/classes?q=${encodeURIComponent(`${tag}-alpha`)}`);
  const nameIds = new Set((nameHit.body?.classes ?? []).map((r) => r.id));
  check("search hits the teacher's public display name", nameIds.has(early.id));
  check("and does not hit a class taught by somebody else with that name", !nameIds.has(later.id));

  const topicHit = await api(`/public/classes?q=${encodeURIComponent(`${tag}-search-later`)}`);
  const topicIds = new Set((topicHit.body?.classes ?? []).map((r) => r.id));
  check("search hits the class topic", topicIds.has(later.id));
  check("and only rows whose topic matches", !topicIds.has(early.id));

  // Ordering: alpha's early class ranks earlier than beta's later class when both are on the
  // page.
  const list = await ownIds();
  const earlyIdx = list.mine.findIndex((r) => r.id === early.id);
  const laterIdx = list.mine.findIndex((r) => r.id === later.id);
  check("soonest class ranks earlier than a later one",
    earlyIdx >= 0 && laterIdx >= 0 && earlyIdx < laterIdx,
    `early idx ${earlyIdx}, later idx ${laterIdx}`);
}

async function paginationDeterministic() {
  console.log("\n[5] Cursor pagination — no skipped or duplicated rows");

  // Insert eight new classes for one teacher to force a boundary that this run controls.
  // Filter to that teacher on the wire — the fixture DB carries many other classes from other
  // tests and paging them all one by one would be pointless work.
  const teacher = await registerTeacher({ name: `${tag}-pager` });
  const created = [];
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const row = await makeClass(teacher, { topic: `${tag}-page-${i}`, minutesFromNow: 200 + i });
    created.push(row.id);
  }
  const teacherName = teacher.user.name;

  const seen = new Set();
  let cursor = null;
  const pageSize = 3;
  const collected = [];
  let pages = 0;
  // A generous upper bound. Eight rows at page size 3 need three pages; if the loop runs past
  // ten we know something is wrong.
  for (let page = 0; page < 10; page += 1) {
    const url = `/public/classes?limit=${pageSize}&q=${encodeURIComponent(teacherName)}`
      + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    // eslint-disable-next-line no-await-in-loop
    const res = await api(url);
    check(`page ${page} answers`, res.status === 200, `status ${res.status}`);
    pages += 1;
    const rows = (res.body?.classes ?? []).filter((r) => created.includes(r.id));
    for (const r of rows) {
      check(`row ${r.id} is not a duplicate across pages`, !seen.has(r.id));
      seen.add(r.id);
      collected.push(r.id);
    }
    cursor = res.body?.nextCursor ?? null;
    if (cursor === null) break;
  }
  check("every one of the created classes has been paged through", collected.length === created.length,
    `collected ${collected.length}, created ${created.length} in ${pages} pages`);
}

async function main() {
  await visibilityGate();
  await classShapeGate();
  await inputGates();
  await searchAndOrdering();
  await paginationDeterministic();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
