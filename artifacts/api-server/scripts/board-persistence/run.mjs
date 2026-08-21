/**
 * Does a whiteboard survive the server restarting?
 *
 * It did not, and that mattered more than it sounds: the board lived only in the classroom
 * hub's memory, and the API redeploys itself on every push — so shipping any change during a
 * lesson took the whiteboard with it, silently, with nothing for the teacher to recover.
 *
 * This restarts the real server between writing and reading, because that is the only way to
 * tell persistence from a variable that happens to still be in scope.
 *
 * Usage:
 *   API_URL=http://127.0.0.1:8080 RESTART_CMD=... node scripts/board-persistence/run.mjs
 * RESTART_CMD is a shell command that restarts the API and returns once it is healthy.
 */
import { WebSocket } from "ws";
import { execSync } from "node:child_process";

const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const WS = API.replace(/^http/, "ws");
const RESTART_CMD = process.env.RESTART_CMD;

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

let seq = 0;
async function register(role) {
  seq += 1;
  const res = await api("/auth/register", { method: "POST", body: {
    name: `${role} ${seq}`, email: `bp_${Date.now()}_${seq}@example.com`, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status}`);
  return res.body;
}

function socket(token, sessionId, name) {
  const ws = new WebSocket(`${WS}/api/ws?sessionId=${sessionId}&token=${encodeURIComponent(token)}&name=${name}`);
  const seen = [];
  ws.on("message", (m) => { try { seen.push(JSON.parse(String(m))); } catch { /* not ours */ } });
  ws.on("error", () => {});
  return {
    ws, seen,
    open: () => new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); }),
    /** Waits for a message of this type, or null. */
    wait: (type, ms = 4000) => new Promise((resolve) => {
      const found = seen.find((m) => m.type === type);
      if (found) return resolve(found);
      const timer = setTimeout(() => resolve(null), ms);
      ws.on("message", (raw) => {
        try {
          const m = JSON.parse(String(raw));
          if (m.type === type) { clearTimeout(timer); resolve(m); }
        } catch { /* not ours */ }
      });
    }),
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function restartServer() {
  if (!RESTART_CMD) {
    console.error("RESTART_CMD is not set — this suite cannot prove anything without it.");
    process.exit(1);
  }
  execSync(RESTART_CMD, { stdio: "ignore" });
  for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(`${API}/api/healthz`)).ok) return; } catch { /* not up yet */ }
    await wait(500);
  }
  throw new Error("the API did not come back after the restart");
}

async function main() {
  if (!(await fetch(`${API}/api/healthz`).catch(() => null))?.ok) {
    console.error(`No API at ${API}. Start it first, or set API_URL.`);
    process.exit(1);
  }

  const teacher = await register("teacher");
  const student = await register("student");
  const created = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: "Persisted board", subject: "Maths", description: "d",
    date: new Date(Date.now() + 60_000).toISOString(), duration: 60, price: 500, maxStudents: 10 } });
  const sessionId = created.body.id;
  await api(`/sessions/${sessionId}/book`, { method: "POST", token: student.token, body: {} });
  await api(`/sessions/${sessionId}`, { method: "PATCH", token: teacher.token, body: { status: "live" } });

  console.log("\nA lesson's board survives the server restarting");
  {
    const t = socket(teacher.token, sessionId, "T");
    await t.open();
    await wait(400);

    // A drawing and a picture, because an element without its picture is an empty frame and
    // that is the failure worth catching.
    t.ws.send(JSON.stringify({
      type: "scene_update",
      elements: [
        { id: "el-1", type: "freedraw", version: 3, x: 10, y: 10, width: 100, height: 50 },
        { id: "el-2", type: "image", fileId: "pic-1", version: 2, x: 200, y: 40, width: 300, height: 200 },
      ],
      files: [{ id: "pic-1", mimeType: "image/jpeg", dataURL: `data:image/jpeg;base64,${"A".repeat(2000)}`, created: Date.now() }],
    }));
    t.ws.send(JSON.stringify({ type: "board_view", minX: 0, minY: 0, maxX: 800, maxY: 600 }));
    // Longer than the save debounce, so the write has actually happened.
    await wait(3500);
    t.ws.close();

    await restartServer();

    // A student joining after the restart is the real test: nothing is in memory any more.
    const s = socket(student.token, sessionId, "S");
    await s.open();
    const scene = await s.wait("scene_state", 6000);

    check("the board comes back at all", Boolean(scene), "no scene_state after the restart");
    const elements = scene?.elements ?? [];
    check("the drawing is still there", elements.some((e) => e.id === "el-1"), `${elements.length} elements`);
    check("the picture element is still there", elements.some((e) => e.id === "el-2"), `${elements.length} elements`);
    check(
      "and its picture came with it, so it is not an empty frame",
      (scene?.files ?? []).some((f) => f.id === "pic-1"),
      `${(scene?.files ?? []).length} files`,
    );

    const view = await s.wait("board_view", 3000);
    check("the teacher's view came back too", Boolean(view), "no board_view after the restart");
    s.ws.close();
  }

  console.log("\nClearing the board clears it for good");
  {
    const t = socket(teacher.token, sessionId, "T");
    await t.open();
    await wait(400);
    t.ws.send(JSON.stringify({ type: "board_clear" }));
    await wait(1500);
    t.ws.close();

    await restartServer();

    const s = socket(student.token, sessionId, "S");
    await s.open();
    const scene = await s.wait("scene_state", 3000);
    check(
      "a cleared board does not come back after a restart",
      !scene || (scene.elements ?? []).length === 0,
      `got ${JSON.stringify(scene ?? {}).slice(0, 140)}`,
    );
    s.ws.close();
  }

  console.log("\nStarting a class does not resurrect the last one");
  {
    // Draw something, then take the class live again — which is meant to give a blank board.
    const t = socket(teacher.token, sessionId, "T");
    await t.open();
    await wait(400);
    t.ws.send(JSON.stringify({
      type: "scene_update",
      elements: [{ id: "old-1", type: "freedraw", version: 1, x: 0, y: 0, width: 10, height: 10 }],
    }));
    await wait(3500);
    t.ws.close();

    await api(`/sessions/${sessionId}`, { method: "PATCH", token: teacher.token, body: { status: "completed" } });
    await api(`/sessions/${sessionId}`, { method: "PATCH", token: teacher.token, body: { status: "live" } });
    await wait(800);
    await restartServer();

    const s = socket(student.token, sessionId, "S");
    await s.open();
    const scene = await s.wait("scene_state", 3000);
    check(
      "the previous lesson does not come back when a class is started",
      !scene || !(scene.elements ?? []).some((e) => e.id === "old-1"),
      `got ${JSON.stringify(scene ?? {}).slice(0, 140)}`,
    );
    s.ws.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
