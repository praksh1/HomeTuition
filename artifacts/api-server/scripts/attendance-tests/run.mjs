/**
 * Who was in the class, according to the server that watched it happen.
 *
 * This is the evidence a refund is argued from, and none of it can be tested usefully without
 * a real socket and a real database: what is being checked is not arithmetic — that lives in
 * src/lib/sessionEvidence.test.ts — but whether the classroom hub actually writes anything
 * down, whether it survives a disconnection, and whether the record can be read back by the
 * people who are allowed to read it and nobody else.
 *
 * Usage: API_URL=http://127.0.0.1:8080 node scripts/attendance-tests/run.mjs
 * PGURL is used to age a session past the "teacher is late" line without waiting ten minutes.
 */
import { WebSocket } from "ws";
import { execFileSync } from "node:child_process";

const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const WS = API.replace(/^http/, "ws");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";

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
async function register(role, name) {
  seq += 1;
  const res = await api("/auth/register", { method: "POST", body: {
    name: name ?? `${role} ${seq}`,
    email: `at_${Date.now()}_${seq}@example.com`,
    password: "password123",
    role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10" }),
  } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/**
 * A class with a real price on it. Free classes are refused — 0 was quietly creating free
 * classes on a paid platform and the check that stopped that is deliberate. Payments run in
 * simulated mode here, so booking still settles in a single step.
 */
async function createSession(teacher, { minutesFromNow = 2, duration = 60, price = 500 } = {}) {
  seq += 1;
  const res = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: `Attendance ${seq}`, subject: "Maths", description: "d",
    date: new Date(Date.now() + minutesFromNow * 60_000).toISOString(),
    duration, price, maxStudents: 10,
  } });
  if (res.status > 201) throw new Error(`create session: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function book(student, sessionId) {
  const res = await api(`/sessions/${sessionId}/book`, {
    method: "POST", token: student.token, body: { paymentMethod: "esewa" },
  });
  if (res.status > 201) throw new Error(`book: ${res.status} ${JSON.stringify(res.body)}`);
  return res;
}

/** A classroom socket, opened and awaited. */
function classroom(token, sessionId, name) {
  const ws = new WebSocket(
    `${WS}/api/ws?sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}&name=${encodeURIComponent(name)}`,
  );
  return {
    ws,
    open: () => new Promise((resolve, reject) => {
      if (ws.readyState === 1) return resolve();
      ws.once("open", resolve);
      ws.once("error", reject);
      ws.once("close", () => reject(new Error("classroom socket closed before opening")));
    }),
    send: (msg) => ws.send(JSON.stringify(msg)),
    /** Closes and waits, so the server's final flush has landed before anything is read. */
    close: () => new Promise((resolve) => { ws.once("close", () => setTimeout(resolve, 300)); ws.close(); }),
  };
}

/** The signed-in socket the app keeps open to hear about everything. */
function channel(token) {
  const ws = new WebSocket(`${WS}/api/ws?token=${encodeURIComponent(token)}`);
  const events = [];
  const waiters = [];
  ws.on("message", (raw) => {
    let data; try { data = JSON.parse(String(raw)); } catch { return; }
    if (data?.type !== "notification") return;
    events.push(data);
    for (const w of waiters.splice(0)) w(data);
  });
  return {
    open: () => new Promise((resolve, reject) => {
      if (ws.readyState === 1) return resolve();
      ws.once("open", resolve);
      ws.once("error", reject);
    }),
    next: (predicate, ms = 4000) => new Promise((resolve) => {
      const found = events.find(predicate);
      if (found) return resolve(found);
      const timer = setTimeout(() => resolve(null), ms);
      waiters.push((event) => { if (!predicate(event)) return; clearTimeout(timer); resolve(event); });
    }),
    close: () => ws.close(),
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The ledger row as the database holds it, so the test reads what was written, not what an API says. */
function ledgerRow(sessionId, userId) {
  const row = sql(
    `select role || '|' || present_ms || '|' || join_count || '|' || draw_count || '|' || message_count ` +
    `|| '|' || extract(epoch from first_joined_at) || '|' || extract(epoch from last_seen_at) ` +
    `from session_participation where session_id=${sessionId} and user_id=${userId}`,
  );
  if (!row) return null;
  const [role, presentMs, joinCount, drawCount, messageCount, firstJoined, lastSeen] = row.split("|");
  return {
    role,
    presentMs: Number(presentMs),
    joinCount: Number(joinCount),
    drawCount: Number(drawCount),
    messageCount: Number(messageCount),
    firstJoined: Number(firstJoined),
    lastSeen: Number(lastSeen),
  };
}

async function run() {
  console.log("\nThe ledger is written while the class runs\n");

  {
    const teacher = await register("teacher");
    const student = await register("student", "Sita Sharma");
    const session = await createSession(teacher);
    await book(student, session.id);

    const t = classroom(teacher.token, session.id, "Teacher");
    await t.open();
    const s = classroom(student.token, session.id, "Sita Sharma");
    await s.open();
    await wait(400);

    const arrivedTeacher = ledgerRow(session.id, teacher.user.id);
    const arrivedStudent = ledgerRow(session.id, student.user.id);
    check("a row appears the moment someone opens the classroom", !!arrivedTeacher && !!arrivedStudent);
    check("the teacher is recorded as the teacher", arrivedTeacher?.role === "teacher", arrivedTeacher?.role);
    check("the student is recorded as a student", arrivedStudent?.role === "student", arrivedStudent?.role);
    check("opening the classroom counts as one arrival", arrivedTeacher?.joinCount === 1, `joinCount=${arrivedTeacher?.joinCount}`);

    t.send({ type: "draw_commit", tool: "pen", color: "#000", width: 3, d: "M1,1 L2,2" });
    t.send({ type: "scene_update", elements: [{ id: "e1", version: 1, type: "rectangle" }] });
    // Refused by the sanitiser — a pen stroke with no path. Counted nowhere.
    t.send({ type: "draw_commit", tool: "pen", color: "#000", width: 3 });
    t.send({ type: "chat", text: "Good morning" });
    s.send({ type: "chat", text: "Namaste" });
    // A student trying to draw: refused by the hub, and must not be recorded as having drawn.
    s.send({ type: "draw_commit", tool: "pen", color: "#000", width: 3, d: "M5,5 L6,6" });
    await wait(400);

    await t.close();
    await s.close();

    const finalTeacher = ledgerRow(session.id, teacher.user.id);
    const finalStudent = ledgerRow(session.id, student.user.id);
    check("board writes are counted for the teacher", finalTeacher?.drawCount === 2, `drawCount=${finalTeacher?.drawCount}`);
    check("a malformed stroke the board refused is not counted as drawing",
      finalTeacher?.drawCount === 2, `a stroke with no path was also sent; drawCount=${finalTeacher?.drawCount}`);
    check("a student's refused stroke is not counted as drawing", finalStudent?.drawCount === 0, `drawCount=${finalStudent?.drawCount}`);
    check("chat is counted for whoever sent it", finalTeacher?.messageCount === 1 && finalStudent?.messageCount === 1,
      `teacher=${finalTeacher?.messageCount} student=${finalStudent?.messageCount}`);
    check("time in the room is written down when the socket closes",
      (finalTeacher?.presentMs ?? 0) >= 500, `presentMs=${finalTeacher?.presentMs}`);
    check("time in the room is not wildly overstated",
      (finalTeacher?.presentMs ?? 0) < 30_000, `presentMs=${finalTeacher?.presentMs}`);
  }

  console.log("\nA connection that drops and comes back\n");

  {
    const teacher = await register("teacher");
    const session = await createSession(teacher);

    const first = classroom(teacher.token, session.id, "Teacher");
    await first.open();
    await wait(500);
    await first.close();
    const afterFirst = ledgerRow(session.id, teacher.user.id);

    await wait(600);
    const second = classroom(teacher.token, session.id, "Teacher");
    await second.open();
    await wait(500);
    await second.close();
    const afterSecond = ledgerRow(session.id, teacher.user.id);

    check("rejoining counts as a second arrival", afterSecond?.joinCount === 2, `joinCount=${afterSecond?.joinCount}`);
    check("the first arrival time is never rewritten",
      Math.abs((afterSecond?.firstJoined ?? 0) - (afterFirst?.firstJoined ?? -1)) < 0.01,
      `${afterFirst?.firstJoined} vs ${afterSecond?.firstJoined}`);
    check("last seen moves forward", (afterSecond?.lastSeen ?? 0) > (afterFirst?.lastSeen ?? 0));
    check("time present adds up across both visits",
      (afterSecond?.presentMs ?? 0) > (afterFirst?.presentMs ?? 0), `${afterFirst?.presentMs} then ${afterSecond?.presentMs}`);
    check("the gap between visits is not counted as time present",
      (afterSecond?.presentMs ?? 0) < 1_800, `presentMs=${afterSecond?.presentMs} over ~1600ms of wall clock`);
  }

  console.log("\nReading the record back\n");

  {
    const teacher = await register("teacher");
    const attender = await register("student", "Bikash Thapa");
    const absentee = await register("student", "Gita Rai");
    const stranger = await register("student", "Nobody");
    const session = await createSession(teacher);
    await book(attender, session.id);
    await book(absentee, session.id);

    const t = classroom(teacher.token, session.id, "Teacher");
    await t.open();
    const a = classroom(attender.token, session.id, "Bikash Thapa");
    await a.open();
    t.send({ type: "draw_commit", tool: "pen", color: "#000", width: 3, d: "M1,1 L2,2" });
    await wait(500);
    await t.close();
    await a.close();

    const asTeacher = await api(`/sessions/${session.id}/attendance`, { token: teacher.token });
    check("the teacher may read the register", asTeacher.status === 200, `status=${asTeacher.status}`);
    const enrolled = asTeacher.body?.enrolled ?? [];
    check("everyone who paid is listed, whether they came or not", enrolled.length === 2, `listed ${enrolled.length}`);
    const came = enrolled.find((e) => e.userId === attender.user.id);
    const never = enrolled.find((e) => e.userId === absentee.user.id);
    check("the student who came is marked as having attended", came?.attended === true);
    check("the student who paid and never opened it is listed, marked absent", never?.attended === false);
    check("the absent student has no invented presence", never?.presentMs === 0 && never?.joinCount === 0);
    check("a student who never opened the class is called out in the findings",
      (asTeacher.body?.findings ?? []).some((f) => f.code === "student_never_joined" && f.userId === absentee.user.id));
    check("the server sends its own clock so a wrong phone clock cannot decide anything",
      typeof asTeacher.body?.serverTime === "string" && !Number.isNaN(Date.parse(asTeacher.body.serverTime)));
    check("the register knows it was read successfully", asTeacher.body?.known === true);

    const asStudent = await api(`/sessions/${session.id}/attendance`, { token: attender.token });
    check("a student who paid may read it", asStudent.status === 200, `status=${asStudent.status}`);
    check("a student is told about the teacher", asStudent.body?.teacher?.userId === teacher.user.id);
    check("a student is told about themselves", asStudent.body?.you?.userId === attender.user.id);
    check("a student is not handed the class register",
      asStudent.body?.enrolled === undefined && !JSON.stringify(asStudent.body).includes("Gita Rai"));

    const asStranger = await api(`/sessions/${session.id}/attendance`, { token: stranger.token });
    check("somebody with no place in the class is refused", asStranger.status === 403, `status=${asStranger.status}`);

    const anonymous = await api(`/sessions/${session.id}/attendance`);
    check("a signed-out request is refused", anonymous.status === 401, `status=${anonymous.status}`);
  }

  console.log("\nA teacher who has not turned up\n");

  {
    const teacher = await register("teacher");
    const student = await register("student", "Waiting Student");
    const session = await createSession(teacher, { minutesFromNow: 2 });
    await book(student, session.id);

    const s = classroom(student.token, session.id, "Waiting Student");
    await s.open();
    await wait(400);

    const early = await api(`/sessions/${session.id}/attendance`, { token: student.token });
    check("before the class is even due, the teacher is not late", early.body?.teacherIsLate === false);

    // Move the booked time back so the wait has been long enough, rather than waiting it out.
    sql(`update sessions set date = now() - interval '15 minutes' where id = ${session.id}`);
    const late = await api(`/sessions/${session.id}/attendance`, { token: student.token });
    check("fifteen minutes past the start with no teacher, the student is owed help",
      late.body?.teacherIsLate === true);
    check("no teacher means no arrival time to report", late.body?.teacherJoinedAt === null);

    const climbing = late.body?.teacherLateBy;
    check("the student is told how many minutes they have been waiting",
      typeof climbing === "number" && climbing >= 15, `teacherLateBy=${climbing}`);

    const t = classroom(teacher.token, session.id, "Teacher");
    await t.open();
    await wait(400);
    const arrived = await api(`/sessions/${session.id}/attendance`, { token: student.token });
    check("the teacher arriving is visible as an arrival time",
      typeof arrived.body?.teacherJoinedAt === "string");
    check("but arriving late does not un-make the wait, so help stays available",
      arrived.body?.teacherIsLate === true);

    await t.close();
    await s.close();
  }

  console.log("\nThe teacher is told when somebody books\n");

  {
    const teacher = await register("teacher");
    const student = await register("student", "Prakash Dhakal");
    const session = await createSession(teacher);

    const inbox = channel(teacher.token);
    await inbox.open();
    await wait(300);

    const booked = await book(student, session.id);
    check("the booking itself succeeds", booked.status === 201, `status=${booked.status}`);

    const event = await inbox.next((e) => e.kind === "session_booked");
    check("the teacher hears about it", !!event);
    check("the notification says which class", event?.sessionId === session.id, `sessionId=${event?.sessionId}`);
    check("the notification says who booked", event?.fromName === "Prakash Dhakal", `fromName=${event?.fromName}`);
    inbox.close();
  }

  console.log("\nA teacher who books somebody else's class is a student in it\n");

  {
    const host = await register("teacher");
    const guest = await register("teacher", "Guest Teacher");
    const session = await createSession(host);
    await book(guest, session.id);

    const g = classroom(guest.token, session.id, "Guest Teacher");
    await g.open();
    await wait(400);
    await g.close();

    const row = ledgerRow(session.id, guest.user.id);
    check("their part in this class is student, not teacher", row?.role === "student", `role=${row?.role}`);

    const read = await api(`/sessions/${session.id}/attendance`, { token: host.token });
    check("and the class still reads as having no teacher present",
      read.body?.teacher === null || read.body?.teacher === undefined,
      JSON.stringify(read.body?.teacher));
  }

  console.log("\nReporting a class that went wrong\n");

  {
    const teacher = await register("teacher");
    const student = await register("student", "Unhappy Student");
    const outsider = await register("student", "Uninvolved");
    const session = await createSession(teacher);
    await book(student, session.id);

    // The case this was rebuilt for: the teacher never came, so the student has nothing to
    // photograph. Requiring a file locked out exactly the person who most needed to report.
    const noFile = await api("/disputes", { method: "POST", token: student.token, body: {
      reason: "Technical Failure",
      description: "My teacher never joined the class.",
      sessionId: session.id,
    } });
    check("a student can report a class without attaching a file", noFile.status === 201, `status=${noFile.status}`);
    check("the report remembers which class it is about", noFile.body?.sessionId === session.id, `sessionId=${noFile.body?.sessionId}`);

    // A complaint with no file and no class attached still goes through. Requiring one on top
    // of an uploader that has never worked made this a complaints box that refused complaints.
    const orphan = await api("/disputes", { method: "POST", token: student.token, body: {
      reason: "Other", description: "Something general.",
    } });
    check("a report with nothing attached is still accepted", orphan.status === 201, `status=${orphan.status}`);
    check("and is stored with no attachment rather than an empty string",
      orphan.body?.evidenceUrl === null, JSON.stringify(orphan.body?.evidenceUrl));

    const withFile = await api("/disputes", { method: "POST", token: student.token, body: {
      reason: "Payment Issue", description: "Charged twice.", evidenceUrl: "uploads/receipt.png",
    } });
    check("a general report with a file is accepted as before", withFile.status === 201, `status=${withFile.status}`);

    const stolen = await api("/disputes", { method: "POST", token: outsider.token, body: {
      reason: "Technical Failure",
      description: "Complaining about a class I was never in.",
      sessionId: session.id,
    } });
    check("somebody who was never in the class cannot file a report against it",
      stolen.status === 403, `status=${stolen.status}`);

    const fromTeacher = await api("/disputes", { method: "POST", token: teacher.token, body: {
      reason: "Inappropriate Behavior",
      description: "Reporting my own class.",
      sessionId: session.id,
    } });
    check("the class's own teacher can report it too", fromTeacher.status === 201, `status=${fromTeacher.status}`);

    /**
     * The shape the app actually sends when somebody attaches a file.
     *
     * It sent `fileName` and no size for as long as this form has existed, and the endpoint
     * requires `name`, `size` and `contentType` — so every attachment came back 400 before a
     * byte left the phone, and nothing said so. The distinction this pins down is 400 from
     * anything else: a 400 means the app and the server disagree about the request, which is a
     * bug in our code. A 500 here means file storage is not configured on this server, which
     * is true locally and is a separate problem with its own answer.
     */
    const upload = await api("/storage/uploads/request-url", { method: "POST", token: student.token, body: {
      name: "evidence.png", size: 2048, contentType: "image/png",
    } });
    check("the upload request the app sends is understood by the server",
      upload.status !== 400, `status=${upload.status} ${JSON.stringify(upload.body)}`);

    const oldShape = await api("/storage/uploads/request-url", { method: "POST", token: student.token, body: {
      fileName: "evidence.png", contentType: "image/png",
    } });
    check("and the shape it used to send is still refused, so this cannot regress quietly",
      oldShape.status === 400, `status=${oldShape.status}`);

    const mine = await api("/disputes/mine", { token: student.token });
    check("a student can read their own reports back", mine.status === 200 && Array.isArray(mine.body));
    check("the report filed with no file reads back with no file",
      mine.body?.some((d) => d.sessionId === session.id && d.evidenceUrl === null));
  }

  console.log("\nA full room, all moving at once\n");

  {
    /**
     * Nine people joining, talking and dropping at the same time.
     *
     * The owner has asked for changes to be proven at scale rather than spot-checked, and for
     * this the scale *is* the test: the ledger is written from a timer and from every
     * disconnect, so several writes land on the same row at once. Every column is
     * `existing + delta` rather than a set precisely so that they add up instead of
     * overwriting each other, and only concurrency shows whether that is true.
     */
    const host = await register("teacher");
    const session = await createSession(host);
    const pupils = [];
    for (let i = 0; i < 8; i += 1) {
      const pupil = await register("student", `Pupil ${i}`);
      await book(pupil, session.id);
      pupils.push(pupil);
    }

    const t = classroom(host.token, session.id, "Teacher");
    await t.open();

    const VISITS = 3;
    await Promise.all(pupils.map(async (pupil, i) => {
      for (let round = 0; round < VISITS; round += 1) {
        const seat = classroom(pupil.token, session.id, `Pupil ${i}`);
        await seat.open();
        seat.send({ type: "chat", text: `hello ${round}` });
        // Staggered, so the disconnects interleave rather than arriving in a neat batch.
        await wait(120 + i * 10);
        await seat.close();
      }
    }));

    const STROKES = 20;
    for (let k = 0; k < STROKES; k += 1) {
      t.send({ type: "draw_commit", tool: "pen", color: "#000", width: 3, d: `M${k},1 L${k},2` });
    }
    await wait(400);
    await t.close();

    const wrong = [];
    for (const [i, pupil] of pupils.entries()) {
      const row = ledgerRow(session.id, pupil.user.id);
      if (row?.joinCount !== VISITS || row?.messageCount !== VISITS || !(row?.presentMs > 0)) {
        wrong.push(`Pupil ${i}: joins=${row?.joinCount} messages=${row?.messageCount} presentMs=${row?.presentMs}`);
      }
    }
    check(`each of 8 students has all ${VISITS} visits and all ${VISITS} messages counted`,
      wrong.length === 0, wrong.join("; "));

    const hostRow = ledgerRow(session.id, host.user.id);
    check("the teacher's strokes all landed, none lost to the traffic",
      hostRow?.drawCount === STROKES, `drawCount=${hostRow?.drawCount}`);
    check("and the teacher is still recorded as having joined once",
      hostRow?.joinCount === 1, `joinCount=${hostRow?.joinCount}`);

    const read = await api(`/sessions/${session.id}/attendance`, { token: host.token });
    check("all 8 are on the register", (read.body?.enrolled ?? []).length === 8,
      `listed ${(read.body?.enrolled ?? []).length}`);
    check("and all 8 are marked as having attended",
      (read.body?.enrolled ?? []).every((e) => e.attended === true));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => { console.error(err); process.exit(1); });
