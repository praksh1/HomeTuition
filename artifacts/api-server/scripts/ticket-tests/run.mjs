/**
 * A reported problem, from filing it to reading the answer.
 *
 * The owner's complaint was specific: "a user can create several hundred requests without
 * knowing the status of their requests/issues." Both halves are tested here, and the second
 * is the harder one — a status that changes is easy, a status somebody can *follow* means the
 * history behind it has to be true, visible to the person who reported it, and impossible to
 * rewrite after a decision has been made.
 *
 * Everything runs against a real server and a real database. The limit in particular cannot be
 * checked any other way: the point of it is that a refused request writes nothing, and only the
 * database can say whether anything was written.
 *
 * Usage: API_URL=http://127.0.0.1:8080 node scripts/ticket-tests/run.mjs
 * PGURL is used to make an agent, which nothing in the app can do — deliberately — and to
 * backdate a request, which is the only way to watch a 24-hour window roll over in a test.
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
  const email = `tk_${Date.now()}_${seq}@example.com`;
  const res = await api("/auth/register", { method: "POST", body: {
    name: name ?? `${role} ${seq}`,
    email, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }),
  } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body, email };
}

/** An agent, made the only way there is: directly, by the owner. */
async function makeAgent(name = "Support Agent") {
  const account = await register("student", name);
  sql(`update users set role = 'admin' where id = ${account.user.id}`);
  const signedIn = await api("/auth/login", { method: "POST", body: { email: account.email, password: "password123" } });
  return { ...account, token: signedIn.body?.token ?? account.token, id: account.user.id };
}

const file = (token, n = 1) => api("/disputes", { method: "POST", token, body: {
  reason: "Other", description: `Something went wrong (${n})`,
} });

