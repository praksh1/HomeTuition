/**
 * End-to-end check of notifications, against a running API and a real database.
 *
 * The owner's report was that notifications "are not realtime" — in truth there was no
 * notification system at all: the list came from sample data written into the device's own
 * storage on first run, and nothing on the server ever told a teacher about a new follower.
 *
 * These tests exercise the real path: sign in, open the user channel over a WebSocket, do the
 * thing (send a message, follow a teacher, take a class live) and assert the other person's
 * socket hears about it — with their preferences respected.
 *
 * Usage:  API_URL=http://127.0.0.1:8080 node scripts/notification-tests/run.mjs
 */

import { WebSocket } from "ws";
import { prepareTeacherForClass } from "../test-support/teacherAccess.mjs";

const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const WS = API.replace(/^http/, "ws");

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

function sendMessage(token, toUserId, body) {
  return api(`/messages/${toUserId}`, { method: "POST", token, body: { body } });
}

let seq = 0;
async function register(role, extra = {}) {
  seq += 1;
  const email = `nt_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", {
    method: "POST",
    body: {
      name: `${role === "teacher" ? "Teacher" : "Student"} ${seq}`,
      email,
      password: "password123",
      role,
      ...(role === "teacher" ? { subject: "Maths", bio: "Test" } : { grade: "10", dateOfBirth: "2000-01-01" }),
      ...extra,
    },
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`register ${role} failed: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  if (role === "teacher") prepareTeacherForClass(res.body.user.id);
  return { token: res.body.token, user: res.body.user, email };
}

/** A user channel: the socket the app opens once, signed in, to hear about everything. */
function openChannel(token) {
  const ws = new WebSocket(`${WS}/api/ws?token=${encodeURIComponent(token)}`);
  const events = [];
  const waiters = [];
  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (data?.type !== "notification") return;
    events.push(data);
    for (const w of waiters.splice(0)) w(data);
  });
  return {
    ws,
    events,
    open: () =>
      new Promise((resolve, reject) => {
        if (ws.readyState === 1) return resolve();
        ws.once("open", resolve);
        ws.once("error", reject);
        ws.once("close", () => reject(new Error("channel closed before opening")));
      }),
    /** Waits for the next matching event, or resolves null after `ms`. */
    next: (predicate, ms = 3000) =>
      new Promise((resolve) => {
        const found = events.find(predicate);
        if (found) return resolve(found);
        const timer = setTimeout(() => resolve(null), ms);
        waiters.push((event) => {
          if (!predicate(event)) return;
          clearTimeout(timer);
          resolve(event);
        });
      }),
    close: () => ws.close(),
  };
}

/** A classroom socket — the one a student sits on for the whole lesson. */
function openClassroom(token, sessionId, name) {
  const ws = new WebSocket(
    `${WS}/api/ws?sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}&name=${encodeURIComponent(name)}`,
  );
  return {
    ws,
    open: () =>
      new Promise((resolve, reject) => {
        if (ws.readyState === 1) return resolve();
        ws.once("open", resolve);
        ws.once("error", reject);
        ws.once("close", () => reject(new Error("classroom socket closed before opening")));
      }),
    close: () => ws.close(),
  };
}

/** Resolves once nothing has arrived for `ms` — used to prove silence, not just delay. */
const quiet = (ms) => new Promise((r) => setTimeout(r, ms));

async function testMessageReachesAClosedScreen() {
  console.log("\nA message reaches someone who is not on the Messages screen");
  const teacher = await register("teacher");
  const student = await register("student");

  const channel = openChannel(teacher.token);
  await channel.open();

  const sent = await sendMessage(student.token, teacher.user.id, "Sir, will there be class tomorrow?");
  check("the message is accepted", sent.status === 201, `status ${sent.status}`);

  const event = await channel.next((e) => e.kind === "message");
  check("the teacher's channel is told about it", Boolean(event));
  check("it names the sender", event?.fromUserId === student.user.id, `got ${event?.fromUserId}`);
  check("it carries a preview to show", (event?.preview ?? "").includes("class tomorrow"));
  check("it carries a timestamp", typeof event?.at === "string" && !Number.isNaN(Date.parse(event.at)));

  channel.close();
  return { teacher, student };
}

async function testSenderIsNotNotifiedOfTheirOwnMessage() {
  console.log("\nThe sender is not told about their own message");
  const teacher = await register("teacher");
  const student = await register("student");

  const senderChannel = openChannel(student.token);
  await senderChannel.open();

  await sendMessage(student.token, teacher.user.id, "Hello");

  await quiet(1200);
  check("no notification comes back to the sender", senderChannel.events.length === 0,
    `got ${senderChannel.events.length}`);
  senderChannel.close();
}

