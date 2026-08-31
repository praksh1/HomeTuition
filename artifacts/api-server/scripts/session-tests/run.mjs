/**
 * When a class may be started, and when a force-closed one stops blocking the next.
 *
 * Both reported from a real session, and both were possible:
 *
 *   "A teacher could go back to past calls and start them ... It is a HARD NO."
 *   "started another session but could not join because it says You still have an active
 *    session. There was no way going back to the active session either!"
 *
 * These drive the real API against a real database, because both rules are about rows and
 * sockets rather than arithmetic — the arithmetic itself is covered in src/lib/sessionStart.test.ts.
 *
 * Usage: API_URL=http://127.0.0.1:8080 node scripts/session-tests/run.mjs
 * Needs PGURL to age rows past the windows without waiting hours.
 */
import { WebSocket } from "ws";
import { execFileSync } from "node:child_process";
import { prepareTeacherForClass } from "../test-support/teacherAccess.mjs";

const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const WS = API.replace(/^http/, "ws");
const PGURL = process.env.PGURL ?? "postgres://postgres@127.0.0.1:55432/ht";

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

function sql(statement) {
  return execFileSync("psql", [PGURL, "-tAc", statement], { encoding: "utf8" }).trim();
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
async function register(role) {
  seq += 1;
  const res = await api("/auth/register", { method: "POST", body: {
    name: `${role} ${seq}`, email: `st_${Date.now()}_${seq}@example.com`, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  if (role === "teacher") prepareTeacherForClass(res.body.user.id);
  return res.body;
}

/**
 * A class, at any point on the clock.
 *
 * A class **in the past is aged into it afterwards**, not created there. The API refuses a
 * back-dated class now, and rightly: a teacher created one, it sat in the Upcoming list saying
 * "Session Expired", and a student bought it and was told their teacher was 2,279 minutes late.
 *
 * So the only honest way to get an old class is the way a real one gets old — it is created
 * ahead and the clock passes it. That is what the update below stands in for.
 */
async function createSession(teacher, { minutesFromNow = 5, duration = 60 } = {}) {
  const backdated = minutesFromNow < 0;
  const res = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: `Class ${++seq}`, subject: "Maths", description: "d",
    date: new Date(Date.now() + (backdated ? 60 : minutesFromNow) * 60_000).toISOString(),
    duration, price: 500, maxStudents: 10 } });
  if (res.status > 201) throw new Error(`create session: ${res.status} ${JSON.stringify(res.body)}`);

  if (backdated) {
    sql(`update sessions set date = now() - interval '${Math.abs(minutesFromNow)} minutes' where id = ${res.body.id}`);
    return { ...res.body, date: new Date(Date.now() + minutesFromNow * 60_000).toISOString() };
  }
  return res.body;
}

const goLive = (teacher, id) => api(`/sessions/${id}`, { method: "PATCH", token: teacher.token, body: { status: "live" } });
const endClass = (teacher, id) => api(`/sessions/${id}`, { method: "PATCH", token: teacher.token, body: { status: "completed" } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function classroomSocket(token, sessionId, name) {
  const ws = new WebSocket(`${WS}/api/ws?sessionId=${sessionId}&token=${encodeURIComponent(token)}&name=${name}`);
  ws.on("error", () => {});
  return { ws, open: () => new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); }) };
}

