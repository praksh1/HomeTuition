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

const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";

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
                   from recurring_enrollments where id = ${joined.body.enrolment.id}`).split("|");
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
  const [platform, teacherShare] = sql(`select platform_share, teacher_share from recurring_enrollments where id = ${joined.body.enrolment.id}`).split("|").map(Number);
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

  // Now run the month right down. Nobody may buy a month that has no classes left in it.
  ageClass(klass.id, planId, 10);
  const left = Number(sql(`select count(*) from recurring_days where recurring_id = ${klass.id} and scheduled_for > now()`));
  check("setup: no classes remain", left === 0, `${left} still ahead`);

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

  const oldRow = Number(sql(`select cycle_index from recurring_enrollments where id = ${joined.body.enrolment.id}`));
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

  const discover = await api("/sessions?limit=100");
  const listed = (discover.body?.sessions ?? discover.body ?? []).some?.((x) => x.id === sessionId);
  check("monthly class-days are not offered in Discover", listed !== true, `session ${sessionId} was listed`);

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
  const sessionId = Number(sql(`select session_id from recurring_days where recurring_id = ${klass.id}
      and session_id is not null and status = 'planned' order by scheduled_for asc limit 1`) || 0);
  check("setup: a class exists already", sessionId > 0, `session_id ${sessionId}`);

  const late = await register("student");
  await api(`/monthly/classes/${klass.id}/join`, { method: "POST", token: late.token, body: {} });

  const inIt = Number(sql(`select count(*) from session_enrollments where session_id = ${sessionId}
      and student_id = ${late.user.id} and payment_status = 'paid'`));
  check("the late joiner is put into the class that already existed", inIt === 1, `found ${inIt}`);

  const counted = Number(sql(`select enrolled_count from sessions where id = ${sessionId}`));
  const actual = Number(sql(`select count(*) from session_enrollments where session_id = ${sessionId}`));
  check("and the class's headcount matches its enrolments", counted === actual, `${counted} counted, ${actual} rows`);
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
  const missed = Number(sql(`select count(*) from recurring_days where recurring_id = ${klass.id} and status = 'missed'`));
  check("a class nobody started is written down as missed", missed >= 1, `${missed} missed`);

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

  // Eighteen hours' notice, judged against the next class.
  sql(`update recurring_days set status = 'cancelled' where recurring_id = ${klass.id} and scheduled_for < now() + interval '10 hours'`);
  const soon = await api(`/monthly/classes/${klass.id}/time`, { method: "PATCH", token: teacher.token, body: { startMinute: 600 } });
  check("a class inside eighteen hours cannot be moved", soon.status === 409 || soon.status === 501,
    `status ${soon.status} ${JSON.stringify(soon.body)?.slice(0, 120)}`);

  const missing = await api("/monthly/classes/999999");
  check("an unknown class is a 404, not a crash", missing.status === 404, `status ${missing.status}`);

  const badTime = await api(`/monthly/classes/${klass.id}/time`, { method: "PATCH", token: teacher.token, body: { startMinute: 1500 } });
  check("a time outside the day is refused", badTime.status === 400, `status ${badTime.status}`);

  const anon = await api(`/monthly/classes/${klass.id}/join`, { method: "POST", body: {} });
  check("a signed-out visitor cannot join", anon.status === 401, `status ${anon.status}`);
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

  const ghostDays = sql(`select count(*) from (
      select recurring_id, scheduled_for, kind from recurring_days where ${mine}
      group by 1,2,3 having count(*) > 1) d`);
  check("no class-day exists twice", Number(ghostDays) === 0, `${ghostDays} duplicated`);
}

async function main() {
  console.log(`Monthly tier suite → ${API}`);
  await planTests();
  await classTests();
  await joinTests();
  await roundingTest();
  await proRatingTests();
  await syncTests();
  await capacityTests();
  await concurrencyTests();
  await classDayTests();
  await lateJoinerTests();
  await ledgerTests();
  await ruleTests();
  await moneyInvariants();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