async function testFollowingTellsTheTeacher() {
  console.log("\nFollowing a teacher tells the teacher");
  const teacher = await register("teacher");
  const student = await register("student");

  const channel = openChannel(teacher.token);
  await channel.open();

  const teacherProfileId = teacher.user.teacher?.id ?? teacher.user.id;
  const res = await api(`/teachers/${teacherProfileId}/follow`, { method: "POST", token: student.token });
  check("the follow is accepted", res.status === 201 || res.status === 200, `status ${res.status}`);

  const event = await channel.next((e) => e.kind === "follower");
  check("the teacher hears about the new follower", Boolean(event));
  check("it names the student", event?.fromUserId === student.user.id, `got ${event?.fromUserId}`);
}

async function testEveryDeviceHearsIt() {
  console.log("\nEvery device a person is signed in on hears it");
  const teacher = await register("teacher");
  const student = await register("student");

  const phone = openChannel(teacher.token);
  const laptop = openChannel(teacher.token);
  await Promise.all([phone.open(), laptop.open()]);

  await sendMessage(student.token, teacher.user.id, "Two devices");

  const onPhone = await phone.next((e) => e.kind === "message");
  const onLaptop = await laptop.next((e) => e.kind === "message");
  check("the phone is told", Boolean(onPhone));
  check("the laptop is told", Boolean(onLaptop));
  check(
    "both get the same event, so the app can spot the duplicate",
    onPhone && onLaptop && onPhone.at === onLaptop.at && onPhone.fromUserId === onLaptop.fromUserId,
  );

  phone.close();
  laptop.close();
}

async function testPreferencesAreRespected() {
  console.log("\nTurning a notification off actually stops it");
  const teacher = await register("teacher");
  const student = await register("student");

  const defaults = await api("/notification-preferences", { token: teacher.token });
  check("preferences can be read", defaults.status === 200, `status ${defaults.status}`);
  check("messages default to on", defaults.body?.preferences?.push?.messages === true);
  check(
    "the app is told whether email can be sent at all",
    typeof defaults.body?.emailAvailable === "boolean",
  );

  const off = await api("/notification-preferences", {
    method: "PATCH",
    token: teacher.token,
    body: { push: { messages: false } },
  });
  check("the switch saves", off.status === 200 && off.body?.preferences?.push?.messages === false);
  check(
    "turning one switch off leaves the others alone",
    off.body?.preferences?.push?.followers === true && off.body?.preferences?.push?.sessionLive === true,
  );

  const channel = openChannel(teacher.token);
  await channel.open();

  await sendMessage(student.token, teacher.user.id, "You should not hear about this");
  await quiet(1500);
  check("no message notification arrives", channel.events.filter((e) => e.kind === "message").length === 0);

  // The switch that is still on must still work, or "off" would just mean "broken".
  const teacherProfileId = teacher.user.teacher?.id ?? teacher.user.id;
  await api(`/teachers/${teacherProfileId}/follow`, { method: "POST", token: student.token });
  const follow = await channel.next((e) => e.kind === "follower");
  check("a switch left on still delivers", Boolean(follow));

  // And back on again.
  await api("/notification-preferences", {
    method: "PATCH",
    token: teacher.token,
    body: { push: { messages: true } },
  });
  const student2 = await register("student");
  await sendMessage(student2.token, teacher.user.id, "Now you should");
  const back = await channel.next((e) => e.kind === "message" && e.fromUserId === student2.user.id);
  check("turning it back on restores it", Boolean(back));

  channel.close();
}

async function testPreferencesSurviveAnOlderClient() {
  console.log("\nAn older app cannot wipe settings it has never heard of");
  const teacher = await register("teacher");

  await api("/notification-preferences", {
    method: "PATCH",
    token: teacher.token,
    body: { push: { followers: false }, email: { messages: false } },
  });
  // A build that only knows about one switch sends only that one.
  const res = await api("/notification-preferences", {
    method: "PATCH",
    token: teacher.token,
    body: { push: { messages: false } },
  });
  check("the switch it did send is applied", res.body?.preferences?.push?.messages === false);
  check("the ones it omitted survive", res.body?.preferences?.push?.followers === false);
  check("the other channel survives too", res.body?.preferences?.email?.messages === false);

  const junk = await api("/notification-preferences", {
    method: "PATCH",
    token: teacher.token,
    body: { sms: { messages: true }, push: { messages: "yes" } },
  });
  check("junk is dropped rather than stored", junk.status === 200 && !("sms" in (junk.body?.preferences ?? {})));
  check("a non-boolean does not flip a switch", junk.body?.preferences?.push?.messages === false);
}