async function testCannotStartAnOldClass() {
  console.log("\nA class that is over stays over");
  const teacher = await register("teacher");

  const fresh = await createSession(teacher);
  check("a class scheduled for shortly can be started", (await goLive(teacher, fresh.id)).status === 200);
  await endClass(teacher, fresh.id);

  // Ended a moment ago: the teacher may have hung up by accident.
  const again = await goLive(teacher, fresh.id);
  check("a class just ended can be restarted", again.status === 200, `status ${again.status}`);
  await endClass(teacher, fresh.id);

  /**
   * Aged past the window by moving its booked slot, which is what the rule reads.
   *
   * It used to be aged by moving `session_activity.ended_at`, and that stopped meaning
   * anything: the window is now measured from the *scheduled* finish, not from when the
   * teacher happened to hang up. A teacher who starts twenty minutes late does not get twenty
   * extra minutes at the end, and a class whose slot is still open is still open however long
   * ago they ended it.
   */
  sql(`update sessions set date = now() - interval '4 hours' where id = ${fresh.id}`);
  const stale = await goLive(teacher, fresh.id);
  check("a class whose slot finished hours ago cannot be restarted", stale.status === 409, `status ${stale.status}`);
  check("and the teacher is told why", /no longer be opened/i.test(stale.body?.error ?? ""), stale.body?.error ?? "");

  // The other end of the same window: nine minutes past a booked finish is still a recovery.
  const recent = await createSession(teacher);
  await goLive(teacher, recent.id);
  await endClass(teacher, recent.id);
  sql(`update sessions set date = now() - interval '69 minutes' where id = ${recent.id}`);
  const reopened = await goLive(teacher, recent.id);
  check("nine minutes past the finish it can still be reopened", reopened.status === 200, `status ${reopened.status}`);
  await endClass(teacher, recent.id);
  sql(`update sessions set date = now() - interval '71 minutes' where id = ${recent.id}`);
  const tooLate = await goLive(teacher, recent.id);
  check("eleven minutes past the finish it cannot", tooLate.status === 409, `status ${tooLate.status}`);

  // The reported case: scrolling back to a class from days ago and starting it.
  const old = await createSession(teacher, { minutesFromNow: -60 * 30 });
  const started = await goLive(teacher, old.id);
  check("a class from days ago cannot be started at all", started.status === 409, `status ${started.status}`);

  // And an old class refused must not have been left live.
  const status = sql(`select status from sessions where id = ${old.id}`);
  check("refusing it leaves it alone rather than half-started", status !== "live", `status in db: ${status}`);
}

async function testForceCloseDoesNotBlockTheNextClass() {
  console.log("\nA force-closed class does not block the next one");
  const teacher = await register("teacher");

  const first = await createSession(teacher);
  check("the first class starts", (await goLive(teacher, first.id)).status === 200);

  const socket = classroomSocket(teacher.token, first.id, "T");
  await socket.open();
  await wait(600);
  const seen = sql(`select count(*) from session_activity where session_id = ${first.id} and teacher_last_seen_at is not null`);
  check("the teacher being in the room is recorded", seen === "1", `rows: ${seen}`);

  // While the teacher is really there, a second class is still refused — that rule stays.
  const second = await createSession(teacher);
  const blocked = await goLive(teacher, second.id);
  check("a second class is refused while the first is genuinely running", blocked.status === 409, `status ${blocked.status}`);
  check("and the running class is named so the app can offer it", Boolean(blocked.body?.liveSessionId), JSON.stringify(blocked.body));

  // Force-close: the socket dies and nothing comes back.
  socket.ws.terminate();
  sql(`update session_activity set teacher_last_seen_at = now() - interval '5 minutes' where session_id = ${first.id}`);
  sql(`update sessions set started_at = now() - interval '5 minutes' where id = ${first.id}`);

  const afterCrash = await goLive(teacher, second.id);
  check("after a force-close the next class starts", afterCrash.status === 200, `status ${afterCrash.status} ${JSON.stringify(afterCrash.body)}`);

  const firstStatus = sql(`select status from sessions where id = ${first.id}`);
  check("the abandoned class is closed rather than left live", firstStatus === "completed", `status: ${firstStatus}`);
}

async function testTeacherCanGetBackIntoTheirClass() {
  console.log("\nA teacher can get back into the class they are still in");
  const teacher = await register("teacher");
  const first = await createSession(teacher);
  await goLive(teacher, first.id);

  const socket = classroomSocket(teacher.token, first.id, "T");
  await socket.open();
  await wait(600);

  const second = await createSession(teacher);
  const blocked = await goLive(teacher, second.id);
  check("the refusal carries the class to return to", blocked.body?.liveSessionId === first.id,
    JSON.stringify(blocked.body));
  check("and its name, so the offer can say which one", blocked.body?.liveSessionTopic === first.topic,
    JSON.stringify(blocked.body));

  // Rejoining the class they are already in must simply work.
  const rejoin = await api(`/sessions/${first.id}/room`, { token: teacher.token });
  check("rejoining the running class is allowed", rejoin.status === 200, `status ${rejoin.status}`);
  socket.ws.close();
}

async function testAStudentCannotStartAnything() {
  console.log("\nOnly the teacher decides when a class runs");
  const teacher = await register("teacher");
  const student = await register("student");
  const s = await createSession(teacher);
  await api(`/sessions/${s.id}/book`, { method: "POST", token: student.token, body: {} });
  const attempt = await api(`/sessions/${s.id}`, { method: "PATCH", token: student.token, body: { status: "live" } });
  check("a student cannot take a class live", attempt.status === 403, `status ${attempt.status}`);
}

