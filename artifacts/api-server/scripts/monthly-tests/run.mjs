/**
 * The monthly tier, driven through the real API.
 *
 * `src/lib/monthly.test.ts` proves the arithmetic. This proves the routes actually use it:
 * that what a student is quoted is what they are charged, that the same request sent twice
 * charges once, and that a teacher and a student never end up in different months.
 *
 * Time is moved by editing the database rather than by waiting. A suite that has to sit for
 * thirty days is a suite nobody runs.
 *
 * Usage: API_URL=http://127.0.0.1:8080 node scripts/monthly-tests/run.mjs
 */
import { execFileSync } from "node:child_process";
import { WebSocket } from "ws";

const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";
const WS = API.replace(/^http/, "ws");

/**
 * A real socket, held open, collecting everything the server pushes to one person.
 *
 * Copied from the alert suite, for the reason recorded there: reading the database or trusting
 * that the route returned 200 proves the server meant to tell somebody, not that it did. The
 * first version of the time-change test checked a count in the response body, and disabling the
 * notification entirely did not disturb it.
 */
function listen(token) {
  const ws = new WebSocket(`${WS}/api/ws?token=${encodeURIComponent(token)}`);
  const events = [];
  ws.on("message", (raw) => { try { events.push(JSON.parse(String(raw))); } catch { /* not ours */ } });
  ws.on("error", () => {});
  return {
    events,
    open: () => new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); }),
    close: () => { try { ws.close(); } catch { /* already gone */ } },
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Reads an id out of a response, or fails the check and stops this section.
 *
 * Reaching straight into `res.body.enrolment.id` reads fine until the request is refused for a
 * reason the test did not expect — then the suite dies on a TypeError and every check after it
 * simply never runs. That happened while breaking the forty-eight hour rule on purpose: the
 * rule change suspended a teacher three sections earlier, and the report was a stack trace
 * instead of a failure.
 */
function idFrom(res, path, what) {
  const value = path.split(".").reduce((o, k) => (o == null ? o : o[k]), res?.body);
  if (typeof value !== "number") {
    check(`could read ${what}`, false, `status ${res?.status}: ${JSON.stringify(res?.body)?.slice(0, 160)}`);
    throw new SectionAborted(what);
  }
  return value;
}

class SectionAborted extends Error {}

/** Runs a section, and lets a failed read end that section without ending the suite. */
async function section(name, fn) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof SectionAborted) {
      console.log(`  ---- "${name}" stopped early: ${err.message} could not be read`);
      return;
    }
    throw err;
  }
}