async function testChannelRequiresAValidIdentity() {
  console.log("\nThe channel cannot be opened without proving who you are");
  const cases = [
    ["no token", `${WS}/api/ws`],
    ["an empty token", `${WS}/api/ws?token=`],
    ["a forged token", `${WS}/api/ws?token=not.a.real.token`],
  ];
  for (const [label, url] of cases) {
    const rejected = await new Promise((resolve) => {
      const ws = new WebSocket(url);
      const done = (value) => {
        try { ws.close(); } catch { /* already gone */ }
        resolve(value);
      };
      ws.once("open", () => done(false));
      ws.once("error", () => done(true));
      ws.once("unexpected-response", () => done(true));
      setTimeout(() => done(true), 2500);
    });
    check(`${label} is refused`, rejected);
  }
}

async function testGoingLiveTellsPaidStudentsOnly() {
  console.log("\nTaking a class live tells the students who paid for it");
  const teacher = await register("teacher");
  const paid = await register("student");
  const stranger = await register("student");

  const created = await api("/sessions", {
    method: "POST",
    token: teacher.token,
    body: {
      topic: "Notification test class",
      subject: "Maths",
      description: "Checking who gets told",
      date: new Date(Date.now() + 60_000).toISOString(),
      duration: 60,
      price: 500,
      maxStudents: 10,
    },
  });
  if (created.status !== 200 && created.status !== 201) {
    check("a class can be created", false, `status ${created.status} ${JSON.stringify(created.body).slice(0, 160)}`);
    return;
  }
  const sessionId = created.body.id;
  check("a class can be created", Boolean(sessionId));

  const booked = await api(`/sessions/${sessionId}/book`, { method: "POST", token: paid.token, body: {} });
  check("a student can book it", booked.status === 200 || booked.status === 201, `status ${booked.status}`);

  const paidChannel = openChannel(paid.token);
  const strangerChannel = openChannel(stranger.token);
  await Promise.all([paidChannel.open(), strangerChannel.open()]);

  const live = await api(`/sessions/${sessionId}`, {
    method: "PATCH",
    token: teacher.token,
    body: { status: "live" },
  });
  check("the teacher can go live", live.status === 200, `status ${live.status} ${JSON.stringify(live.body).slice(0, 160)}`);

  const event = await paidChannel.next((e) => e.kind === "session_live");
  check("the booked student is told the class has started", Boolean(event));
  check("it carries the class so a tap can open it", String(event?.sessionId) === String(sessionId));
  check("it names the class", event?.topic === "Notification test class");

  await quiet(500);
  check(
    "someone who did not book hears nothing",
    strangerChannel.events.filter((e) => e.kind === "session_live").length === 0,
  );

  paidChannel.close();
  strangerChannel.close();
}

async function testManyRecipientsAtOnce() {
  console.log("\nMany people at once, and nobody misses theirs");
  const teacher = await register("teacher");
  const RECIPIENTS = 12;

  const students = [];
  for (let i = 0; i < RECIPIENTS; i += 1) students.push(await register("student"));

  const channel = openChannel(teacher.token);
  await channel.open();

  await Promise.all(
    students.map((s, i) => sendMessage(s.token, teacher.user.id, `Message ${i} from student ${i}`)),
  );

  const deadline = Date.now() + 6000;
  while (channel.events.filter((e) => e.kind === "message").length < RECIPIENTS && Date.now() < deadline) {
    await quiet(150);
  }
  const got = channel.events.filter((e) => e.kind === "message");
  check(`all ${RECIPIENTS} arrive`, got.length === RECIPIENTS, `got ${got.length}`);
  check(
    "each is from a different student, so none were merged or lost",
    new Set(got.map((e) => e.fromUserId)).size === got.length,
  );
  channel.close();
}

async function testASlowOrGoneListenerDoesNotBreakSending() {
  console.log("\nA disconnected listener does not break the thing being announced");
  const teacher = await register("teacher");
  const student = await register("student");

  const channel = openChannel(teacher.token);
  await channel.open();
  channel.ws.terminate(); // Rip the socket away without a clean close.
  await quiet(300);

  const sent = await sendMessage(student.token, teacher.user.id, "Nobody is listening");
  check("the message is still delivered", sent.status === 201, `status ${sent.status}`);

  // And a fresh connection still works afterwards, so the hub did not corrupt its own state.
  const again = openChannel(teacher.token);
  await again.open();
  const student2 = await register("student");
  await sendMessage(student2.token, teacher.user.id, "Back again");
  const event = await again.next((e) => e.kind === "message");
  check("a new connection still receives notifications", Boolean(event));
  again.close();
}