async function run() {
  console.log("\nFiling a request\n");

  const student = await register("student", "Sita Sharma");
  const first = await file(student.token, 1);

  check("a request comes back with a number", /^HT-\d{6}$/.test(first.body?.ref ?? ""), `ref=${first.body?.ref}`);
  check("and the number matches the request", first.body?.ref === `HT-${String(first.body.id).padStart(6, "0")}`);

  const mine = await api("/disputes/mine", { token: student.token });
  check("it appears in their own list", mine.body?.tickets?.length === 1, `n=${mine.body?.tickets?.length}`);
  check("with a status in words, not a database value",
    mine.body?.tickets?.[0]?.statusLabel === "Request Created",
    `label=${mine.body?.tickets?.[0]?.statusLabel}`);
  check("and the list says how many more they may file",
    mine.body?.allowance?.remaining === 2 && mine.body?.allowance?.used === 1,
    JSON.stringify(mine.body?.allowance));

  const one = await api(`/disputes/${first.body.id}`, { token: student.token });
  check("its history starts where the request does",
    one.body?.history?.length === 1 && one.body.history[0].status === "open",
    JSON.stringify(one.body?.history));
  check("and names the person who filed it",
    one.body?.history?.[0]?.by === "Sita Sharma", `by=${one.body?.history?.[0]?.by}`);

  console.log("\nThree a day\n");

  await file(student.token, 2);
  const third = await file(student.token, 3);
  check("the third is still accepted", third.status === 201, `status=${third.status}`);
  check("and is the last one", third.body?.remaining === 0, `remaining=${third.body?.remaining}`);

  const fourth = await file(student.token, 4);
  check("the fourth is refused", fourth.status === 429, `status=${fourth.status}`);
  check("and says when they may file again",
    typeof fourth.body?.nextAllowedAt === "number" && fourth.body.nextAllowedAt > Date.now(),
    `nextAllowedAt=${fourth.body?.nextAllowedAt}`);
  check("and the refusal explains itself in words a person can read",
    typeof fourth.body?.error === "string" && /24|hour|tomorrow|wait/i.test(fourth.body.error),
    `error=${fourth.body?.error}`);

  /**
   * The half of a limit that actually matters.
   *
   * A refusal that still writes the row is not a limit, it is a lie — and it is the exact
   * shape of the bug the owner reported, where hundreds of requests piled up unanswered.
   */
  const stored = Number(sql(`select count(*) from disputes where user_id = ${student.user.id}`));
  check("and nothing was written for it", stored === 3, `rows=${stored}`);

  console.log("\nThe window rolls\n");

  // The oldest of the three moved out of the last 24 hours: one slot comes back, not three.
  const oldest = Number(sql(
    `select id from disputes where user_id = ${student.user.id} order by id asc limit 1`));
  sql(`update disputes set created_at = now() - interval '25 hours' where id = ${oldest}`);

  const afterRoll = await api("/disputes/mine", { token: student.token });
  check("one slot comes back once a request ages out",
    afterRoll.body?.allowance?.remaining === 1 && afterRoll.body?.allowance?.used === 2,
    JSON.stringify(afterRoll.body?.allowance));

  const fifth = await file(student.token, 5);
  check("and that slot can be used", fifth.status === 201, `status=${fifth.status}`);
  const sixth = await file(student.token, 6);
  check("but only the one", sixth.status === 429, `status=${sixth.status}`);

  console.log("\nWithdrawing one\n");

  const cancelled = await api(`/disputes/${fifth.body.id}/cancel`, {
    method: "POST", token: student.token, body: { note: "Sorted it myself." },
  });
  check("a reporter can withdraw their own request", cancelled.status === 200, `status=${cancelled.status}`);
  check("and it says so", cancelled.body?.ticket?.statusLabel === "Cancelled",
    `label=${cancelled.body?.ticket?.statusLabel}`);
  check("the withdrawal is in the history",
    cancelled.body?.history?.some((h) => h.status === "cancelled" && h.note === "Sorted it myself."),
    JSON.stringify(cancelled.body?.history?.map((h) => h.status)));
  check("and it cannot be withdrawn twice",
    (await api(`/disputes/${fifth.body.id}/cancel`, { method: "POST", token: student.token })).status === 409);

  console.log("\nWhat one person may see of another\n");

  const stranger = await register("student", "Hari Thapa");
  const peek = await api(`/disputes/${first.body.id}`, { token: stranger.token });
  check("a stranger cannot read somebody else's request", peek.status === 404, `status=${peek.status}`);
  const grab = await api(`/disputes/${first.body.id}/cancel`, { method: "POST", token: stranger.token });
  check("nor withdraw it", grab.status === 404, `status=${grab.status}`);
  const missing = await api(`/disputes/99999999`, { token: stranger.token });
  check("and a request that is not theirs looks the same as one that does not exist",
    missing.status === peek.status,
    `missing=${missing.status} theirs=${peek.status}`);

  console.log("\nAn agent picks it up\n");

  const agent = await makeAgent("Bina Karki");
  const other = await makeAgent("Deepak Rai");

  const opened = await api(`/admin/tickets/${first.body.id}`, { token: agent.token });
  check("opening a new request records that a human looked",
    opened.body?.ticket?.status === "opened", `status=${opened.body?.ticket?.status}`);

  const reporterSees = await api(`/disputes/${first.body.id}`, { token: student.token });
  check("and the person who reported it can see that",
    reporterSees.body?.history?.some((h) => h.status === "opened"),
    JSON.stringify(reporterSees.body?.history?.map((h) => h.status)));
  /*
   * A human read it, but not which human. The support team here is small enough that a full
   * name is enough to find somebody, and the person reading this may have just been told no
   * about money. The desk below still sees the real name.
   */
  check("but is not told which agent, by name",
    reporterSees.body?.history?.find((h) => h.status === "opened")?.by === "Sikshya Support",
    reporterSees.body?.history?.find((h) => h.status === "opened")?.by);
  const deskSees = await api(`/admin/tickets/${first.body.id}`, { token: agent.token });
  check("while the desk sees exactly who",
    deskSees.body?.history?.some((h) => h.by === "Bina Karki"),
    JSON.stringify(deskSees.body?.history?.map((h) => h.by)));

  const reopened = await api(`/admin/tickets/${first.body.id}`, { token: other.token });
  check("a second agent reading it does not record it twice",
    reopened.body?.history?.filter((h) => h.status === "opened").length === 1,
    JSON.stringify(reopened.body?.history?.map((h) => h.status)));

  const assigned = await api(`/admin/tickets/${first.body.id}/assign`, { method: "POST", token: agent.token });
  check("an agent can take a request on", assigned.status === 200, `status=${assigned.status}`);
  check("and the request says who holds it", assigned.body?.ticket?.assignedTo === agent.id,
    `assignedTo=${assigned.body?.ticket?.assignedTo}`);

  const toStudent = await api(`/admin/tickets/${first.body.id}/assign`, {
    method: "POST", token: agent.token, body: { agentId: student.user.id },
  });
  check("a request cannot be handed to somebody who is not an agent", toStudent.status === 400,
    `status=${toStudent.status}`);

  console.log("\nWorking on it\n");

  const noted = await api(`/admin/tickets/${first.body.id}`, {
    method: "PATCH", token: agent.token, body: { resolution: "Rang the teacher, waiting to hear back." },
  });
  check("a note without a decision is kept as a note", noted.status === 200, `status=${noted.status}`);
  check("and does not pretend the request moved on", noted.body?.ticket?.status === "assigned",
    `status=${noted.body?.ticket?.status}`);
  check("and does not close it", noted.body?.ticket?.resolvedAt === null,
    `resolvedAt=${noted.body?.ticket?.resolvedAt}`);

  const internal = await api(`/admin/tickets/${first.body.id}`, {
    method: "PATCH", token: agent.token,
    body: { resolution: "Reporter has complained twice before.", internal: true },
  });
  check("an agent can write to other agents", internal.status === 200, `status=${internal.status}`);
  check("agents see that note",
    internal.body?.history?.some((h) => h.note === "Reporter has complained twice before."));

  const reporterHistory = await api(`/disputes/${first.body.id}`, { token: student.token });
  check("the reporter does not",
    !reporterHistory.body?.history?.some((h) => h.note === "Reporter has complained twice before."),
    JSON.stringify(reporterHistory.body?.history?.map((h) => h.note)));
  check("but does see the note that was meant for them",
    reporterHistory.body?.history?.some((h) => h.note === "Rang the teacher, waiting to hear back."));

  const processing = await api(`/admin/tickets/${first.body.id}`, {
    method: "PATCH", token: agent.token, body: { status: "processing" },
  });
  check("a request can be moved to being worked on", processing.body?.ticket?.status === "processing",
    `status=${processing.body?.ticket?.status}`);
  check("and the buttons shrink as it advances",
    !processing.body?.nextStatuses?.some((n) => n.value === "assigned"),
    JSON.stringify(processing.body?.nextStatuses?.map((n) => n.value)));

  console.log("\nEnding it\n");

  const silent = await api(`/admin/tickets/${first.body.id}`, {
    method: "PATCH", token: agent.token, body: { status: "resolved" },
  });
  check("a request cannot be closed without saying what was decided", silent.status === 400,
    `status=${silent.status}`);
  const stillOpen = Number(sql(
    `select count(*) from disputes where id = ${first.body.id} and status = 'processing'`));
  check("and the refusal left it where it was", stillOpen === 1);

  const resolved = await api(`/admin/tickets/${first.body.id}`, {
    method: "PATCH", token: agent.token,
    body: { status: "resolved", resolution: "Refunded in full on 12 Bhadra.", fileKey: "u/1/receipt.pdf" },
  });
  check("with a reason it closes", resolved.body?.ticket?.status === "resolved",
    `status=${resolved.body?.ticket?.status}`);

  const answer = await api(`/disputes/${first.body.id}`, { token: student.token });
  check("and the person who reported it can read the reason",
    answer.body?.ticket?.resolution === "Refunded in full on 12 Bhadra.",
    `resolution=${answer.body?.ticket?.resolution}`);
  check("and the document the agent attached to it",
    answer.body?.history?.some((h) => h.fileKey === "u/1/receipt.pdf"),
    JSON.stringify(answer.body?.history?.map((h) => h.fileKey)));
  check("and they can no longer withdraw it", answer.body?.canCancel === false);

  const again = await api(`/admin/tickets/${first.body.id}`, {
    method: "PATCH", token: agent.token, body: { status: "processing", resolution: "Actually, reopening." },
  });
  check("a closed request cannot be reopened", again.status === 409, `status=${again.status}`);
  const lateNote = await api(`/admin/tickets/${first.body.id}`, {
    method: "PATCH", token: agent.token, body: { resolution: "One more thought." },
  });
  check("nor written on afterwards", lateNote.status === 409, `status=${lateNote.status}`);

  console.log("\nTurning one down\n");

  const second = (await api("/disputes/mine", { token: student.token })).body.tickets
    .find((t) => t.status === "open");
  const denied = await api(`/admin/tickets/${second.id}`, {
    method: "PATCH", token: agent.token, body: { status: "denied" },
  });
  check("a request cannot be turned down without a reason", denied.status === 400, `status=${denied.status}`);
  const deniedWith = await api(`/admin/tickets/${second.id}`, {
    method: "PATCH", token: agent.token,
    body: { status: "denied", resolution: "The class ran; attendance shows both of you in the room." },
  });
  check("with one it can", deniedWith.body?.ticket?.status === "denied",
    `status=${deniedWith.body?.ticket?.status}`);

  console.log("\nTwo agents at once\n");

  const race = await file(stranger.token, 1);
  const both = await Promise.all([
    api(`/admin/tickets/${race.body.id}`, { method: "PATCH", token: agent.token,
      body: { status: "resolved", resolution: "Bina says done." } }),
    api(`/admin/tickets/${race.body.id}`, { method: "PATCH", token: other.token,
      body: { status: "resolved", resolution: "Deepak says done." } }),
  ]);
  const wins = both.filter((r) => r.status === 200).length;
  check("two agents closing at the same moment produce one close", wins === 1,
    `ok=${wins} statuses=${both.map((r) => r.status).join(",")}`);
  const closes = Number(sql(
    `select count(*) from ticket_events where ticket_id = ${race.body.id} and to_status = 'resolved'`));
  check("and one entry in the history", closes === 1, `entries=${closes}`);

  console.log("\nThe queue\n");

  const active = await api("/admin/tickets?status=active", { token: agent.token });
  check("the queue can be narrowed to what is still waiting",
    active.body?.tickets?.every((t) => !["resolved", "denied", "cancelled"].includes(t.status)),
    JSON.stringify(active.body?.tickets?.map((t) => t.status).slice(0, 8)));
  check("and it leaves out the ones that are finished",
    !active.body?.tickets?.some((t) => t.id === first.body.id));

  const held = await api("/admin/tickets?assigned=me", { token: agent.token });
  check("an agent can see just the ones they hold",
    held.body?.tickets?.every((t) => t.assignedTo === agent.id),
    JSON.stringify(held.body?.tickets?.map((t) => t.assignedTo).slice(0, 8)));
  const notHeld = await api("/admin/tickets?assigned=me", { token: other.token });
  check("and another agent sees a different set",
    !notHeld.body?.tickets?.some((t) => t.id === first.body.id),
    JSON.stringify(notHeld.body?.tickets?.map((t) => t.id).slice(0, 8)));

  const unassigned = await api("/admin/tickets?assigned=unassigned", { token: agent.token });
  check("and the ones nobody has picked up",
    unassigned.body?.tickets?.every((t) => t.assignedTo === null),
    JSON.stringify(unassigned.body?.tickets?.map((t) => t.assignedTo).slice(0, 8)));
  check("every row in the queue carries the number the reporter quotes",
    active.body?.tickets?.every((t) => /^HT-\d{6}$/.test(t.ref ?? "")));

  console.log("\nWho may use the desk\n");

  for (const [who, token] of [["a student", student.token], ["a teacher", (await register("teacher")).token]]) {
    const list = await api("/admin/tickets", { token });
    check(`${who} cannot see the queue`, list.status === 403, `status=${list.status}`);
    const move = await api(`/admin/tickets/${second.id}`, { method: "PATCH", token,
      body: { status: "resolved", resolution: "Closing my own complaint." } });
    check(`nor close a request`, move.status === 403, `status=${move.status}`);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) { failures.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
}

run().catch((err) => { console.error(err); process.exit(1); });