async function until(events, test, ms = 4000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (test(events)) return true;
    await wait(50);
  }
  return test(events);
}

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

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
async function register(role, name) {
  seq += 1;
  const email = `mo_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: name ?? `${role} ${seq}`,
    email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10" }),
  } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body, email };
}

const TIER = 6500;
const KTM = "Asia/Kathmandu";

/** An agent, made the only way there is: by promoting an account in the database. */
async function makeAgent() {
  const account = await register("student", "Support Agent");
  sql(`update users set role = 'admin' where id = ${account.user.id}`);
  const signedIn = await api("/auth/login", { method: "POST", body: { email: account.email, password: "password123" } });
  return { ...account, token: signedIn.body?.token ?? account.token };
}

/** The minute of the day it is right now in Kathmandu, 0–1439. */
function kathmanduMinuteNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: KTM, hour12: false, hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date());
  const read = (t) => Number(parts.find((x) => x.type === t).value);
  return (read("hour") % 24) * 60 + read("minute");
}

/** Puts the single next class this many hours away, without disturbing any other day. */
function nextClassIn(klassId, hours) {
  const id = sql(`select id from recurring_days where recurring_id = ${klassId}
      and status = 'planned' and scheduled_for > now() order by scheduled_for asc limit 1`);
  if (!id) return null;
  sql(`update recurring_days set scheduled_for = now() + interval '${hours} hours' where id = ${id}`);
  return Number(id);
}

/**
 * Winds a class back in time by whole days.
 *
 * Every class-day moves by the same amount, which keeps them a day apart — shifting a batch of
 * them onto one instant instead is refused by `recurring_days_slot_idx`, and rightly: that
 * index is what stops a doubled ledger, so a test that needs to defeat it is a test setting up
 * a world that cannot happen.
 *
 * The plan's anchor moves too. Winding the classes back without it leaves a month that ends
 * thirty days from now but runs out of classes in ten, and a suite that sets up an incoherent
 * world proves nothing about a coherent one.
 */
function ageClass(klassId, planId, days) {
  sql(`update teacher_plans set cycle_anchor = cycle_anchor - interval '${days} days' where id = ${planId}`);

  /*
   * Moved in two hops, both far longer than the month the classes span.
   *
   * One shift of twenty days looks obviously right and is not: the row on day twenty lands on
   * day zero, where its own neighbour still sits, and `recurring_days_slot_idx` refuses it.
   * Whether it refuses depends on the order Postgres happens to update the rows in — ascending
   * is fine, descending collides — so a single shift is a coin toss that passed several times
   * before failing. Hopping the whole set out of its own range and back cannot overlap itself
   * in either order.
   *
   * Worth knowing outside this file: moving the daily time will have to move real class-days
   * the same way. See the 501 on PATCH /monthly/classes/:id/time.
   */
  const FAR = 4000;
  sql(`update recurring_days set scheduled_for = scheduled_for - interval '${FAR} days' where recurring_id = ${klassId}`);
  sql(`update recurring_days set scheduled_for = scheduled_for + interval '${FAR - days} days' where recurring_id = ${klassId}`);

  /*
   * The students move with the calendar too.
   *
   * What a student received is counted as the classes held *after they joined*, so winding the
   * classes back without winding the join back leaves everybody having joined after every class
   * of the month. That is not a world that can happen, and it made a teacher who held twenty of
   * thirty look like one who held none — the suite reported a full refund and the arithmetic
   * was innocent.
   */
  sql(`update recurring_enrollments set joined_at = joined_at - interval '${days} days' where recurring_id = ${klassId}`);
}

/**
 * Every class this run created.
 *
 * The invariant sweep at the end is scoped to these. It used to read the whole table, which
 * looks stricter and is worse: one deliberately broken run leaves a bad row behind and every
 * later run fails on it, so the failure becomes something to explain away rather than to act
 * on. An invariant nobody believes is not an invariant.
 */
const createdClasses = [];
const scope = () => (createdClasses.length ? createdClasses.join(",") : "-1");

/** A teacher holding the tier with a running monthly class. */
async function teacherWithClass(opts = {}) {
  const teacher = await register("teacher");
  const bought = await api("/monthly/plan", { method: "POST", token: teacher.token, body: { paymentMethod: "esewa" } });
  if (bought.status > 201) throw new Error(`buy plan: ${bought.status} ${JSON.stringify(bought.body)}`);
  const made = await api("/monthly/classes", { method: "POST", token: teacher.token, body: {
    subject: "Maths", topic: "Algebra",
    startMinute: opts.startMinute ?? 9 * 60,
    durationMinutes: opts.durationMinutes ?? 60,
    monthlyPrice: opts.monthlyPrice ?? 3000,
    maxStudents: opts.maxStudents ?? 45,
  } });
  if (made.status > 201) throw new Error(`create class: ${made.status} ${JSON.stringify(made.body)}`);
  createdClasses.push(made.body.class.id);
  return { teacher, klass: made.body.class, planId: Number(sql(`select id from teacher_plans where teacher_id = ${teacher.user.id}`)) };
}

/* ------------------------------------------------------------------ the plan */

async function planTests() {
  console.log("\nBuying the tier");

  const teacher = await register("teacher");
  const bought = await api("/monthly/plan", { method: "POST", token: teacher.token, body: { paymentMethod: "esewa" } });
  check("a teacher can buy the monthly tier", bought.status === 201, `status ${bought.status}`);
  check("the tier costs what the owner set", bought.body?.plan?.price === TIER, `got ${bought.body?.plan?.price}`);
  check("the clock does not start at purchase", bought.body?.plan?.cycleAnchor === null, `anchor ${bought.body?.plan?.cycleAnchor}`);

  const again = await api("/monthly/plan", { method: "POST", token: teacher.token, body: { paymentMethod: "esewa" } });
  check("buying twice does not create a second plan", again.body?.alreadyHad === true, `status ${again.status}`);
  const count = Number(sql(`select count(*) from teacher_plans where teacher_id = ${teacher.user.id}`));
  check("and there is exactly one plan row", count === 1, `found ${count}`);

  const student = await register("student");
  const refused = await api("/monthly/plan", { method: "POST", token: student.token, body: {} });
  check("a student cannot buy the teacher tier", refused.status === 403, `status ${refused.status}`);

  const noPlan = await api("/monthly/classes", { method: "POST", token: (await register("teacher")).token, body: {
    subject: "Maths", topic: "x", startMinute: 540, monthlyPrice: 1000,
  } });
  check("no plan means no monthly class", noPlan.status === 402, `status ${noPlan.status}`);
}

/* ------------------------------------------------------------- the class */

async function classTests() {
  console.log("\nCreating the recurring class");

  const { teacher, klass, planId } = await teacherWithClass();
  check("the class is created", Boolean(klass?.id), JSON.stringify(klass)?.slice(0, 120));
  check("the clock starts when the class is created", Boolean(sql(`select cycle_anchor from teacher_plans where id = ${planId}`)), "anchor still null");

  const days = Number(sql(`select count(*) from recurring_days where recurring_id = ${klass.id} and cycle_index = 0`));
  check("a cycle is generated with thirty class-days", days === 30, `got ${days}`);
  check("and the class agrees about how many", klass.sessionsPlanned === 30, `got ${klass.sessionsPlanned}`);

  const distinct = Number(sql(`select count(distinct scheduled_for) from recurring_days where recurring_id = ${klass.id}`));
  check("no two class-days share an instant", distinct === days, `${distinct} distinct of ${days}`);

  const atNine = Number(sql(`select count(*) from recurring_days where recurring_id = ${klass.id}
      and to_char(scheduled_for at time zone 'Asia/Kathmandu', 'HH24:MI') = '09:00'`));
  check("every class-day is at nine in the morning in Kathmandu", atNine === days, `${atNine} of ${days}`);

  const second = await api("/monthly/classes", { method: "POST", token: teacher.token, body: {
    subject: "Science", topic: "y", startMinute: 600, monthlyPrice: 2000,
  } });
  check("one plan runs one class", second.status === 409, `status ${second.status}`);

  const t2 = await register("teacher");
  await api("/monthly/plan", { method: "POST", token: t2.token, body: {} });
  const noTopic = await api("/monthly/classes", { method: "POST", token: t2.token, body: { subject: "Maths", startMinute: 540, monthlyPrice: 100 } });
  check("a class needs a subject and a topic", noTopic.status === 400, `status ${noTopic.status}`);

  const long = await api("/monthly/classes", { method: "POST", token: t2.token, body: {
    subject: "Maths", topic: "x", startMinute: 540, durationMinutes: 120, monthlyPrice: 1000,
  } });
  check("a daily class cannot run past ninety minutes", long.status === 400, `status ${long.status}`);

  const okLength = await api("/monthly/classes", { method: "POST", token: t2.token, body: {
    subject: "Maths", topic: "x", startMinute: 540, durationMinutes: 90, monthlyPrice: 1000,
  } });
  check("ninety minutes exactly is allowed", okLength.status === 201, `status ${okLength.status}`);
}

/* ------------------------------------------------------------- joining */

async function joinTests() {
  console.log("\nJoining, and what it costs");

  const { klass } = await teacherWithClass({ monthlyPrice: 3000 });
  const student = await register("student");

  const seen = await api(`/monthly/classes/${klass.id}`, { token: student.token });
  const quoted = seen.body?.class?.quote;
  check("a student is quoted before they pay", typeof quoted?.amount === "number", JSON.stringify(quoted));

  const joined = await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: student.token, body: { paymentMethod: "esewa" } });
  check("the student joins", joined.status === 201, `status ${joined.status} ${JSON.stringify(joined.body)?.slice(0, 140)}`);
  check("and is charged exactly what they were quoted", joined.body?.enrolment?.amountPaid === quoted?.amount,
    `quoted ${quoted?.amount}, charged ${joined.body?.enrolment?.amountPaid}`);

  const row = sql(`select amount_paid, platform_share, teacher_share, sessions_paid_for, sessions_planned
                   from recurring_enrollments where id = ${idFrom(joined, "enrolment.id", "the student's place")}`).split("|");
  const [paid, platform, teacherShare, paidFor, planned] = row.map(Number);
  check("the two shares add back to what was paid", platform + teacherShare === paid, `${platform} + ${teacherShare} ≠ ${paid}`);
  check("Sikshya's share is thirty per cent", platform === Math.round(paid * 0.3), `${platform} of ${paid}`);
  check("the price is the fee times classes left over classes planned",
    paid === Math.floor((3000 * paidFor) / planned), `${paid} ≠ floor(3000 × ${paidFor} / ${planned})`);

  const twice = await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: student.token, body: { paymentMethod: "esewa" } });
  check("joining twice does not charge twice", twice.body?.alreadyHad === true, `status ${twice.status}`);
  const rows = Number(sql(`select count(*) from recurring_enrollments where recurring_id = ${klass.id} and student_id = ${student.user.id}`));
  check("and leaves one enrolment", rows === 1, `found ${rows}`);

  const detail = await api(`/monthly/classes/${klass.id}`, { token: student.token });
  check("a student who holds a place is not quoted again", detail.body?.class?.quote === null, JSON.stringify(detail.body?.class?.quote));
  check("their place is reported back to them", detail.body?.class?.enrolment?.amountPaid === paid, JSON.stringify(detail.body?.class?.enrolment));

  const anon = await api(`/monthly/classes/${klass.id}`);
  check("a signed-out visitor still sees the price", typeof anon.body?.class?.quote?.amount === "number", JSON.stringify(anon.body?.class?.quote));
  check("but is not shown anybody's enrolment", anon.body?.class?.enrolment === null, JSON.stringify(anon.body?.class?.enrolment));
}

/**
 * The one case that shows which way a part-rupee goes.
 *
 * Every other price in this suite divides exactly — 3000 over 30 classes is 100 a class — so
 * rounding up and rounding down give the same answer and neither is being tested. This was
 * found by changing the rule to round up and watching the whole suite still pass.
 *
 * A thousand rupees over thirty classes is 33.33 each, so seven of them is 233.33. It must come
 * out as 233: a part-rupee that cannot be charged is not charged, and the student keeps it.
 */
async function roundingTest() {
  console.log("\nWhich way a part-rupee goes");

  const { klass, planId } = await teacherWithClass({ monthlyPrice: 1000 });
  ageClass(klass.id, planId, 23);

  const student = await register("student");
  const seen = await api(`/monthly/classes/${klass.id}`, { token: student.token });
  check("setup: seven classes remain, and 1000/30 does not divide", seen.body?.class?.sessionsRemaining === 7, `got ${seen.body?.class?.sessionsRemaining}`);
  check("a part-rupee is rounded down, in the student's favour", seen.body?.class?.quote?.amount === 233,
    `quoted ${seen.body?.class?.quote?.amount}, expected 233 (233.33 rounded down)`);

  const joined = await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: student.token, body: {} });
  check("and that rounded price is what is charged", joined.body?.enrolment?.amountPaid === 233, `charged ${joined.body?.enrolment?.amountPaid}`);
  const [platform, teacherShare] = sql(`select platform_share, teacher_share from recurring_enrollments where id = ${idFrom(joined, "enrolment.id", "the student's place")}`).split("|").map(Number);
  check("the shares still add back exactly, with no rupee lost or invented", platform + teacherShare === 233, `${platform} + ${teacherShare} ≠ 233`);
}

/* --------------------------------------------------- pro-rating over a cycle */

async function proRatingTests() {
  console.log("\nPro-rating as a month runs down");

  const { klass, planId } = await teacherWithClass({ monthlyPrice: 3000 });

  ageClass(klass.id, planId, 20);
  const behind = Number(sql(`select count(*) from recurring_days where recurring_id = ${klass.id} and scheduled_for < now()`));
  check("setup: twenty classes are behind us", behind === 20, `got ${behind}`);

  const student = await register("student");
  const seen = await api(`/monthly/classes/${klass.id}`, { token: student.token });
  check("ten classes are reported as remaining", seen.body?.class?.sessionsRemaining === 10, `got ${seen.body?.class?.sessionsRemaining}`);
  check("a third of the month costs a third of the fee", seen.body?.class?.quote?.amount === 1000, `got ${seen.body?.class?.quote?.amount}`);

  const joined = await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: student.token, body: {} });
  check("and that is what is charged", joined.body?.enrolment?.amountPaid === 1000, `got ${joined.body?.enrolment?.amountPaid}`);
  check("the denominator is frozen at the full month", joined.body?.enrolment?.sessionsPlanned === 30, `got ${joined.body?.enrolment?.sessionsPlanned}`);
  check("the numerator is what is left", joined.body?.enrolment?.sessionsPaidFor === 10, `got ${joined.body?.enrolment?.sessionsPaidFor}`);

  /*
   * Now empty the month without ending it.
   *
   * Winding on another ten days used to leave a class with nothing in it. It no longer does,
   * and that is the point of month two existing: the class rolls over and has thirty fresh
   * classes. So the month is emptied the way it really empties — the teacher cancels what is
   * left of it — with nine days still on the clock.
   */
  ageClass(klass.id, planId, 9);
  sql(`update recurring_days set status = 'cancelled'
       where recurring_id = ${klass.id} and cycle_index = 0 and status = 'planned'`);
  const stillIn = Number(sql(`select count(*) from recurring_days where recurring_id = ${klass.id}
      and cycle_index = 0 and status = 'planned' and scheduled_for > now()`));
  check("setup: no classes remain in this month", stillIn === 0, `${stillIn} still ahead`);
  const monthNow = (await api(`/monthly/classes/${klass.id}`)).body?.class?.cycle?.index;
  check("setup: and the month has not ended", monthNow === 0, `month ${monthNow}`);

  const late = await register("student");
  const lateSeen = await api(`/monthly/classes/${klass.id}`, { token: late.token });
  check("with no classes left the quote says so", lateSeen.body?.class?.quote?.startsNextCycle === true, JSON.stringify(lateSeen.body?.class?.quote));
  const refused = await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: late.token, body: {} });
  check("and joining is refused rather than charged", refused.status === 409, `status ${refused.status}`);
  check("with the next month's start date given", Boolean(refused.body?.nextCycleStartsAt), JSON.stringify(refused.body));
  const charged = Number(sql(`select count(*) from recurring_enrollments where recurring_id = ${klass.id} and student_id = ${late.user.id}`));
  check("nothing was written for the refused student", charged === 0, `found ${charged}`);
}

/* ---------------------------------------------------- teacher and student in step */

async function syncTests() {
  console.log("\nTeacher and student never in different months");

  const { klass, planId } = await teacherWithClass({ monthlyPrice: 3000 });

  // A student joins on day twelve of the teacher's month.
  ageClass(klass.id, planId, 12);

  const student = await register("student");
  const joined = await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: student.token, body: {} });
  check("a student joining mid-month is enrolled in the teacher's cycle", joined.body?.enrolment?.cycleIndex === 0, `got ${joined.body?.enrolment?.cycleIndex}`);

  const seen = await api(`/monthly/classes/${klass.id}`, { token: student.token });
  check("there is one month, so one end date", Boolean(seen.body?.class?.cycle?.endsAt), JSON.stringify(seen.body?.class?.cycle));

  // Push past the end of the teacher's month. Both must move into month two together.
  ageClass(klass.id, planId, 19);
  const later = await api(`/monthly/classes/${klass.id}`, { token: student.token });
  check("after thirty days the teacher is in month two", later.body?.class?.cycle?.index === 1, `got ${later.body?.class?.cycle?.index}`);
  check("and the student's month-one place no longer counts as current", later.body?.class?.enrolment === null, JSON.stringify(later.body?.class?.enrolment));
  check("so they are quoted for month two", typeof later.body?.class?.quote?.amount === "number", JSON.stringify(later.body?.class?.quote));

  const oldRow = Number(sql(`select cycle_index from recurring_enrollments where id = ${idFrom(joined, "enrolment.id", "the student's place")}`));
  check("their month-one place is kept on the record, not deleted", oldRow === 0, `got ${oldRow}`);
}

/* ------------------------------------------------------------- capacity */

async function capacityTests() {
  console.log("\nForty-five students and no more");

  const { klass } = await teacherWithClass({ monthlyPrice: 0, maxStudents: 3 });
  const students = await Promise.all([register("student"), register("student"), register("student"), register("student")]);

  const results = [];
  for (const s of students) {
    results.push(await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: s.token, body: {} }));
  }
  const taken = results.filter((r) => r.status === 201).length;
  const turned = results.filter((r) => r.status === 409).length;
  check("the class fills to its limit", taken === 3, `${taken} joined`);
  check("and the next student is turned away", turned === 1, `${turned} refused`);

  const rows = Number(sql(`select count(*) from recurring_enrollments where recurring_id = ${klass.id}`));
  check("no place was written for the student turned away", rows === 3, `found ${rows}`);

  const t = await register("teacher");
  await api("/monthly/plan", { method: "POST", token: t.token, body: {} });
  const capped = await api("/monthly/classes", { method: "POST", token: t.token, body: {
    subject: "Maths", topic: "x", startMinute: 540, monthlyPrice: 100, maxStudents: 46,
  } });
  check("a class cannot be set up for more than forty-five", capped.status === 400, `status ${capped.status}`);
}

/* --------------------------------------------------------- nine at once */

async function concurrencyTests() {
  console.log("\nNine students joining at the same instant");

  const { klass } = await teacherWithClass({ monthlyPrice: 3000, maxStudents: 45 });
  const students = await Promise.all(Array.from({ length: 9 }, () => register("student")));

  const results = await Promise.all(
    students.map((s) => api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: s.token, body: {} })),
  );
  const ok = results.filter((r) => r.status === 201).length;
  check("all nine get in", ok === 9, `${ok} of 9 — ${results.filter((r) => r.status !== 201).map((r) => r.status).join(",")}`);

  const rows = Number(sql(`select count(*) from recurring_enrollments where recurring_id = ${klass.id}`));
  check("and there are nine places, not more", rows === 9, `found ${rows}`);

  const distinctAmounts = sql(`select count(distinct amount_paid) from recurring_enrollments where recurring_id = ${klass.id}`);
  check("all nine paid the same, because the month did not move under them", Number(distinctAmounts) === 1, `${distinctAmounts} different amounts`);

  // The same student, nine simultaneous taps.
  const eager = await register("student");
  const spam = await Promise.all(
    Array.from({ length: 9 }, () => api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: eager.token, body: {} })),
  );
  const created = spam.filter((r) => r.status === 201).length;
  const mine = Number(sql(`select count(*) from recurring_enrollments where recurring_id = ${klass.id} and student_id = ${eager.user.id}`));
  check("nine simultaneous taps buy one place", mine === 1, `found ${mine} rows, ${created} reported as created`);
  check("and only one of them reports having created it", created <= 1, `${created} said 201`);
  const overCharged = Number(sql(`select coalesce(sum(amount_paid), 0) from recurring_enrollments
      where recurring_id = ${klass.id} and student_id = ${eager.user.id}`));
  const oneMonth = Number(sql(`select monthly_price from recurring_sessions where id = ${klass.id}`));
  check("and they are charged for one month at most", overCharged <= oneMonth, `paid ${overCharged} against a fee of ${oneMonth}`);
}

/* ------------------------------------------- the class-day becoming a real class */

async function classDayTests() {
  console.log("\nA class-day becoming a real class");

  const { teacher, klass, planId } = await teacherWithClass({ monthlyPrice: 3000 });
  const student = await register("student");
  await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: student.token, body: {} });

  // Nothing is due for a day yet, so nothing has been created.
  const early = Number(sql(`select count(*) from recurring_days where recurring_id = ${klass.id} and session_id is not null`));
  check("class-days far ahead are not created yet", early <= 1, `${early} already materialised`);

  // Bring tomorrow's class within the window and read the class, which runs the sweep.
  ageClass(klass.id, planId, 1);
  await api(`/monthly/classes/${klass.id}`, { token: student.token });

  const sessionId = Number(sql(`select session_id from recurring_days where recurring_id = ${klass.id}
      and session_id is not null order by scheduled_for asc limit 1`) || 0);
  check("the next class-day becomes a real class", sessionId > 0, `session_id ${sessionId}`);

  const sess = sql(`select teacher_id, price, duration, subject from sessions where id = ${sessionId}`).split("|");
  check("it belongs to the teacher", Number(sess[0]) === teacher.user.id, `teacher ${sess[0]}`);
  check("and costs nothing at this door", Number(sess[1]) === 0, `price ${sess[1]}`);
  check("and runs for the class's length", Number(sess[2]) === 60, `duration ${sess[2]}`);

  const enrolled = Number(sql(`select count(*) from session_enrollments where session_id = ${sessionId}
      and student_id = ${student.user.id} and payment_status = 'paid'`));
  check("the monthly student is already enrolled and paid", enrolled === 1, `found ${enrolled}`);

  // The door the whole tier depends on: nobody buys their way in one class at a time.
  const outsider = await register("student");
  const bought = await api(`/sessions/${sessionId}/book`, { method: "POST", token: outsider.token, body: { paymentMethod: "esewa" } });
  check("an outsider cannot buy a single day of a monthly course", bought.status === 409, `status ${bought.status} ${JSON.stringify(bought.body)?.slice(0, 120)}`);
  const sneaked = Number(sql(`select count(*) from session_enrollments where session_id = ${sessionId} and student_id = ${outsider.user.id}`));
  check("and no enrolment was written for them", sneaked === 0, `found ${sneaked}`);

  /*
   * Counted, not paged through.
   *
   * The first version asked for a hundred classes and checked this one was not among them,
   * which passed with the filter removed: by then the database held hundreds of class-days and
   * the one under test simply was not on the first page. `total` is computed from the same
   * where clause as the rows, so comparing it against the database is exact and cannot depend
   * on where a row happens to land.
   */
  const discover = await api("/sessions?limit=1");
  const forSale = Number(sql(`select count(*) from sessions s
      where not exists (select 1 from recurring_days rd where rd.session_id = s.id)`));
  const allClasses = Number(sql(`select count(*) from sessions`));
  check("setup: there are monthly class-days that could have been counted", allClasses > forSale,
    `${allClasses} classes, ${forSale} of them for sale`);
  check("monthly class-days are not offered in Discover", discover.body?.total === forSale,
    `Discover counted ${discover.body?.total}, ${forSale} are actually for sale`);

  const mine = await api(`/sessions?studentId=${student.user.id}&limit=100`);
  const inMine = (mine.body?.sessions ?? mine.body ?? []).some?.((x) => x.id === sessionId);
  check("but the student does see it among their own classes", inMine === true, `session ${sessionId} missing from their list`);

  // Running the sweep twice must not create the class twice.
  await api(`/monthly/classes/${klass.id}`, { token: student.token });
  const twice = Number(sql(`select count(*) from sessions s join recurring_days rd on rd.session_id = s.id
      where rd.recurring_id = ${klass.id}`));
  const linked = Number(sql(`select count(*) from recurring_days where recurring_id = ${klass.id} and session_id is not null`));
  check("reading twice does not create the class twice", twice === linked, `${twice} classes for ${linked} days`);
}

async function lateJoinerTests() {
  console.log("\nA student joining after tomorrow's class already exists");

  const { klass, planId } = await teacherWithClass({ monthlyPrice: 3000 });
  const early = await register("student");
  await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: early.token, body: {} });

  ageClass(klass.id, planId, 1);
  await api(`/monthly/classes/${klass.id}`, { token: early.token });

  /*
   * Tomorrow's class, not one that has already started.
   *
   * Both get created — the window reaches a couple of hours back so a class running right now
   * is not missed — and picking the earliest picked whichever the wall clock happened to
   * produce. When that was one already under way, the late joiner was correctly *not* added to
   * it: they did not pay for a class that started before they joined, and their
   * sessionsPaidFor says so. The check failed for a real reason about a case it was not about,
   * and only between the class's time of day and two hours later.
   */
  const sessionId = Number(sql(`select session_id from recurring_days where recurring_id = ${klass.id}
      and session_id is not null and status = 'planned' and scheduled_for > now()
      order by scheduled_for asc limit 1`) || 0);
  check("setup: a class still to come exists already", sessionId > 0, `session_id ${sessionId}`);

  const late = await register("student");
  await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: late.token, body: {} });

  const inIt = Number(sql(`select count(*) from session_enrollments where session_id = ${sessionId}
      and student_id = ${late.user.id} and payment_status = 'paid'`));
  check("the late joiner is put into the class that already existed", inIt === 1, `found ${inIt}`);

  const counted = Number(sql(`select enrolled_count from sessions where id = ${sessionId}`));
  const actual = Number(sql(`select count(*) from session_enrollments where session_id = ${sessionId}`));
  check("and the class's headcount matches its enrolments", counted === actual, `${counted} counted, ${actual} rows`);
}

async function concurrentMaterialiseTest() {
  console.log("\nTen people opening the same class at the same instant");

  /*
   * The class-day is created on the read path, so ten students opening the class at once are
   * ten attempts to create the same class. Each class-day is locked and re-checked before its
   * class is written; without that re-check this makes a second, orphaned class — invisible,
   * because only one of them ends up linked to the class-day.
   *
   * Counted off the teacher's sessions rather than off the link, for exactly that reason. The
   * teacher is new and runs nothing but this monthly class, so every class of theirs came from
   * here, linked or not.
   */
  const { teacher, klass, planId } = await teacherWithClass({ monthlyPrice: 3000 });
  const student = await register("student");
  await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: student.token, body: {} });
  ageClass(klass.id, planId, 1);

  await Promise.all(
    Array.from({ length: 10 }, () => api(`/monthly/classes/${klass.id}`, { token: student.token })),
  );

  const theirClasses = Number(sql(`select count(*) from sessions where teacher_id = ${teacher.user.id}`));
  const linkedDays = Number(sql(`select count(*) from recurring_days where recurring_id = ${klass.id} and session_id is not null`));
  check("a class-day is created once, however many people are looking", theirClasses === linkedDays,
    `${theirClasses} classes for ${linkedDays} class-days`);
  check("and at least one was created", linkedDays >= 1, `${linkedDays} linked`);

  const enrolments = Number(sql(`select count(*) from session_enrollments se
      join recurring_days rd on rd.session_id = se.session_id
      where rd.recurring_id = ${klass.id} and se.student_id = ${student.user.id}`));
  check("the student is enrolled once, not ten times", enrolments === linkedDays, `${enrolments} enrolments`);
}

async function ledgerTests() {
  console.log("\nWriting down what became of a class");

  const { klass, planId } = await teacherWithClass({ monthlyPrice: 3000 });
  const student = await register("student");
  await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: student.token, body: {} });

  // Two days on: yesterday's class exists, and nobody started it.
  ageClass(klass.id, planId, 1);
  await api(`/monthly/classes/${klass.id}`, { token: student.token });
  const first = Number(sql(`select session_id from recurring_days where recurring_id = ${klass.id}
      and session_id is not null order by scheduled_for asc limit 1`) || 0);
  check("setup: a class was created", first > 0, `session_id ${first}`);

  ageClass(klass.id, planId, 2);
  await api(`/monthly/classes/${klass.id}`, { token: student.token });

  /*
   * Judged on the one class-day that actually became a class and was never started.
   *
   * Counting missed days across the whole class does not test this: the days further back were
   * never materialised at all, and they are missed whatever the rule about starting says. That
   * looser check passed with the rule changed to count every past class as held.
   */
  const firstStatus = sql(`select status from recurring_days where session_id = ${first}`);
  check("a class nobody started is written down as missed", firstStatus === "missed", `status "${firstStatus}"`);
  const missedAt = sql(`select missed_at is not null from recurring_days where session_id = ${first}`);
  check("and when it was judged is kept", missedAt === "t", `missed_at ${missedAt}`);

  // A class the teacher did start is held, not missed.
  const { klass: k2, planId: p2 } = await teacherWithClass({ monthlyPrice: 3000 });
  const s2 = await register("student");
  await api(`/monthly/classes/${k2.id}/join`, { method: "POST", token: s2.token, body: {} });
  ageClass(k2.id, p2, 1);
  await api(`/monthly/classes/${k2.id}`, { token: s2.token });
  const started = Number(sql(`select session_id from recurring_days where recurring_id = ${k2.id}
      and session_id is not null order by scheduled_for asc limit 1`) || 0);
  sql(`update sessions set started_at = date::timestamptz + interval '3 minutes' where id = ${started}`);
  ageClass(k2.id, p2, 2);
  await api(`/monthly/classes/${k2.id}`, { token: s2.token });

  const heldRow = sql(`select status from recurring_days where session_id = ${started}`);
  check("a class the teacher started is written down as held", heldRow === "held", `status "${heldRow}"`);
  const heldAt = sql(`select held_at is not null from recurring_days where session_id = ${started}`);
  check("and when they started it is kept", heldAt === "t", `held_at ${heldAt}`);

  const ledger = await api(`/monthly/classes/${k2.id}`, { token: s2.token });
  check("the ledger is reported back", (ledger.body?.class?.ledger?.held ?? 0) >= 1, JSON.stringify(ledger.body?.class?.ledger));
}

/* ---------------------------------------------------------- the rules */

async function ruleTests() {
  console.log("\nThe rules at the doors");

  const { teacher, klass } = await teacherWithClass();
  const own = await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: teacher.token, body: {} });
  check("a teacher cannot join their own class", own.status === 400, `status ${own.status}`);

  const stranger = await register("teacher");
  const notMine = await api(`/monthly/classes/${klass.id}/time`, { method: "PATCH", token: stranger.token, body: { startMinute: 600 } });
  check("somebody else cannot move the class", notMine.status === 403, `status ${notMine.status}`);

  /*
   * Eighteen hours' notice, judged against the next class.
   *
   * This used to cancel every class within ten hours, which pushes the next class *further*
   * away — the opposite of the situation being tested. It passed anyway because the route was
   * still a 501 and refused everything. Implementing the route is what exposed it.
   */
  const wasAt = Number(sql(`select start_minute from recurring_sessions where id = ${klass.id}`));
  nextClassIn(klass.id, 2);
  const soon = await api(`/monthly/classes/${klass.id}/time`, { method: "PATCH", token: teacher.token, body: { startMinute: 600 } });
  check("a class inside eighteen hours cannot be moved", soon.status === 409, `status ${soon.status} ${JSON.stringify(soon.body)?.slice(0, 120)}`);
  const stillAt = Number(sql(`select start_minute from recurring_sessions where id = ${klass.id}`));
  check("and the refusal changes nothing", wasAt === stillAt, `${wasAt} became ${stillAt}`);

  const missing = await api("/monthly/classes/999999");
  check("an unknown class is a 404, not a crash", missing.status === 404, `status ${missing.status}`);

  const badTime = await api(`/monthly/classes/${klass.id}/time`, { method: "PATCH", token: teacher.token, body: { startMinute: 1500 } });
  check("a time outside the day is refused", badTime.status === 400, `status ${badTime.status}`);

  const anon = await api(`/monthly/classes/${klass.id}/join`, { method: "POST", body: {} });
  check("a signed-out visitor cannot join", anon.status === 401, `status ${anon.status}`);
}

async function timeChangeTests() {
  console.log("\nMoving the daily time");

  /*
   * The class time is set three hours ago, so today's class has been and gone and the next one
   * is about twenty-one hours away: past the eighteen-hour notice window, so the move is
   * allowed, but inside the twenty-four hours in which a class-day becomes a real class — so
   * there is a class on the calendar to move as well as a schedule.
   *
   * Ageing the class by a day instead put the next class within eighteen hours and the move was
   * correctly refused, which tested the notice rule for a second time and the move not at all.
   */
  const wasMinute = (kathmanduMinuteNow() - 180 + 1440) % 1440;
  const { teacher, klass, planId } = await teacherWithClass({ monthlyPrice: 3000, startMinute: wasMinute });
  const student = await register("student");
  await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: student.token, body: {} });

  // Two days on, so there are classes behind us as well as ahead. A time change must not
  // rewrite history: the delivery ledger is counted from those, and moving them would move
  // classes that already happened.
  ageClass(klass.id, planId, 2);
  await api(`/monthly/classes/${klass.id}`, { token: student.token });

  const hoursOut = Number(sql(`select round(extract(epoch from (min(scheduled_for) - now())) / 3600)
      from recurring_days where recurring_id = ${klass.id} and status = 'planned' and scheduled_for > now()`));
  check("setup: the next class is past the notice window but inside a day", hoursOut > 18 && hoursOut < 24, `${hoursOut} hours away`);
  const existing = Number(sql(`select session_id from recurring_days where recurring_id = ${klass.id}
      and session_id is not null and status = 'planned' order by scheduled_for asc limit 1`) || 0);
  // Asserted, not assumed. The check that this class moves used to sit inside `if (existing)`,
  // so leaving every already-created class behind passed the suite in silence.
  check("setup: a class is already on the calendar to be moved", existing > 0, `session_id ${existing}`);

  const ear = listen(student.token);
  await ear.open().catch(() => {});

  const before = Number(sql(`select count(*) from recurring_days where recurring_id = ${klass.id}
      and status = 'planned' and scheduled_for > now()`));
  check("setup: there are classes still to come", before > 0, `${before} ahead`);

  const moved = await api(`/monthly/classes/${klass.id}/time`, { method: "PATCH", token: teacher.token, body: { startMinute: 17 * 60 } });
  check("the teacher can move the daily time", moved.status === 200, `status ${moved.status} ${JSON.stringify(moved.body)?.slice(0, 140)}`);
  check("and is told how many classes moved", moved.body?.moved === before, `moved ${moved.body?.moved} of ${before}`);
  const wasText = `${String(Math.floor(wasMinute / 60)).padStart(2, "0")}:${String(wasMinute % 60).padStart(2, "0")}`;
  check("and what the time was before", moved.body?.previousStartTime === wasText, `was ${moved.body?.previousStartTime}, expected ${wasText}`);
  check("and what it is now", moved.body?.startTime === "17:00", `now ${moved.body?.startTime}`);
  check("the response says the students were told", moved.body?.studentsTold >= 1, `told ${moved.body?.studentsTold}`);
  const heard = await until(ear.events, (e) => e.some((x) => x?.kind === "session_rescheduled" || x?.event?.kind === "session_rescheduled"));
  ear.close();
  check("and the student's own connection actually receives it", heard === true,
    `events seen: ${JSON.stringify(ear.events.map((x) => x?.kind ?? x?.event?.kind ?? x?.type)).slice(0, 160)}`);

  const atFive = Number(sql(`select count(*) from recurring_days where recurring_id = ${klass.id}
      and status = 'planned' and scheduled_for > now()
      and to_char(scheduled_for at time zone 'Asia/Kathmandu', 'HH24:MI') = '17:00'`));
  check("every class still to come is at the new time", atFive === before, `${atFive} of ${before}`);

  const untouched = Number(sql(`select count(*) from recurring_days where recurring_id = ${klass.id}
      and scheduled_for < now()
      and to_char(scheduled_for at time zone 'Asia/Kathmandu', 'HH24:MI') = '${wasText}'`));
  const behind = Number(sql(`select count(*) from recurring_days where recurring_id = ${klass.id} and scheduled_for < now()`));
  check("setup: there are classes behind us to leave alone", behind > 0, `${behind} behind`);
  check("classes already behind us are left where they were", untouched === behind, `${untouched} of ${behind} still at ${wasText}`);

  const sessionAt = sql(`select to_char(date at time zone 'Asia/Kathmandu', 'HH24:MI') from sessions where id = ${existing}`);
  check("a class already on the calendar moves with it", sessionAt === "17:00", `class is at ${sessionAt}`);

  const dupes = Number(sql(`select count(*) from (
      select scheduled_for, kind from recurring_days where recurring_id = ${klass.id}
      group by 1,2 having count(*) > 1) d`));
  check("moving them did not land two classes on one instant", dupes === 0, `${dupes} collisions`);

  const stored = Number(sql(`select start_minute from recurring_sessions where id = ${klass.id}`));
  check("the class remembers its new time", stored === 17 * 60, `start_minute ${stored}`);

}

async function timeChangeEdgeTests() {
  console.log("\nMoving the time: the two classes that must not move");

  /*
   * A class that started twenty minutes ago is still running, and people are in it.
   *
   * It is still "planned" — settling waits for the scheduled finish plus an hour, precisely so
   * a teacher who starts late is not marked absent — so only the "still to come" filter keeps
   * the time change off it. Without that filter this class moves out from under the people
   * sitting in it.
   */
  const nowMin = kathmanduMinuteNow();
  const { teacher, klass, planId } = await teacherWithClass({ monthlyPrice: 0, startMinute: (nowMin - 180 + 1440) % 1440 });
  const student = await register("student");
  await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: student.token, body: {} });
  ageClass(klass.id, planId, 2);
  await api(`/monthly/classes/${klass.id}`, { token: student.token });

  const running = sql(`select id from recurring_days where recurring_id = ${klass.id}
      and status = 'planned' and scheduled_for < now() order by scheduled_for desc limit 1`);
  let runningId = Number(running || 0);
  if (!runningId) {
    // Put one inside the grace window by hand if the clock did not hand us one.
    const anyPast = sql(`select id from recurring_days where recurring_id = ${klass.id}
        and scheduled_for < now() order by scheduled_for desc limit 1`);
    runningId = Number(anyPast || 0);
    if (runningId) sql(`update recurring_days set status = 'planned',
        scheduled_for = now() - interval '20 minutes' where id = ${runningId}`);
  }
  check("setup: a class is running right now", runningId > 0, `id ${runningId}`);
  const wasRunningAt = sql(`select scheduled_for from recurring_days where id = ${runningId}`);

  await api(`/monthly/classes/${klass.id}/time`, { method: "PATCH", token: teacher.token, body: { startMinute: 17 * 60 } });
  const nowRunningAt = sql(`select scheduled_for from recurring_days where id = ${runningId}`);
  check("a class that is already running is not moved", wasRunningAt === nowRunningAt,
    `was ${wasRunningAt}, now ${nowRunningAt}`);

  /*
   * And the class that sits at the very end of a month.
   *
   * Moving the daily time later can carry a month's last class past the moment that month
   * ends. Its cycle_index has to follow it: a class-day filed under the wrong month is counted
   * against the wrong delivery floor and against the wrong students' money.
   */
  const { teacher: t2, klass: k2, planId: p2 } = await teacherWithClass({ monthlyPrice: 0, startMinute: 60 });
  // Put the month's boundary an hour after the last class, so moving the time later crosses it.
  const anchor = sql(`select cycle_anchor from teacher_plans where id = ${p2}`);
  check("setup: the month has an anchor", Boolean(anchor), `anchor ${anchor}`);

  const lastBefore = sql(`select cycle_index from recurring_days where recurring_id = ${k2.id}
      and kind = 'regular' order by scheduled_for desc limit 1`);
  await api(`/monthly/classes/${k2.id}/time`, { method: "PATCH", token: t2.token, body: { startMinute: 23 * 60 + 30 } });

  const wrongMonth = Number(sql(`select count(*) from recurring_days rd
      join recurring_sessions r on r.id = rd.recurring_id
      join teacher_plans tp on tp.id = r.plan_id
      where rd.recurring_id = ${k2.id}
        and rd.cycle_index <> floor(extract(epoch from (rd.scheduled_for - tp.cycle_anchor)) / (30 * 86400))`));
  check("every class-day is filed under the month it actually falls in", wrongMonth === 0,
    `${wrongMonth} filed under the wrong month (last was cycle ${lastBefore})`);
}

/* --------------------------------------------------------------- enforcement */

/**
 * Ages a class and forces the sweep to judge what became of it.
 *
 * Reading the class is what runs the sweep, so nothing is written down until somebody looks.
 * That is by design — there is no scheduler — but it means every test here has to look.
 */
async function judge(klassId, token) {
  await api(`/monthly/classes/${klassId}`, { token });
}

/**
 * Makes `n` classes of a month be missed, and old enough to count against the teacher.
 *
 * Winds the month on far enough that there are `n` classes behind us to miss — asking for seven
 * after moving three days on silently produced three, and every count downstream was then
 * quietly wrong rather than failing.
 */
function missClasses(klassId, planId, n, hoursAgo = 72) {
  ageClass(klassId, planId, n + 1);
  const ids = sql(`select id from recurring_days where recurring_id = ${klassId}
      and scheduled_for < now() and status <> 'missed' order by scheduled_for asc limit ${n}`)
    .split("\n").filter(Boolean);
  if (ids.length) {
    sql(`update recurring_days set status = 'missed', missed_at = now() - interval '${hoursAgo} hours'
         where id in (${ids.join(",")})`);
  }
  return ids.map(Number);
}

/**
 * Moves the class-days without moving the month.
 *
 * A month is thirty times twenty-four hours and its classes are a day apart, so the last class
 * normally lands a few hours before the month ends. Nudging the classes on by a day models
 * that gap — the month still running with all its classes behind it — which is the only
 * situation in which a teacher can have cleared the twenty-five-class floor *and* still owe
 * their students for days they will not get.
 *
 * The students move with the classes, and only the month's clock stays put. A student joins and
 * *then* their classes follow; leaving the join behind puts the first class before the student
 * existed, and it stops counting as one they received.
 *
 * Two hops, for the reason ageClass gives.
 */
function shiftDaysOnly(klassId, days) {
  const FAR = 4000;
  sql(`update recurring_days set scheduled_for = scheduled_for - interval '${FAR} days' where recurring_id = ${klassId}`);
  sql(`update recurring_days set scheduled_for = scheduled_for + interval '${FAR - days} days' where recurring_id = ${klassId}`);
  sql(`update recurring_enrollments set joined_at = joined_at - interval '${days} days' where recurring_id = ${klassId}`);
}

/** Marks `n` more classes of a month missed, without moving the calendar again. */
function missMore(klassId, n, hoursAgo = 72) {
  const ids = sql(`select id from recurring_days where recurring_id = ${klassId}
      and status = 'planned' and kind = 'regular' order by scheduled_for asc limit ${n}`)
    .split("\n").filter(Boolean);
  if (ids.length) {
    sql(`update recurring_days set status = 'missed', missed_at = now() - interval '${hoursAgo} hours'
         where id in (${ids.join(",")})`);
  }
  return ids.map(Number);
}

async function makeupTests() {
  console.log("\nMake-up classes");

  const { teacher, klass, planId } = await teacherWithClass({ monthlyPrice: 3000 });
  const student = await register("student");
  await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: student.token, body: {} });

  const missed = missClasses(klass.id, planId, 2);
  check("setup: two classes were missed", missed.length === 2, `${missed.length} missed`);
  await judge(klass.id, teacher.token);

  const list = await api(`/monthly/classes/${klass.id}/missed`, { token: teacher.token });
  check("the teacher can see what they missed", (list.body?.missed ?? []).length >= 2, JSON.stringify(list.body)?.slice(0, 140));
  check("and how many make-ups they have left", list.body?.makeups?.left === 5, `${list.body?.makeups?.left} left`);
  const first = list.body?.missed?.find((m) => m.id === missed[0]);
  check("a class missed three days ago counts against them", first?.countsAgainstYou === true, JSON.stringify(first));

  /*
   * And one missed an hour ago does not — the teacher still has time to arrange a make-up.
   *
   * Asked of the server rather than of the database. Reading `missed_at` and doing the
   * arithmetic here would only prove the suite can subtract; this is the rule the teacher is
   * actually shown, and removing the deadline from the query has to fail it.
   */
  const fresh = missMore(klass.id, 1, 1);
  await judge(klass.id, teacher.token);
  const soonList = await api(`/monthly/classes/${klass.id}/missed`, { token: teacher.token });
  const recent = soonList.body?.missed?.find((m) => m.id === fresh[0]);
  check("a class missed an hour ago does not count against them yet", recent?.countsAgainstYou === false, JSON.stringify(recent));
  check("and they are told how long they have", (recent?.hoursLeft ?? 0) > 40, `${recent?.hoursLeft} hours left`);
  const standingNow = await api("/monthly/plan", { token: teacher.token });
  check("so it is not a black mark either", standingNow.body?.standing?.abuses === 2, `${standingNow.body?.standing?.abuses} marks`);

  const at = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
  const made = await api(`/monthly/classes/${klass.id}/makeups`, { method: "POST", token: teacher.token, body: { missedDayId: missed[0], at } });
  check("a make-up can be arranged", made.status === 201, `status ${made.status} ${JSON.stringify(made.body)?.slice(0, 140)}`);
  check("and it is counted against the five", made.body?.makeups?.used === 1, `used ${made.body?.makeups?.used}`);
  check("the students are told about it", made.body?.studentsTold >= 1, `told ${made.body?.studentsTold}`);

  const row = sql(`select kind, status, makeup_for_id from recurring_days where id = ${idFrom(made, "makeup.id", "the make-up class")}`).split("|");
  check("it is written down as a make-up for that class", row[0] === "makeup" && Number(row[2]) === missed[0], row.join("|"));

  const again = await api(`/monthly/classes/${klass.id}/makeups`, { method: "POST", token: teacher.token, body: { missedDayId: missed[0], at: new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString() } });
  check("a class cannot be made up twice", again.status === 409, `status ${again.status}`);

  const notMissed = sql(`select id from recurring_days where recurring_id = ${klass.id} and status = 'planned' limit 1`);
  const bogus = await api(`/monthly/classes/${klass.id}/makeups`, { method: "POST", token: teacher.token, body: { missedDayId: Number(notMissed), at } });
  check("a class that was not missed cannot be made up", bogus.status === 409, `status ${bogus.status}`);

  const past = await api(`/monthly/classes/${klass.id}/makeups`, { method: "POST", token: teacher.token, body: { missedDayId: missed[1], at: new Date(Date.now() - 3600_000).toISOString() } });
  check("a make-up cannot be in the past", past.status === 400, `status ${past.status}`);

  const stranger = await register("teacher");
  const notYours = await api(`/monthly/classes/${klass.id}/makeups`, { method: "POST", token: stranger.token, body: { missedDayId: missed[1], at } });
  check("somebody else cannot arrange one", notYours.status === 403, `status ${notYours.status}`);

  // And the make-up clears the black mark it answers for.
  const after = await api(`/monthly/classes/${klass.id}/missed`, { token: teacher.token });
  const cleared = after.body?.missed?.find((m) => m.id === missed[0]);
  check("arranging a make-up clears that black mark", cleared?.countsAgainstYou === false, JSON.stringify(cleared));
  check("and records when the make-up is", Boolean(cleared?.madeUpAt), JSON.stringify(cleared));
}

async function makeupLimitTests() {
  console.log("\nThe five make-ups, and the forty-class ceiling");

  /*
   * Missed an hour ago, not three days ago.
   *
   * Seven classes missed three days ago is seven black marks, which suspends the teacher before
   * the fifth make-up is even asked for — correct behaviour, and it tests suspension for a
   * second time rather than testing the make-up allowance at all. Inside the forty-eight hours
   * they are still classes to put right, which is the situation this limit is about.
   */
  const { teacher, klass, planId } = await teacherWithClass({ monthlyPrice: 0 });
  const missed = missClasses(klass.id, planId, 7, 1);
  check("setup: seven classes were missed", missed.length === 7, `${missed.length}`);
  const marks = Number(sql(`select count(*) from recurring_days where recurring_id = ${klass.id}
      and status = 'missed' and missed_at < now() - interval '48 hours'`));
  check("setup: and none of them counts against the teacher yet", marks === 0, `${marks} already count`);
  await judge(klass.id, teacher.token);

  const results = [];
  for (let i = 0; i < 6; i += 1) {
    const at = new Date(Date.now() + (i + 2) * 24 * 3600 * 1000).toISOString();
    results.push(await api(`/monthly/classes/${klass.id}/makeups`, { method: "POST", token: teacher.token, body: { missedDayId: missed[i], at } }));
  }
  const allowed = results.filter((r) => r.status === 201).length;
  check("five make-ups are allowed", allowed === 5, `${allowed} allowed`);
  check("and the sixth is refused", results[5].status === 409, `status ${results[5].status}`);
  check("with a reason a teacher can read", /make-up/i.test(results[5].body?.error ?? ""), results[5].body?.error);

  const written = Number(sql(`select count(*) from recurring_days where recurring_id = ${klass.id} and kind = 'makeup'`));
  check("and no sixth make-up was written", written === 5, `${written} written`);
}

async function abuseAndSuspensionTests() {
  console.log("\nFive black marks and a suspension");

  const { teacher, klass, planId } = await teacherWithClass({ monthlyPrice: 3000 });
  const students = await Promise.all([register("student"), register("student")]);
  for (const s of students) {
    await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: s.token, body: {} });
  }
  const paid = Number(sql(`select amount_paid from recurring_enrollments where recurring_id = ${klass.id} limit 1`));
  check("setup: the students paid for the month", paid > 0, `paid ${paid}`);

  // Four marks: warned, not suspended.
  missClasses(klass.id, planId, 4);
  await judge(klass.id, teacher.token);
  const four = await api("/monthly/plan", { token: teacher.token });
  check("four missed classes are four black marks", four.body?.standing?.abuses === 4, `${four.body?.standing?.abuses}`);
  check("and they are warned", four.body?.standing?.warn === true, JSON.stringify(four.body?.standing));
  check("but not suspended", four.body?.standing?.suspended === false, JSON.stringify(four.body?.standing));
  check("the plan is still running", four.body?.plan?.status === "active", `status ${four.body?.plan?.status}`);

  // A make-up takes one back off, which must un-warn them at three.
  const at = new Date(Date.now() + 4 * 24 * 3600 * 1000).toISOString();
  const missedIds = sql(`select id from recurring_days where recurring_id = ${klass.id} and status = 'missed' order by scheduled_for asc limit 1`);
  await api(`/monthly/classes/${klass.id}/makeups`, { method: "POST", token: teacher.token, body: { missedDayId: Number(missedIds), at } });
  const three = await api("/monthly/plan", { token: teacher.token });
  check("arranging a make-up takes a black mark back off", three.body?.standing?.abuses === 3, `${three.body?.standing?.abuses}`);

  // Now push to five.
  const more = missMore(klass.id, 2);
  check("setup: two more classes were missed", more.length === 2, `${more.length}`);
  await judge(klass.id, teacher.token);

  const five = await api("/monthly/plan", { token: teacher.token });
  check("five black marks suspends the class", five.body?.plan?.status === "suspended", `status ${five.body?.plan?.status}`);
  check("for thirty days", Boolean(five.body?.plan?.suspendedUntil), `until ${five.body?.plan?.suspendedUntil}`);
  check("with a reason in words a teacher can read", /suspended/i.test(five.body?.plan?.suspendedReason ?? ""), five.body?.plan?.suspendedReason);

  const refunds = Number(sql(`select count(*) from refunds where recurring_id = ${klass.id} and reason = 'monthly_suspension'`));
  check("every student is refunded", refunds === students.length, `${refunds} refunds for ${students.length} students`);

  const owed = Number(sql(`select coalesce(sum(amount),0) from refunds where recurring_id = ${klass.id}`));
  check("and the refunds are worth something", owed > 0, `${owed} owed`);

  const stillActive = Number(sql(`select count(*) from recurring_enrollments where recurring_id = ${klass.id} and status = 'active'`));
  check("no student is left holding a place in a suspended class", stillActive === 0, `${stillActive} still active`);

  const closed = sql(`select status from recurring_sessions where id = ${klass.id}`);
  check("the class itself is ended", closed === "ended", `status "${closed}"`);

  // Reading again must not refund anybody a second time.
  await judge(klass.id, teacher.token);
  await judge(klass.id, teacher.token);
  const twice = Number(sql(`select count(*) from refunds where recurring_id = ${klass.id}`));
  check("reading again does not refund anybody twice", twice === refunds, `${twice} refunds after re-reading, was ${refunds}`);

  const newStudent = await register("student");
  const barred = await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: newStudent.token, body: {} });
  check("and nobody can join a suspended class", barred.status >= 400, `status ${barred.status}`);
}

async function suspendedLateTests() {
  console.log("\nSuspended near the end of a month the teacher had otherwise delivered");

  /*
   * The case where the two refund rules disagree, and the only one that proves which is used.
   *
   * A teacher held twenty-five of thirty — exactly the floor — and then five misses catch up
   * with them on day twenty-five. The delivery floor says they owe nothing. But the month has
   * stopped with five days still on it, and the owner was explicit that a suspended teacher's
   * students get the remaining period back.
   *
   * Every other suspension test has a teacher who held almost nothing, where both rules give
   * the same answer and neither is being tested.
   */
  const { klass, planId } = await teacherWithClass({ monthlyPrice: 3000 });
  const student = await register("student");
  await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: student.token, body: {} });

  const all = sql(`select id from recurring_days where recurring_id = ${klass.id} and cycle_index = 0
      order by scheduled_for asc`).split("\n").filter(Boolean);
  // The month is on day twenty-nine and its classes finished yesterday.
  ageClass(klass.id, planId, 29);
  shiftDaysOnly(klass.id, 1);
  sql(`update recurring_days set status = 'held', held_at = scheduled_for where id in (${all.slice(0, 25).join(",")})`);
  sql(`update recurring_days set status = 'missed', missed_at = now() - interval '72 hours'
       where id in (${all.slice(25, 30).join(",")})`);

  const held = Number(sql(`select count(*) from recurring_days where recurring_id = ${klass.id} and status = 'held'`));
  check("setup: twenty-five classes were held — exactly the floor", held === 25, `${held} held`);
  const marks = Number(sql(`select count(*) from recurring_days where recurring_id = ${klass.id}
      and status = 'missed' and missed_at < now() - interval '48 hours'`));
  check("setup: and five went unmade-up", marks === 5, `${marks} marks`);
  const monthLeft = Number(sql(`select round(extract(epoch from (cycle_anchor + interval '30 days' - now())) / 3600)
      from teacher_plans where id = ${planId}`));
  check("setup: the month has not ended", monthLeft > 0, `${monthLeft} hours left of the month`);

  await api(`/monthly/classes/${klass.id}`, { token: student.token });

  const status = sql(`select status from teacher_plans where id = ${planId}`);
  check("five unmade-up misses suspend them", status === "suspended", `status "${status}"`);

  const refund = sql(`select amount, reason from refunds where recurring_id = ${klass.id}`).split("|");
  check("the student is refunded for the days that will not now happen", Number(refund[0]) > 0,
    `refund ${refund[0]} — the delivery floor would have said nothing was owed`);
  check("and it is recorded as a suspension refund", refund[1] === "monthly_suspension", `reason "${refund[1]}"`);
  /*
   * Twenty-five of the thirty they paid for happened, so five thirtieths comes back: 500.
   *
   * The delivery floor would say nothing is owed, because twenty-five *is* the floor. That is
   * the whole point of this test — swapping the rule here has to change this number.
   */
  check("worth the classes they will not get", Number(refund[0]) === 500, `${refund[0]}, expected 500`);
}

async function cycleCloseTests() {
  console.log("\nClosing a month that fell short");

  const { teacher, klass, planId } = await teacherWithClass({ monthlyPrice: 3000 });
  const student = await register("student");
  const joined = await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: student.token, body: {} });
  const paid = joined.body?.enrolment?.amountPaid ?? 0;
  check("setup: the student paid a full month", paid === 3000, `paid ${paid}`);

  // The teacher holds twenty of thirty, then the month ends.
  const all = sql(`select id from recurring_days where recurring_id = ${klass.id} and cycle_index = 0
      order by scheduled_for asc`).split("\n").filter(Boolean);
  ageClass(klass.id, planId, 31);
  sql(`update recurring_days set status = 'held', held_at = scheduled_for
       where id in (${all.slice(0, 20).join(",")})`);
  sql(`update recurring_days set status = 'missed', missed_at = scheduled_for
       where id in (${all.slice(20).join(",")})`);

  await judge(klass.id, student.token);

  const settled = Number(sql(`select settled_through_cycle from teacher_plans where id = ${planId}`));
  check("the finished month is settled", settled === 0, `settled through ${settled}`);

  const refund = sql(`select amount, teacher_share, platform_share, reason, session_id from refunds
      where recurring_id = ${klass.id} and cycle_index = 0`).split("|");
  check("a refund is written for the shortfall", refund[3] === "monthly_shortfall", `reason "${refund[3]}"`);
  check("worth ten thirtieths of the month", Number(refund[0]) === 1000, `${refund[0]}`);
  check("and it is not pinned to any one class", refund[4] === "", `session_id "${refund[4]}"`);
  check("what the two sides keep adds back to what was paid",
    Number(refund[0]) + Number(refund[1]) + Number(refund[2]) === paid,
    `${refund[0]} + ${refund[1]} + ${refund[2]} ≠ ${paid}`);
  check("and it comes out of the teacher's share first", Number(refund[1]) === 2100 - 1000, `teacher keeps ${refund[1]}`);

  // Closing again must not pay again.
  await judge(klass.id, student.token);
  await judge(klass.id, student.token);
  const rows = Number(sql(`select count(*) from refunds where recurring_id = ${klass.id}`));
  check("a month is only ever closed once", rows === 1, `${rows} refunds`);

  // It also appears in the queue an agent actually works.
  /*
   * Scoped to this student, not paged through.
   *
   * The queue is ordered oldest-first and cuts off at a page; asking for the whole thing and
   * looking for one row passed for the wrong reason once already, on Discover. Asking for the
   * student names the row.
   */
  const agent = await makeAgent();
  const queue = await api(`/admin/refunds?studentId=${student.user.id}`, { token: agent.token });
  const rowsFor = queue.body?.refunds ?? [];
  check("the agent's refund queue shows it", rowsFor.some((r) => r.reason === "monthly_shortfall"),
    `${rowsFor.length} rows for this student: ${JSON.stringify(rowsFor.map((r) => r.reason))}`);
  check("and it says what it is worth", rowsFor.some((r) => r.amount === 1000),
    JSON.stringify(rowsFor.map((r) => r.amount)));
}

async function deliveredMonthTests() {
  console.log("\nClosing a month that was delivered");

  const { klass, planId } = await teacherWithClass({ monthlyPrice: 3000 });
  const student = await register("student");
  await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: student.token, body: {} });

  const all = sql(`select id from recurring_days where recurring_id = ${klass.id} and cycle_index = 0
      order by scheduled_for asc`).split("\n").filter(Boolean);
  ageClass(klass.id, planId, 31);
  // Twenty-eight held, two missed: over the floor, so nothing is owed.
  sql(`update recurring_days set status = 'held', held_at = scheduled_for where id in (${all.slice(0, 28).join(",")})`);
  sql(`update recurring_days set status = 'missed', missed_at = scheduled_for where id in (${all.slice(28).join(",")})`);

  await judge(klass.id, student.token);

  const rows = Number(sql(`select count(*) from refunds where recurring_id = ${klass.id}`));
  check("a teacher who delivered the month owes nothing", rows === 0, `${rows} refunds written`);
  const settled = Number(sql(`select settled_through_cycle from teacher_plans where id = ${planId}`));
  check("but the month is still closed", settled === 0, `settled through ${settled}`);
  const ended = sql(`select status from recurring_enrollments where recurring_id = ${klass.id} limit 1`);
  check("and the student's place is closed rather than left open", ended === "ended", `status "${ended}"`);

  const second = Number(sql(`select count(*) from recurring_days where recurring_id = ${klass.id} and cycle_index = 1`));
  check("the next month has its classes", second > 0, `${second} class-days in month two`);
}

async function enforcementConcurrencyTests() {
  console.log("\nTen people opening a class at the moment it is settled");

  /*
   * Settling happens on the read path, so ten people opening the class at the instant its month
   * ends are ten attempts to close the same month — and closing a month writes refunds.
   *
   * Calling it twice in a row is caught by a cheaper guard: the second call re-reads the plan,
   * sees the month already settled, and does nothing. Only the lock inside the transaction
   * stops ten *simultaneous* calls, and nothing exercised it — removing that lock left the
   * whole suite green.
   */
  {
    const { klass, planId } = await teacherWithClass({ monthlyPrice: 3000 });
    const students = await Promise.all(Array.from({ length: 3 }, () => register("student")));
    for (const s of students) {
      await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: s.token, body: {} });
    }

    const all = sql(`select id from recurring_days where recurring_id = ${klass.id} and cycle_index = 0
        order by scheduled_for asc`).split("\n").filter(Boolean);
    ageClass(klass.id, planId, 31);
    sql(`update recurring_days set status = 'held', held_at = scheduled_for where id in (${all.slice(0, 20).join(",")})`);
    sql(`update recurring_days set status = 'missed', missed_at = scheduled_for where id in (${all.slice(20).join(",")})`);

    await Promise.all(Array.from({ length: 10 }, () => api(`/monthly/classes/${klass.id}`)));

    const refunds = Number(sql(`select count(*) from refunds where recurring_id = ${klass.id} and cycle_index = 0`));
    check("a month closed by ten readers at once pays each student once", refunds === students.length,
      `${refunds} refunds for ${students.length} students`);
    const total = Number(sql(`select coalesce(sum(amount),0) from refunds where recurring_id = ${klass.id}`));
    check("and pays each of them the right amount, once", total === students.length * 1000,
      `${total} owed, expected ${students.length * 1000}`);
  }

  /*
   * The same for suspension, which also refunds everybody.
   */
  {
    const { klass, planId } = await teacherWithClass({ monthlyPrice: 3000 });
    const students = await Promise.all(Array.from({ length: 3 }, () => register("student")));
    for (const s of students) {
      await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: s.token, body: {} });
    }
    missClasses(klass.id, planId, 5);

    await Promise.all(Array.from({ length: 10 }, () => api(`/monthly/classes/${klass.id}`)));

    const status = sql(`select status from teacher_plans where id = ${planId}`);
    check("ten readers at once still suspend the teacher exactly once", status === "suspended", `status "${status}"`);
    const refunds = Number(sql(`select count(*) from refunds where recurring_id = ${klass.id}`));
    check("and refund each student exactly once", refunds === students.length,
      `${refunds} refunds for ${students.length} students`);

    const perStudent = sql(`select count(*) from (
        select student_id from refunds where recurring_id = ${klass.id}
        group by student_id having count(*) > 1) d`);
    check("nobody is paid twice", Number(perStudent) === 0, `${perStudent} students paid more than once`);
  }
}

/* ------------------------------------------------------- money invariants */

async function moneyInvariants() {
  console.log("\nMoney invariants across everything written so far");

  const mine = `recurring_id in (${scope()})`;

  const written = Number(sql(`select count(*) from recurring_enrollments where ${mine}`));
  check("the sweep has rows to sweep", written > 0, `${written} enrolments from this run`);

  const bad = sql(`select count(*) from recurring_enrollments where ${mine} and platform_share + teacher_share <> amount_paid`);
  check("every place's two shares add back to what was paid", Number(bad) === 0, `${bad} rows do not`);

  const negative = sql(`select count(*) from recurring_enrollments where ${mine}
      and (amount_paid < 0 or platform_share < 0 or teacher_share < 0)`);
  check("nothing is negative", Number(negative) === 0, `${negative} rows are`);

  const overPaid = sql(`select count(*) from recurring_enrollments e
                        join recurring_sessions r on r.id = e.recurring_id
                        where e.${mine} and e.amount_paid > r.monthly_price`);
  check("nobody paid more than a full month", Number(overPaid) === 0, `${overPaid} rows did`);

  const overCount = sql(`select count(*) from recurring_enrollments where ${mine} and sessions_paid_for > sessions_planned`);
  check("nobody bought more classes than the month holds", Number(overCount) === 0, `${overCount} rows did`);

  const dupes = sql(`select count(*) from (
      select recurring_id, student_id, cycle_index from recurring_enrollments where ${mine}
      group by 1,2,3 having count(*) > 1) d`);
  check("nobody holds two places in one month", Number(dupes) === 0, `${dupes} duplicates`);

  const overSold = sql(`select count(*) from (
      select e.recurring_id, e.cycle_index
      from recurring_enrollments e join recurring_sessions r on r.id = e.recurring_id
      where e.${mine} and e.status = 'active'
      group by 1,2 having count(*) > max(r.max_students)) d`);
  check("no class holds more students than it has places", Number(overSold) === 0, `${overSold} oversold`);

  const paidTwice = sql(`select count(*) from (
      select recurring_id, student_id, cycle_index from refunds
      where recurring_id in (${scope()})
      group by 1,2,3 having count(*) > 1) d`);
  check("nobody is refunded twice for the same month", Number(paidTwice) === 0, `${paidTwice} paid twice`);

  const overRefunded = sql(`select count(*) from refunds
      where recurring_id in (${scope()}) and amount > price_paid`);
  check("nobody is refunded more than they paid", Number(overRefunded) === 0, `${overRefunded} rows`);

  const shares = sql(`select count(*) from refunds
      where recurring_id in (${scope()}) and amount + teacher_share + platform_share <> price_paid`);
  check("every refund's three parts add back to what was paid", Number(shares) === 0, `${shares} rows do not`);

  const ghostDays = sql(`select count(*) from (
      select recurring_id, scheduled_for, kind from recurring_days where ${mine}
      group by 1,2,3 having count(*) > 1) d`);
  check("no class-day exists twice", Number(ghostDays) === 0, `${ghostDays} duplicated`);
}

async function main() {
  console.log(`Monthly tier suite → ${API}`);
  await section("planTests", planTests);
  await section("classTests", classTests);
  await section("joinTests", joinTests);
  await section("roundingTest", roundingTest);
  await section("proRatingTests", proRatingTests);
  await section("syncTests", syncTests);
  await section("capacityTests", capacityTests);
  await section("concurrencyTests", concurrencyTests);
  await section("classDayTests", classDayTests);
  await section("lateJoinerTests", lateJoinerTests);
  await section("concurrentMaterialiseTest", concurrentMaterialiseTest);
  await section("ledgerTests", ledgerTests);
  await section("ruleTests", ruleTests);
  await section("timeChangeTests", timeChangeTests);
  await section("timeChangeEdgeTests", timeChangeEdgeTests);
  await section("makeupTests", makeupTests);
  await section("makeupLimitTests", makeupLimitTests);
  await section("abuseAndSuspensionTests", abuseAndSuspensionTests);
  await section("suspendedLateTests", suspendedLateTests);
  await section("cycleCloseTests", cycleCloseTests);
  await section("deliveredMonthTests", deliveredMonthTests);
  await section("enforcementConcurrencyTests", enforcementConcurrencyTests);
  await section("moneyInvariants", moneyInvariants);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