async function testInvitingIsOnlyTelling() {
  console.log("\nInviting a student tells them and nothing more");
  const teacher = await register("teacher");
  const follower = await register("student");
  const stranger = await register("student");

  // The follower is someone who chose this teacher; the stranger has no relationship at all.
  const me = await api("/auth/me", { token: teacher.token });
  const profileId = me.body?.teacher?.id;
  const followed = await api(`/teachers/${profileId}/follow`, { method: "POST", token: follower.token });
  check("a student can follow the teacher", followed.status === 201 || followed.status === 200, `status ${followed.status}`);

  const list = await api("/sessions/invitable-students", { token: teacher.token });
  check("the teacher can see who they may tell", list.status === 200, `status ${list.status}`);
  const ids = (list.body?.students ?? []).map((s) => s.id);
  check("their follower is on the list", ids.includes(follower.user.id), JSON.stringify(ids));
  check("a stranger is not", !ids.includes(stranger.user.id), JSON.stringify(ids));

  const asStudent = await api("/sessions/invitable-students", { token: follower.token });
  check("a student cannot read a teacher's student list", asStudent.status === 403, `status ${asStudent.status}`);

  // Invite both. The stranger must be silently dropped rather than reached.
  // Five minutes out, so the class is inside its own window. An hour out it is not: the doors
  // now open ten minutes before the booked start, and a teacher cannot take a class live
  // before that — which used to be possible and pulled anyone already looking at it into a
  // call for a lesson that had not begun.
  const created = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: "Invited class", subject: "Maths", description: "d",
    date: new Date(Date.now() + 5 * 60_000).toISOString(), duration: 60, price: 500, maxStudents: 10,
    inviteStudentIds: [follower.user.id, stranger.user.id] } });
  check("the class is created", created.status === 201, `status ${created.status}`);
  const sessionId = created.body.id;

  // The rule the owner underlined: an invitation must not be a way in.
  const enrolments = sql(`select count(*) from session_enrollments where session_id = ${sessionId}`);
  check("inviting enrols nobody", enrolments === "0", `enrolments: ${enrolments}`);

  const paid = sql(`select count(*) from session_enrollments where session_id = ${sessionId} and payment_status = 'paid'`);
  check("and pays for nobody", paid === "0", `paid rows: ${paid}`);

  // An invited student who has not booked is refused at the door, exactly like anyone else.
  const wentLive = await goLive(teacher, sessionId);
  // Asserted rather than assumed: this step was unchecked, so a refusal here would have made
  // everything below it meaningless while still reporting a pass.
  check("the teacher can take it live", wentLive.status === 200, `status ${wentLive.status} ${JSON.stringify(wentLive.body ?? {})}`);
  const door = await api(`/sessions/${sessionId}/room`, { token: follower.token });
  check("an invited student who has not paid cannot enter", door.status === 403, `status ${door.status}`);

  // And once they book and pay, they can — the invitation changed nothing either way.
  const booked = await api(`/sessions/${sessionId}/book`, { method: "POST", token: follower.token, body: {} });
  check("they can book normally", booked.status === 200 || booked.status === 201, `status ${booked.status}`);
  const after = await api(`/sessions/${sessionId}/room`, { token: follower.token });
  check("and then they are let in", after.status === 200, `status ${after.status}`);
}

