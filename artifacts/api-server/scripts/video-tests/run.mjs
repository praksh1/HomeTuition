/**
 * Swapping the video provider, against the real server.
 *
 * Daily.co is very unlikely to survive the monthly tier — forty-five people in a daily
 * ninety-minute call is around a hundred thousand participant-minutes a month per teacher,
 * against a NPR 6,500 subscription — so replacing it is decided future work and the seam went
 * in before anything was built on top of it.
 *
 * This proves the seam rather than asserting it: the same server is started twice, once on
 * Daily and once on a provider that has never heard of Daily, and every rule around the room —
 * who may have one, when the door opens, who gets moderator rights — has to behave identically.
 *
 * Usage: node scripts/video-tests/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTeacherForClass } from "../test-support/teacherAccess.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(serverRoot, "..", "..");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";

let passed = 0, failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const sql = (s) => execFileSync("psql", [PGURL, "-tAc", s], { encoding: "utf8" }).trim();

function startServer(port, provider, extraEnv = {}) {
  const proc = spawn(process.execPath, [path.join(serverRoot, "dist", "index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: PGURL,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "video-test-secret",
      VIDEO_PROVIDER: provider,
      ...extraEnv,
    },
    stdio: "ignore",
  });
  return proc;
}

/**
 * The claims inside a LiveKit token, read without a network call.
 *
 * A JWT is three base64url segments; the middle one is the grant. Decoding it here is how this
 * suite checks what the *server* actually authorised, rather than trusting a UI that could be
 * hiding a button while the token underneath allows everything.
 */
function jwtClaims(token) {
  const [, payload] = String(token).split(".");
  if (!payload) return null;
  const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

async function waitFor(port) {
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/healthz`)).ok) return true; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/**
 * @param port      the server under test
 * @param onDevice  what these calls claim to be. "web" by default, because every block in this
 *                  suite is standing in for a browser; pass `null` per call to send nothing and
 *                  exercise what an app build older than that header gets.
 */
function makeApi(port, onDevice = "web") {
  return async function api(p, { method = "GET", token, body, platform } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    /*
      What the client says it is.

      Only the room route reads it, and only to pick a provider the caller's build can run —
      a phone cannot open a LiveKit room, because neither phone build contains LiveKit. It
      grants nothing: the worst a lie wins is the provider that could have been asked for
      honestly.
    */
    const claimed = platform === undefined ? onDevice : platform;
    if (claimed) headers["X-Sikshya-Platform"] = claimed;
    const res = await fetch(`http://127.0.0.1:${port}/api${p}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    return { status: res.status, body: parsed };
  };
}

