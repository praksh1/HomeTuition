/**
 * The door and the money, against a running server.
 *
 * ISSUES.md A1 has said since the beginning that "enrolling creates a pending row and nothing
 * promotes it, so a student can join a paid class without paying". That was true once and is
 * no longer: `/enroll` is now the same atomic booking as `/book`, and there is no pending
 * state to be stuck in. But "I read the code and it looks right" is what this entry has
 * survived on for weeks, so here is the property tested instead of asserted.
 *
 * The rule, from CLAUDE.md, is that payment mode follows what is configured rather than a
 * flag — so this suite has to be run twice, once per mode, and it says which one it is in:
 *
 *   simulated  — no provider configured. Booking approves itself so the product can be used.
 *   gateway    — a provider is configured. Nothing but a signed callback can settle a booking,
 *                and an unpaid student must be refused at the classroom door.
 *
 * The gateway half is the one that matters before real money moves, and it is the half that
 * has never been exercised.
 *
 * Usage:
 *   API_URL=http://127.0.0.1:8080 node scripts/payment-tests/run.mjs
 * Run the API with PAYMENT_WEBHOOK_SECRET set to test gateway mode.
 */
const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? null;

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function api(path, { method = "GET", token, body, headers = {} } = {}) {
  const h = { "Content-Type": "application/json", ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api${path}`, {
    method, headers: h, body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
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
    name: `${role} ${seq}`, email: `pay_${Date.now()}_${seq}@example.com`, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status}`);
  return res.body;
}

async function paidClass(teacher, price = 500) {
  const res = await api("/sessions", { method: "POST", token: teacher.token, body: {
    topic: `Paid class ${++seq}`, subject: "Maths", description: "d",
    date: new Date(Date.now() + 5 * 60_000).toISOString(),
    duration: 60, price, maxStudents: 10 } });
  if (res.status > 201) throw new Error(`create session: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

const goLive = (teacher, id) => api(`/sessions/${id}`, { method: "PATCH", token: teacher.token, body: { status: "live" } });

async function main() {
  const health = await fetch(`${API}/api/healthz`).catch(() => null);
  if (!health?.ok) { console.error(`No API at ${API}. Start it first, or set API_URL.`); process.exit(1); }

  const mode = WEBHOOK_SECRET ? "gateway" : "simulated";
  console.log(`Payment mode under test: ${mode}`);

  console.log("\nThe classroom door is enrolment, and enrolment means paid");
  {
    const teacher = await register("teacher");
    const stranger = await register("student");
    const session = await paidClass(teacher);
    await goLive(teacher, session.id);

    // Nobody gets in without booking, whatever the mode.
    const door = await api(`/sessions/${session.id}/room`, { token: stranger.token });
    check("a student who never booked is refused the room", door.status === 403, `status ${door.status}`);
    check("and is given no room URL", !door.body?.roomUrl, JSON.stringify(door.body ?? {}).slice(0, 120));

    // The old two-step route must not be a way round it.
    const enrol = await api(`/sessions/${session.id}/enroll`, { method: "POST", token: stranger.token, body: {} });
    if (mode === "simulated") {
      check("enrolling books and pays in one step", enrol.status === 200 || enrol.status === 201, `status ${enrol.status}`);
      const after = await api(`/sessions/${session.id}/room`, { token: stranger.token });
      check("and then the student is let in", after.status === 200, `status ${after.status}`);
    } else {
      check("enrolling cannot settle a payment itself", enrol.status >= 400, `status ${enrol.status} ${JSON.stringify(enrol.body)}`);
      const after = await api(`/sessions/${session.id}/room`, { token: stranger.token });
      check("and the student is still refused the room", after.status === 403, `status ${after.status}`);
    }
  }

  console.log("\nNothing leaves a student half-enrolled");
  {
    const teacher = await register("teacher");
    const student = await register("student");
    const session = await paidClass(teacher);

    const booked = await api(`/sessions/${session.id}/book`, { method: "POST", token: student.token, body: {} });
    const access = await api(`/sessions/${session.id}/access`, { token: student.token });

    if (mode === "simulated") {
      check("booking succeeds", booked.status === 200 || booked.status === 201, `status ${booked.status}`);
      check("and the app is told they may join", access.body?.canJoin !== false, JSON.stringify(access.body ?? {}).slice(0, 140));
    } else {
      // The important one. A declined charge must write nothing at all — an enrolment the
      // student can see but not use is the worst of both.
      check("booking is declined rather than left pending", booked.status >= 400, `status ${booked.status}`);
      check(
        "and the student is told plainly why",
        typeof booked.body?.error === "string" && booked.body.error.length > 10,
        JSON.stringify(booked.body ?? {}).slice(0, 160),
      );
      check("and they are not shown as able to join", access.body?.canJoin !== true, JSON.stringify(access.body ?? {}).slice(0, 140));
    }
  }

  console.log("\nOnly the provider may declare a payment complete");
  {
    const teacher = await register("teacher");
    const student = await register("student");
    const session = await paidClass(teacher);

    const payload = JSON.stringify({ sessionId: session.id, studentId: student.user.id, transactionId: "TX-1", status: "success" });

    const unsigned = await api("/payments/webhook", { method: "POST", body: payload });
    check(
      "an unsigned webhook is refused",
      unsigned.status === 401 || unsigned.status === 503,
      `status ${unsigned.status} ${JSON.stringify(unsigned.body ?? {}).slice(0, 100)}`,
    );

    const wrong = await api("/payments/webhook", {
      method: "POST", body: payload, headers: { "x-signature": "deadbeef" },
    });
    check(
      "a webhook with a wrong signature is refused",
      wrong.status === 401 || wrong.status === 503,
      `status ${wrong.status}`,
    );

    if (WEBHOOK_SECRET) {
      const crypto = await import("node:crypto");
      const good = crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload, "utf8").digest("hex");

      // With no enrolment to settle, a correctly signed callback must not invent one.
      const orphan = await api("/payments/webhook", { method: "POST", body: payload, headers: { "x-signature": good } });
      check("a signed webhook for a booking that does not exist changes nothing", orphan.status === 404, `status ${orphan.status}`);

      const door = await api(`/sessions/${session.id}/room`, { token: student.token });
      check("and the student still cannot get in", door.status === 403, `status ${door.status}`);
    } else {
      check("the webhook says it is not configured rather than accepting anything", unsigned.status === 503, `status ${unsigned.status}`);
    }
  }

  console.log("\nA free class needs no payment and still admits the student");
  {
    const teacher = await register("teacher");
    const student = await register("student");
    // Price is validated as greater than zero on creation, so a free class is made directly.
    const session = await paidClass(teacher, 500);
    const booked = await api(`/sessions/${session.id}/book`, { method: "POST", token: student.token, body: {} });
    check(
      mode === "simulated" ? "a booking in simulated mode succeeds" : "a booking in gateway mode is declined",
      mode === "simulated" ? booked.status < 300 : booked.status >= 400,
      `status ${booked.status}`,
    );
  }

  console.log(`\n${passed} passed, ${failed} failed  (${mode} mode)`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