async function testSurvivesAMissingActivityTable() {
  console.log("\nThe class rules survive a database that has not caught up yet");
  const teacher = await register("teacher");
  const first = await createSession(teacher);
  check("a class starts normally", (await goLive(teacher, first.id)).status === 200);

  // The API redeploys itself on a push while db:push is run by hand, so for a few minutes the
  // code is newer than the database. Shipping this table without allowing for that took the
  // live site down: starting any class returned 500. Reproduced here by removing it.
  sql(`update sessions set started_at = now() - interval '10 minutes' where id = ${first.id}`);
  sql("drop table if exists session_activity");

  const second = await createSession(teacher);
  const blocked = await goLive(teacher, second.id);
  check(
    "a teacher is still refused a second class rather than getting a 500",
    blocked.status === 409,
    `status ${blocked.status}`,
  );

  // The dangerous half: with no presence to read, "unknown" must not be taken for "gone".
  const status = sql(`select status from sessions where id = ${first.id}`);
  check(
    "a lesson in progress is not closed just because presence cannot be read",
    status === "live",
    `status: ${status}`,
  );

  // And a brand new class still starts, which is the thing that was actually broken.
  sql(`update sessions set status = 'completed' where id = ${first.id}`);
  const third = await createSession(teacher);
  const started = await goLive(teacher, third.id);
  check("a new class can still be started", started.status === 200, `status ${started.status}`);

  // Put it back for whatever runs next; the server recreates it at boot in real life.
  sql(`CREATE TABLE IF NOT EXISTS "session_activity" ("session_id" integer PRIMARY KEY, "teacher_last_seen_at" timestamp with time zone, "ended_at" timestamp with time zone, CONSTRAINT "session_activity_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE)`);
}

async function testAnExpiredClassGetsNoVideoRoom() {
  console.log("\nA class that is over gets no video room at all");
  const teacher = await register("teacher");
  const student = await register("student");

  const s1 = await createSession(teacher);
  await api(`/sessions/${s1.id}/book`, { method: "POST", token: student.token, body: {} });
  await goLive(teacher, s1.id);

  // While it is running, the room is handed over as normal.
  const live = await api(`/sessions/${s1.id}/room`, { token: teacher.token });
  check("a running class gives the teacher a room", live.status === 200, `status ${live.status}`);
  check("with a token to join it", Boolean(live.body?.roomUrl), JSON.stringify(live.body ?? {}).slice(0, 120));

  await endClass(teacher, s1.id);

  // Just ended: still available, because the teacher may have hung up by accident.
  const justEnded = await api(`/sessions/${s1.id}/room`, { token: teacher.token });
  check("a class just ended still gives a room", justEnded.status === 200, `status ${justEnded.status}`);

  // Aged past the window by its booked slot — the reported case was a class from three days
  // earlier, which means its slot was three days ago. See the note in the restart test above.
  sql(`update sessions set date = now() - interval '3 days' where id = ${s1.id}`);

  const expired = await api(`/sessions/${s1.id}/room`, { token: teacher.token });
  check("a class from days ago gives the teacher no room", expired.status === 409, `status ${expired.status}`);
  check("and no room URL to connect to", !expired.body?.roomUrl, JSON.stringify(expired.body ?? {}).slice(0, 160));
  check("and no meeting token", !expired.body?.token, JSON.stringify(expired.body ?? {}).slice(0, 160));
  check("and says why, in words a teacher can act on", /no longer be opened|expired/i.test(expired.body?.error ?? ""),
    expired.body?.error ?? "");

  // The student half of the same door.
  // The student is turned away by the membership check before the window is even consulted,
  // which is a stronger refusal, not a weaker one. What matters is that no room comes back —
  // asserting a particular status here would be testing the order of two guards rather than
  // the thing that protects anyone.
  const studentTry = await api(`/sessions/${s1.id}/room`, { token: student.token });
  check(
    "a student gets no room for it either",
    studentTry.status >= 400 && !studentTry.body?.roomUrl,
    `status ${studentTry.status} ${JSON.stringify(studentTry.body ?? {}).slice(0, 120)}`,
  );

  // And it must not have been quietly made live by asking.
  const status = sql(`select status from sessions where id = ${s1.id}`);
  check("asking for the room does not start the class", status !== "live", `status: ${status}`);
}

async function testAnOldScheduledClassGetsNoRoom() {
  console.log("\nA class whose time passed without ever running gets no room");
  const teacher = await register("teacher");
  // Scheduled for two days ago and never started — exactly what sits in the Completed list.
  const old = await createSession(teacher, { minutesFromNow: -60 * 48 });
  const room = await api(`/sessions/${old.id}/room`, { token: teacher.token });
  check("no room for a class whose slot is long past", room.status === 409, `status ${room.status}`);
  check("and no URL", !room.body?.roomUrl, JSON.stringify(room.body ?? {}).slice(0, 140));
}


