/**
 * What the board actually does with a big picture, measured against the running server.
 *
 * A teacher reported sharing a photo from an iPhone and the class seeing an empty picture
 * frame. These are the numbers behind that, taken rather than assumed:
 *
 *   under ~1.8 MB   the picture reaches the class
 *   about 2 MB      the element arrives, the picture is dropped, and the class sees an
 *                   empty frame — the reported symptom exactly
 *   about 3 MB      the frame exceeds the socket limit and the teacher's board connection
 *                   is closed (1009), mid-lesson, with nothing said
 *
 * The app is expected to keep everything it sends under the first threshold, so none of this
 * is ever reached in practice. This suite exists to pin the thresholds down: if someone
 * raises or lowers a limit on either side, the two must move together or a teacher goes back
 * to sharing pictures nobody receives.
 *
 * Usage: API_URL=http://127.0.0.1:8080 node scripts/board-limits/run.mjs
 */
import { WebSocket } from "ws";

const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const WS = API.replace(/^http/, "ws");

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
    name: `${role} ${seq}`, email: `bl_${Date.now()}_${seq}@example.com`, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status}`);
  return res.body;
}

function socket(token, sessionId, name) {
  const ws = new WebSocket(`${WS}/api/ws?sessionId=${sessionId}&token=${encodeURIComponent(token)}&name=${name}`);
  const seen = [];
  const closes = [];
  ws.on("message", (m) => { try { seen.push(JSON.parse(String(m))); } catch { /* not ours */ } });
  ws.on("close", (code) => closes.push(code));
  ws.on("error", () => {});
  return { ws, seen, closes, open: () => new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); }) };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A picture of roughly this many megabytes, as base64 in a scene message. */
function photoFrame(mb, id) {
  const bytes = Math.round(mb * 1024 * 1024);
  return {
    type: "scene_update",
    elements: [{ id: `el_${id}`, type: "image", fileId: id, version: 1, x: 0, y: 0, width: 400, height: 300 }],
    files: [{ id, mimeType: "image/jpeg", dataURL: `data:image/jpeg;base64,${"A".repeat(Math.floor((bytes * 4) / 3))}`, created: Date.now() }],
  };
}

async function main() {
  const health = await fetch(`${API}/api/healthz`).catch(() => null);
  if (!health?.ok) { console.error(`No API at ${API}. Start it first, or set API_URL.`); process.exit(1); }

  const teacher = await register("teacher");
  const student = await register("student");
  const created = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: "Board limits", subject: "Maths", description: "d",
    date: new Date(Date.now() + 60_000).toISOString(), duration: 60, price: 500, maxStudents: 10 } });
  const sessionId = created.body.id;
  await api(`/sessions/${sessionId}/book`, { method: "POST", token: student.token, body: {} });
  await api(`/sessions/${sessionId}`, { method: "PATCH", token: teacher.token, body: { status: "live" } });

  console.log("\nA picture the class can receive");
  {
    const t = socket(teacher.token, sessionId, "T");
    const s = socket(student.token, sessionId, "S");
    await Promise.all([t.open(), s.open()]);
    await wait(400);
    t.ws.send(JSON.stringify(photoFrame(1, "small")));
    await wait(1200);
    const updates = s.seen.filter((m) => m.type === "scene_update");
    check("the element arrives", updates.length > 0);
    check("the picture arrives with it", updates.some((m) => (m.files ?? []).some((f) => f.id === "small")));
    check("the teacher stays connected", t.ws.readyState === 1);
    t.ws.close(); s.ws.close();
  }

  console.log("\nA picture too big for the class, refused rather than half-delivered");
  {
    const t = socket(teacher.token, sessionId, "T");
    const s = socket(student.token, sessionId, "S");
    await Promise.all([t.open(), s.open()]);
    await wait(400);
    t.ws.send(JSON.stringify(photoFrame(2, "big")));
    await wait(1200);
    const updates = s.seen.filter((m) => m.type === "scene_update");
    check("the picture is not relayed", !updates.some((m) => (m.files ?? []).some((f) => f.id === "big")));
    /**
     * The check this suite was missing, and the bug it let through.
     *
     * "Refused rather than half-delivered" was the title of this scenario from the start, and
     * only the picture half was ever asserted. Elements and files were filtered independently,
     * so the frame travelled on without its picture and every student rendered a grey
     * placeholder where the page should be — permanently, while the teacher's own board looked
     * right because it draws from local memory. Reported from a real class: "the pdf disappears
     * and the image icon appears".
     */
    check(
      "and the empty frame does not reach the class either",
      !updates.some((m) => (m.elements ?? []).some((e) => e.fileId === "big")),
      JSON.stringify(updates.flatMap((m) => (m.elements ?? []).map((e) => e.id))),
    );
    // The half that makes this survivable: the teacher is told, so they do not spend the
    // lesson explaining a picture nobody can see.
    check("the teacher is told it was refused", t.seen.some((m) => m.type === "material_rejected"));
    check("the teacher stays connected", t.ws.readyState === 1);
    t.ws.close(); s.ws.close();
  }

  console.log("\nMore pictures than a board will hold, refused the same way");
  {
    const t = socket(teacher.token, sessionId, "T");
    const s = socket(student.token, sessionId, "S");
    await Promise.all([t.open(), s.open()]);
    await wait(400);
    // A long PDF is placed as one picture per page, so this is reached by ordinary use rather
    // than by abuse: two 25-page documents in one lesson is past the limit.
    for (let i = 0; i < 46; i += 1) {
      t.ws.send(JSON.stringify(photoFrame(0.05, `p${i}`)));
      await wait(45);
    }
    await wait(1500);
    const updates = s.seen.filter((m) => m.type === "scene_update");
    const gotFiles = new Set(updates.flatMap((m) => (m.files ?? []).map((f) => f.id)));
    const gotFrames = updates.flatMap((m) => (m.elements ?? []).filter((e) => e.fileId));
    check("the class receives pictures up to the limit", gotFiles.size > 0);
    check(
      "every frame the class receives has its picture",
      gotFrames.every((e) => gotFiles.has(e.fileId)),
      `frames without pictures: ${JSON.stringify(gotFrames.filter((e) => !gotFiles.has(e.fileId)).map((e) => e.id))}`,
    );
    check("the teacher is told the rest were refused", t.seen.some((m) => m.type === "material_rejected"));
    check("the teacher stays connected", t.ws.readyState === 1);
    t.ws.close(); s.ws.close();
  }

  console.log("\nA picture past the socket limit takes the connection with it");
  {
    const t = socket(teacher.token, sessionId, "T");
    await t.open();
    await wait(300);
    t.ws.send(JSON.stringify(photoFrame(3, "huge")));
    await wait(1500);
    // Documented, not desired: this is why the app must not send anything this large. If a
    // future change makes the server tolerate it, this test should be updated deliberately.
    check("the connection is closed, as the protocol requires", t.ws.readyState !== 1 && t.closes.includes(1009),
      `state ${t.ws.readyState}, closes ${JSON.stringify(t.closes)}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