/**
 * A connection that dies without saying so must be noticed and cleaned up.
 *
 * This is the half of "a student sometimes cannot rejoin" that no client-side retrying can
 * fix: the socket is open on paper and carries nothing, so the app never learns it should
 * reconnect and the room keeps a ghost. Only the server's heartbeat can tell.
 */
async function testDeadConnectionsAreNoticed() {
  console.log("\nA connection that dies silently is noticed and cleaned up");
  const teacher = await register("teacher");
  const student = await register("student");

  const channel = openChannel(teacher.token);
  await channel.open();

  // Pause the socket so it answers nothing at all — the closest thing to a phone leaving
  // coverage that can be arranged from here. The connection stays open; it just goes quiet.
  channel.ws.pause();

  const heartbeat = Number(process.env.HEARTBEAT_MS ?? 25000);
  // Two rounds: one to ask, one to notice there was no answer.
  const waitFor = heartbeat * 2 + 3000;
  console.log(`  (waiting ${Math.round(waitFor / 1000)}s for two heartbeat rounds)`);
  await quiet(waitFor);

  channel.ws.resume();
  await quiet(500);
  check(
    "the server closed the dead connection",
    channel.ws.readyState === 2 || channel.ws.readyState === 3,
    `readyState ${channel.ws.readyState}`,
  );

  // And the person can come straight back, which is the point of noticing.
  const again = openChannel(teacher.token);
  await again.open();
  await sendMessage(student.token, teacher.user.id, "Back after the drop");
  const event = await again.next((e) => e.kind === "message");
  check("and they can reconnect and receive again", Boolean(event));
  again.close();
}

/**
 * The same liveness rule, on the socket a student actually sits on during a lesson.
 *
 * This is the reported failure in its own words: a student drops and "takes forever" to get
 * back, and sometimes cannot. A classroom socket that dies without a close frame leaves the
 * app believing it is still in the class — so it never retries — while the room still counts
 * them as present.
 */
async function testAClassroomSocketThatDiesIsNoticed() {
  console.log("\nA student whose connection dies is noticed, and can come back");
  const teacher = await register("teacher");
  const student = await register("student");

  const created = await api("/sessions", {
    method: "POST",
    token: teacher.token,
    body: {
      topic: "Rejoin test class",
      subject: "Maths",
      description: "Checking a dropped student",
      date: new Date(Date.now() + 60_000).toISOString(),
      duration: 60,
      price: 500,
      maxStudents: 10,
    },
  });
  const sessionId = created.body?.id;
  if (!sessionId) {
    check("a class can be created for the rejoin test", false, `status ${created.status}`);
    return;
  }
  await api(`/sessions/${sessionId}/book`, { method: "POST", token: student.token, body: {} });

  const inClass = openClassroom(student.token, sessionId, "Student");
  await inClass.open();
  check("the student is in the class", inClass.ws.readyState === 1);

  // Goes quiet without closing — a phone leaving coverage, not a user pressing Leave.
  inClass.ws.pause();
  const heartbeat = Number(process.env.HEARTBEAT_MS ?? 25000);
  const waitFor = heartbeat * 2 + 3000;
  console.log(`  (waiting ${Math.round(waitFor / 1000)}s for two heartbeat rounds)`);
  await quiet(waitFor);
  inClass.ws.resume();
  await quiet(500);

  check(
    "the server does not keep a student who is no longer there",
    inClass.ws.readyState === 2 || inClass.ws.readyState === 3,
    `readyState ${inClass.ws.readyState}`,
  );

  const back = openClassroom(student.token, sessionId, "Student");
  await back.open();
  check("and they can get straight back into the class", back.ws.readyState === 1);
  back.close();
}

async function main() {
  const health = await fetch(`${API}/api/healthz`).catch(() => null);
  if (!health || !health.ok) {
    console.error(`No API at ${API}. Start it first, or set API_URL.`);
    process.exit(1);
  }

  await testMessageReachesAClosedScreen();
  await testSenderIsNotNotifiedOfTheirOwnMessage();
  await testFollowingTellsTheTeacher();
  await testEveryDeviceHearsIt();
  await testPreferencesAreRespected();
  await testPreferencesSurviveAnOlderClient();
  await testChannelRequiresAValidIdentity();
  await testGoingLiveTellsPaidStudentsOnly();
  await testManyRecipientsAtOnce();
  await testASlowOrGoneListenerDoesNotBreakSending();
  if (process.env.SKIP_SLOW !== "1") {
    await testDeadConnectionsAreNoticed();
    await testAClassroomSocketThatDiesIsNoticed();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