async function testTheNewDoors() {
  console.log("\nThe doors open ten minutes before and shut on a schedule");
  const teacher = await register("teacher");
  const student = await register("student");

  /**
   * Too early is now a closed door in its own right.
   *
   * A teacher could previously open a class booked for next week, which pulled anyone already
   * looking at it into a call for a lesson that had not begun.
   */
  const soon = await createSession(teacher, { minutesFromNow: 40 });
  await api(`/sessions/${soon.id}/book`, { method: "POST", token: student.token, body: {} });

  const tooEarlyTeacher = await goLive(teacher, soon.id);
  check("a teacher cannot open a class forty minutes early", tooEarlyTeacher.status === 409, `status ${tooEarlyTeacher.status}`);
  check("and is told when it does open", /opens 10 minutes before/i.test(tooEarlyTeacher.body?.error ?? ""), tooEarlyTeacher.body?.error ?? "");

  const tooEarlyStudent = await api(`/sessions/${soon.id}/room`, { token: student.token });
  check("a student cannot get in that early either", tooEarlyStudent.status === 403 || tooEarlyStudent.status === 409, `status ${tooEarlyStudent.status}`);

  // Nine minutes out: the doors are open, for both of them.
  sql(`update sessions set date = now() + interval '9 minutes' where id = ${soon.id}`);
  const opened = await goLive(teacher, soon.id);
  check("nine minutes out, the teacher can open it", opened.status === 200, `status ${opened.status}`);
  const early = await api(`/sessions/${soon.id}/room`, { token: student.token });
  check("and the student can go in and wait", early.status === 200, `status ${early.status}`);

  /**
   * A student may sit in the room with no teacher in it.
   *
   * This is the owner's rule and it is also the evidence a refund is argued from: a student who
   * waited in an empty room must be able to have waited in an empty room. So the class is put
   * back to "upcoming" — the state a class the teacher never opened is actually in — and the
   * student is still let through.
   */
  sql(`update sessions set status = 'upcoming', started_at = null, date = now() - interval '20 minutes' where id = ${soon.id}`);
  const waiting = await api(`/sessions/${soon.id}/room`, { token: student.token });
  check("a student can go in when the teacher never turned up", waiting.status === 200, `status ${waiting.status}`);

  /**
   * And when the teacher ended early. The class is marked completed, which used to be an
   * outright refusal — the clock decides now, not the status.
   */
  sql(`update sessions set status = 'completed' where id = ${soon.id}`);
  const afterEarlyEnd = await api(`/sessions/${soon.id}/room`, { token: student.token });
  check("a student can still go in after the teacher ended early", afterEarlyEnd.status === 200, `status ${afterEarlyEnd.status}`);

  // Four minutes past the booked finish: still open. Seven: expired. Deliberately not five —
  // five is the exact instant the door shuts, and a test that sits on a boundary reports on
  // how long the request took rather than on the rule.
  sql(`update sessions set date = now() - interval '64 minutes' where id = ${soon.id}`);
  const grace = await api(`/sessions/${soon.id}/room`, { token: student.token });
  check("four minutes past the finish the student door is still open", grace.status === 200, `status ${grace.status}`);

  sql(`update sessions set date = now() - interval '67 minutes' where id = ${soon.id}`);
  const expired = await api(`/sessions/${soon.id}/room`, { token: student.token });
  check("seven minutes past, it is shut", expired.status === 403 || expired.status === 409, `status ${expired.status}`);

  // ...while the teacher's own door is still open for another few minutes.
  const teacherStillIn = await api(`/sessions/${soon.id}/room`, { token: teacher.token });
  check("the teacher's door outlasts the student's", teacherStillIn.status === 200, `status ${teacherStillIn.status}`);

  sql(`update sessions set date = now() - interval '75 minutes' where id = ${soon.id}`);
  const bothShut = await api(`/sessions/${soon.id}/room`, { token: teacher.token });
  check("and shuts ten minutes past the finish", bothShut.status === 409, `status ${bothShut.status}`);
}

async function main() {
  const health = await fetch(`${API}/api/healthz`).catch(() => null);
  if (!health?.ok) { console.error(`No API at ${API}. Start it first, or set API_URL.`); process.exit(1); }

  await testCannotStartAnOldClass();
  await testTheNewDoors();
  await testForceCloseDoesNotBlockTheNextClass();
  await testTeacherCanGetBackIntoTheirClass();
  await testAStudentCannotStartAnything();
  await testInvitingIsOnlyTelling();
  await testAnExpiredClassGetsNoVideoRoom();
  await testAnOldScheduledClassGetsNoRoom();
  await testSurvivesAMissingActivityTable();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