let seq = 0;
async function register(api, role, name) {
  seq += 1;
  const email = `vid_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: name ?? `${role} ${seq}`, email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  if (role === "teacher") prepareTeacherForClass(res.body.user.id);
  return { ...res.body, email };
}

async function run() {
  const PORT = Number(process.env.VIDEO_TEST_PORT ?? 8097);
  const server = startServer(PORT, "echo");
  process.on("exit", () => { try { server.kill("SIGKILL"); } catch { /* gone */ } });

  if (!(await waitFor(PORT))) throw new Error("the server never came up");
  const api = makeApi(PORT);

  console.log("\nA class runs on a provider that has never heard of Daily\n");

  const teacher = await register(api, "teacher", "Ram Prasad");
  const student = await register(api, "student", "Sita Sharma");
  const outsider = await register(api, "student", "Nobody Special");

  const created = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: "Provider swap", subject: "Maths", description: "d",
    date: new Date(Date.now() + 60_000).toISOString(),
    duration: 60, price: 500, maxStudents: 10 } });
  check("a class can be created", created.status <= 201, `status=${created.status}`);
  const sessionId = created.body.id;

  await api(`/sessions/${sessionId}/book`, { method: "POST", token: student.token, body: { paymentMethod: "esewa" } });
  await api(`/sessions/${sessionId}`, { method: "PATCH", token: teacher.token, body: { status: "live" } });

  const forTeacher = await api(`/sessions/${sessionId}/room`, { token: teacher.token });
  check("the teacher gets a room", forTeacher.status === 200, `status=${forTeacher.status} ${JSON.stringify(forTeacher.body)}`);
  check("named for the provider actually carrying it", forTeacher.body?.provider === "echo",
    JSON.stringify(forTeacher.body?.provider));
  check("with somewhere to join", typeof forTeacher.body?.roomUrl === "string" && forTeacher.body.roomUrl.length > 0,
    JSON.stringify(forTeacher.body?.roomUrl));
  check("and a token", typeof forTeacher.body?.token === "string" && forTeacher.body.token.length > 0);

  /**
   * The rule that matters most: moderator rights come from the server's own membership check,
   * never from the client and never from the provider. A swap must not quietly hand every
   * student the teacher's powers.
   */
  check("the teacher is the owner", forTeacher.body?.isOwner === true);
  check("and their token says so", /owner/.test(String(forTeacher.body?.token)), String(forTeacher.body?.token));

  const forStudent = await api(`/sessions/${sessionId}/room`, { token: student.token });
  check("a paid student gets a room too", forStudent.status === 200, `status=${forStudent.status}`);
  check("but is not the owner", forStudent.body?.isOwner === false);
  check("and their token says guest", /guest/.test(String(forStudent.body?.token)), String(forStudent.body?.token));

  const forOutsider = await api(`/sessions/${sessionId}/room`, { token: outsider.token });
  check("somebody who never booked still gets no room at all", forOutsider.status === 403,
    `status=${forOutsider.status}`);
  const anon = await api(`/sessions/${sessionId}/room`);
  check("nor does somebody signed out", anon.status === 401, `status=${anon.status}`);

  /** The app is told what the provider can do, rather than guessing. */
  check("the provider's abilities come with the room",
    forTeacher.body?.capabilities?.screenShare === false, JSON.stringify(forTeacher.body?.capabilities));

  console.log("\nThe timing rules are untouched by the swap\n");

  {
    const over = await api("/sessions", { method: "POST", token: teacher.token, body: {
      topic: "Long over", subject: "Maths", description: "d",
      date: new Date(Date.now() + 3600_000).toISOString(),
      duration: 60, price: 500, maxStudents: 10 } });
    sql(`update sessions set date = now() - interval '3 days' where id = ${over.body.id}`);
    const room = await api(`/sessions/${over.body.id}/room`, { token: teacher.token });
    check("a class that is long over gets no room, whoever the provider is",
      room.status === 409, `status=${room.status}`);
  }

  try { server.kill("SIGKILL"); } catch { /* gone */ }

  console.log("\nAnd the same server on Daily still says Daily\n");

  {
    const dailyPort = PORT + 1;
    const dailyServer = startServer(dailyPort, "daily");
    process.on("exit", () => { try { dailyServer.kill("SIGKILL"); } catch { /* gone */ } });
    if (!(await waitFor(dailyPort))) throw new Error("the Daily server never came up");
    const dailyApi = makeApi(dailyPort);

    const t2 = await register(dailyApi, "teacher", "Second Teacher");
    const s2 = await dailyApi("/sessions", { method: "POST", token: t2.token, body: {
      topic: "Still Daily", subject: "Maths", description: "d",
      date: new Date(Date.now() + 60_000).toISOString(),
      duration: 60, price: 500, maxStudents: 10 } });
    await dailyApi(`/sessions/${s2.body.id}`, { method: "PATCH", token: t2.token, body: { status: "live" } });
    const room = await dailyApi(`/sessions/${s2.body.id}/room`, { token: t2.token });

    /**
     * Without a Daily API key this cannot mint a room, and that is the honest outcome — a 502,
     * not a pretend room. What matters here is that nothing fell back to `echo` behind our
     * backs: the provider is chosen by configuration, not by what happens to work.
     */
    if (room.status === 200) {
      check("on Daily, the room says daily", room.body?.provider === "daily", JSON.stringify(room.body?.provider));
      check("and Daily can share a screen", room.body?.capabilities?.screenShare === true);
    } else {
      check("with no Daily key it fails honestly rather than silently using another provider",
        room.status === 502, `status=${room.status} ${JSON.stringify(room.body)}`);
    }
    try { dailyServer.kill("SIGKILL"); } catch { /* gone */ }
  }

  console.log("\nAnd the same server on LiveKit mints its own tokens\n");

  {
    /*
      Synthetic credentials. Nothing here reaches LiveKit.

      The whole point of a signed token is that its claims can be read back without asking anybody,
      so this suite mints one with a throwaway key and inspects it. A real key would add network
      dependence and a secret in a test file, and would prove nothing extra.
    */
    const LK_SECRET = "video-test-secret-not-a-real-livekit-key-000000";
    const lkPort = PORT + 2;
    const lkServer = startServer(lkPort, "livekit", {
      LIVEKIT_API_KEY: "APItestkey",
      LIVEKIT_API_SECRET: LK_SECRET,
      LIVEKIT_URL: "wss://example-test.livekit.cloud",
    });
    process.on("exit", () => { try { lkServer.kill("SIGKILL"); } catch { /* gone */ } });
    if (!(await waitFor(lkPort))) throw new Error("the LiveKit server never came up");
    const lkApi = makeApi(lkPort);

    const teacher = await register(lkApi, "teacher", "LiveKit Teacher");
    const made = await lkApi("/sessions", { method: "POST", token: teacher.token, body: {
      topic: "On LiveKit", subject: "Maths", description: "d",
      date: new Date(Date.now() + 60_000).toISOString(),
      duration: 60, price: 500, maxStudents: 10 } });
    await lkApi(`/sessions/${made.body.id}`, { method: "PATCH", token: teacher.token, body: { status: "live" } });

    const room = await lkApi(`/sessions/${made.body.id}/room`, { token: teacher.token });
    check("the room says livekit", room.status === 200 && room.body?.provider === "livekit",
      `status=${room.status} ${JSON.stringify(room.body?.provider)}`);
    check("and hands back the wss address, not a Daily URL",
      String(room.body?.roomUrl).startsWith("wss://"), String(room.body?.roomUrl));

    /*
      The single most important assertion in this file.

      A client holding LIVEKIT_API_SECRET could mint itself a token for any room in the project,
      including a class it never paid for. The secret signs the token and must never travel with it.
    */
    const body = JSON.stringify(room.body ?? {});
    check("the API secret appears nowhere in the response", !body.includes(LK_SECRET));
    check("nor does the API key", !body.includes("APItestkey"));

    const claims = jwtClaims(room.body?.token);
    check("the token is a readable JWT", claims !== null && typeof claims === "object");
    check("it names the class's own room, so provider evidence can still correlate",
      claims?.video?.room === `sikshya${made.body.id}`, JSON.stringify(claims?.video?.room));
    check("the participant is identified by account, not by display name",
      claims?.sub === String(teacher.user.id), `${claims?.sub} vs ${teacher.user.id}`);
    check("the teacher gets moderator rights", claims?.video?.roomAdmin === true);
    check("and may publish a screen", (claims?.video?.canPublishSources ?? []).includes("screen_share"));

    /* A student in the same class must get a strictly weaker token. */
    const student = await register(lkApi, "student", "LiveKit Student");
    const booked = await lkApi(`/sessions/${made.body.id}/book`, { method: "POST", token: student.token });
    check("the student could book the class", booked.status === 200 || booked.status === 201,
      `status=${booked.status} ${JSON.stringify(booked.body)}`);
    const studentRoom = await lkApi(`/sessions/${made.body.id}/room`, { token: student.token });
    const studentClaims = jwtClaims(studentRoom.body?.token);
    check("the student joins the same room", studentClaims?.video?.room === `sikshya${made.body.id}`);
    check("but gets no moderator rights", studentClaims?.video?.roomAdmin !== true,
      JSON.stringify(studentClaims?.video?.roomAdmin));
    check("and may not publish a screen",
      !(studentClaims?.video?.canPublishSources ?? []).includes("screen_share"),
      JSON.stringify(studentClaims?.video?.canPublishSources));
    check("while still being able to publish camera and microphone",
      (studentClaims?.video?.canPublishSources ?? []).includes("camera") &&
      (studentClaims?.video?.canPublishSources ?? []).includes("microphone"),
      JSON.stringify(studentClaims?.video?.canPublishSources));
    check("the two people are told apart by identity",
      studentClaims?.sub === String(student.user.id) && studentClaims?.sub !== claims?.sub);


    /*
      A phone must keep Daily even while the trial is on.

      This is what makes the trial usable at all. There is one deployment: if setting
      `VIDEO_PROVIDER=livekit` served LiveKit rooms to phones, trying it in a browser would take
      video away from every phone on the platform, because neither phone build contains LiveKit
      and cannot — both SDKs ship a fork of the same native WebRTC library.
    */
    for (const phone of ["ios", "android"]) {
      const phoneRoom = await lkApi(`/sessions/${made.body.id}/room`, { token: teacher.token, platform: phone });
      check(`a ${phone} client is given Daily, not LiveKit`, phoneRoom.body?.provider === "daily",
        `got ${JSON.stringify(phoneRoom.body?.provider)}`);
      check(`and no LiveKit token is minted for it`,
        !String(phoneRoom.body?.roomUrl ?? "").startsWith("wss://"),
        String(phoneRoom.body?.roomUrl));
    }
    const webRoom = await lkApi(`/sessions/${made.body.id}/room`, { token: teacher.token, platform: "web" });
    check("while a browser still gets the trial", webRoom.body?.provider === "livekit");

    /*
      An app build from before the header existed says nothing, and is more often a phone than
      not. Silence therefore has to mean Daily rather than a guess at "web" — an old Android
      build handed a `wss://` address shows a black rectangle and no explanation.
    */
    const silentRoom = await lkApi(`/sessions/${made.body.id}/room`, { token: teacher.token, platform: null });
    check("a client that says nothing is given the provider that runs everywhere",
      silentRoom.body?.provider === "daily", `got ${JSON.stringify(silentRoom.body?.provider)}`);

    /*
      And the claim wins nothing beyond compatibility. A student calling themselves a browser
      gets a student's token on whichever provider answers — never a teacher's.
    */
    const liar = await lkApi(`/sessions/${made.body.id}/room`, { token: student.token, platform: "web" });
    const liarClaims = jwtClaims(liar.body?.token);
    check("claiming a platform does not grant moderator rights",
      liarClaims?.video?.roomAdmin !== true, JSON.stringify(liarClaims?.video?.roomAdmin));
    check("nor screen sharing",
      !(liarClaims?.video?.canPublishSources ?? []).includes("screen_share"));

    try { lkServer.kill("SIGKILL"); } catch { /* gone */ }
  }

  console.log("\nLiveKit with no credentials fails honestly\n");

  {
    // Half-configured is the dangerous state: it looks like a network fault to everybody.
    const barePort = PORT + 3;
    const bareServer = startServer(barePort, "livekit", {
      LIVEKIT_API_KEY: "", LIVEKIT_API_SECRET: "", LIVEKIT_URL: "",
    });
    process.on("exit", () => { try { bareServer.kill("SIGKILL"); } catch { /* gone */ } });
    if (!(await waitFor(barePort))) throw new Error("the bare LiveKit server never came up");
    const bareApi = makeApi(barePort);

    const teacher = await register(bareApi, "teacher", "Unconfigured Teacher");
    const made = await bareApi("/sessions", { method: "POST", token: teacher.token, body: {
      topic: "No credentials", subject: "Maths", description: "d",
      date: new Date(Date.now() + 60_000).toISOString(),
      duration: 60, price: 500, maxStudents: 10 } });
    await bareApi(`/sessions/${made.body.id}`, { method: "PATCH", token: teacher.token, body: { status: "live" } });
    const room = await bareApi(`/sessions/${made.body.id}/room`, { token: teacher.token });

    check("it does not quietly fall back to another provider",
      room.status !== 200 || room.body?.provider === "livekit",
      `status=${room.status} provider=${JSON.stringify(room.body?.provider)}`);
    check("and it mints no token it cannot sign",
      room.status !== 200 || room.body?.token === null || room.body?.token === undefined,
      JSON.stringify(room.body?.token));
    check("no configuration variable name is leaked to the caller",
      !/LIVEKIT_API_SECRET|LIVEKIT_API_KEY/.test(JSON.stringify(room.body ?? {})));

    try { bareServer.kill("SIGKILL"); } catch { /* gone */ }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => { console.error(err); process.exit(1); });
