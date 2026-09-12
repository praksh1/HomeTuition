/**
 * Learning Programs, end to end — the routes, the authority rules, and the two definitions of the
 * schema agreeing with each other.
 *
 * `lib/learningPrograms.test.ts` proves the publish contract and `lib/learningProgramState.test.ts`
 * proves the transitions. Neither touches a database, a socket or an HTTP request, and every
 * failure this suite exists to catch lives in exactly those seams:
 *
 * - a teacher reading or editing somebody else's program;
 * - a draft, or an archived program, reachable from the public list;
 * - a program published by an account no operator has approved;
 * - a snapshot that quietly follows the teacher's later edits;
 * - a page marker or an id that is not a number, answered with a 500 instead of a refusal;
 * - `ensureSchema.ts` and the Drizzle schema building two different tables, which nobody notices
 *   until a deploy and a `db:push` disagree.
 *
 * It starts its own API on its own port, so the boot guard runs and the tables it creates are the
 * ones under test.
 *
 * Usage: PGURL=... node scripts/learning-program-tests/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket } from "ws";
import { prepareTeacherForClass } from "../test-support/teacherAccess.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(serverRoot, "..", "..");
const API_PORT = Number(process.env.PROGRAM_API_PORT ?? 8096);
const API = `http://127.0.0.1:${API_PORT}`;
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";
/*
  The parity gate imports `ensureSchema.ts`, which reaches `@workspace/db`, which refuses to load
  without this. Set to the database this suite is already talking to, and set here rather than
  inside the gate so it is obvious that the whole file works against one database and no other.
  Nothing in the gate opens a connection through it — the DDL is run with `psql`.
*/
process.env.DATABASE_URL = PGURL;

let passed = 0, failed = 0; const failures = [];
const check = (n, ok, d = "") => {
  if (ok) { passed++; console.log(`  ok   ${n}`); }
  else { failed++; failures.push(`${n}${d ? ` — ${d}` : ""}`); console.log(`  FAIL ${n}${d ? ` — ${d}` : ""}`); }
};

const sql = (s) => execFileSync("psql", [PGURL, "-v", "ON_ERROR_STOP=1", "-tAc", s], { encoding: "utf8" }).trim();

async function eventuallySqlNumber(statement, predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  let value = Number(sql(statement));
  while (!predicate(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    value = Number(sql(statement));
  }
  return value;
}

async function api(p, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api${p}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
}

/** The signed-in notification channel the app keeps open. */
function openChannel(token) {
  const ws = new WebSocket(`ws://127.0.0.1:${API_PORT}/api/ws?token=${encodeURIComponent(token)}`);
  const events = [];
  ws.on("message", (raw) => {
    let event;
    try { event = JSON.parse(String(raw)); } catch { return; }
    if (event?.type === "notification") events.push(event);
  });
  return {
    events,
    open: () => new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    }),
    next: async (kind, ms = 3000) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        const event = events.find((item) => item.kind === kind);
        if (event) return event;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return null;
    },
    close: () => ws.close(),
  };
}

let seq = 0;
/** @param {"teacher"|"student"} role  @param {{approved?: boolean}} [opts] */
async function register(role, opts = {}) {
  seq += 1;
  const res = await api("/auth/register", { method: "POST", body: {
    name: role === "teacher" ? `Program Teacher ${seq}` : `Program Student ${seq}`,
    email: `lp_${Date.now()}_${seq}@example.com`, password: "password123", role,
    ...(role === "teacher" ? { subject: "Maths", bio: "x" } : { grade: "10", dateOfBirth: "2000-01-01" }) } });
  if (res.status > 201) throw new Error(`register ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  // Approval is the door publication and public visibility are gated on, so a suite that opened it
  // for everybody could not tell the difference between "approved" and "not checked".
  if (role === "teacher" && opts.approved !== false) prepareTeacherForClass(res.body.user.id);
  return res.body;
}

/* ------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* ------------------------------------------------------------------------- */

const MODULES = [
  { title: "Where we start", outcome: "Know what the first lesson covers and why it comes first." },
  { title: "Practising it", outcome: "Work through examples every week with feedback." },
];

/** A complete, honest draft body. Each pilot overrides only what makes it that pilot. */
const complete = (over = {}) => ({
  title: "A programme with a long enough name",
  summary: "What this covers, who it suits, and how the weeks are spent together.",
  outcome: "Students can work through the material with support.",
  intendedLearner: "Anyone starting out",
  startingLevel: "Beginner",
  teachingLanguage: "Nepali and English",
  referenceSource: "none",
  modules: MODULES,
  ...over,
});

/** Create, fill in and publish one program. Returns its id. */
async function publishOne(token, type, over = {}) {
  const made = await api("/learning-programs", { method: "POST", token, body: { type } });
  if (made.status !== 201) throw new Error(`create: ${made.status} ${JSON.stringify(made.body)}`);
  const id = made.body.program.id;
  const saved = await api(`/learning-programs/${id}`, { method: "PATCH", token, body: complete(over) });
  if (saved.status !== 200) throw new Error(`save: ${saved.status} ${JSON.stringify(saved.body)}`);
  const published = await api(`/learning-programs/${id}/publish`, { method: "POST", token });
  if (published.status !== 200) throw new Error(`publish: ${published.status} ${JSON.stringify(published.body)}`);
  return id;
}

/* ------------------------------------------------------------------------- */
/* 1. The five program types                                                  */
/* ------------------------------------------------------------------------- */

async function programTypes() {
  console.log("\n[1] Every kind of program a teacher may run");
  const teacher = await register("teacher");

  const pilots = [
    ["school_subject", { title: "Grade 10 Mathematics, term by term",
      referenceName: "SEE Mathematics syllabus", referenceSource: "teacher_supplied" }],
    ["practical_skill", { title: "Beginner guitar from the first chord", equipment: "Any acoustic guitar" }],
    ["language", { title: "Spoken English for everyday life", startingLevel: "Can read simple English" }],
    ["exam_preparation", { title: "Engineering registration exam preparation",
      referenceName: "Nepal Engineering Council registration examination", referenceSource: "teacher_supplied" }],
    ["custom", { title: "Study skills for first-year students" }],
  ];

  const ids = [];
  for (const [type, over] of pilots) {
    const id = await publishOne(teacher.token, type, over);
    ids.push(id);
    const read = await api(`/programs/${id}`);
    check(`a ${type} program publishes and is readable by anybody`,
      read.status === 200 && read.body.program.type === type,
      `${read.status} ${JSON.stringify(read.body).slice(0, 120)}`);
  }

  const unknown = await api("/learning-programs", { method: "POST", token: teacher.token, body: { type: "driving_lesson" } });
  check("a kind of program this app does not know is refused at the door",
    unknown.status === 400, `status ${unknown.status}`);
  const noType = await api("/learning-programs", { method: "POST", token: teacher.token, body: {} });
  check("and so is one with no kind at all", noType.status === 400, `status ${noType.status}`);

  // The exam program's reference is carried through exactly as declared, never promoted.
  const exam = await api(`/programs/${ids[3]}`);
  check("a teacher's own citation is not promoted to an official one",
    exam.body.program.referenceSource === "teacher_supplied" &&
      exam.body.program.referenceName === "Nepal Engineering Council registration examination",
    JSON.stringify({ s: exam.body.program.referenceSource, n: exam.body.program.referenceName }));

  return { teacher, ids };
}

/* ------------------------------------------------------------------------- */
/* 2. Publishing, and what it refuses                                         */
/* ------------------------------------------------------------------------- */

async function publishing() {
  console.log("\n[2] Publishing is where completeness is judged, and only there");
  const teacher = await register("teacher");

  const made = await api("/learning-programs", { method: "POST", token: teacher.token, body: { type: "custom" } });
  const id = made.body.program.id;
  check("a brand-new program is a draft", made.body.program.status === "draft", made.body.program.status);
  check("and it says what is still missing rather than looking finished",
    made.body.program.issues.length > 0, JSON.stringify(made.body.program.issues).slice(0, 80));

  const partial = await api(`/learning-programs/${id}`, { method: "PATCH", token: teacher.token, body: { title: "Half a thought about it" } });
  check("an incomplete draft saves", partial.status === 200, `status ${partial.status}`);

  const early = await api(`/learning-programs/${id}/publish`, { method: "POST", token: teacher.token });
  check("publishing an incomplete program is refused", early.status === 422, `status ${early.status}`);
  check("and the refusal names every field, in the validator's own words",
    Array.isArray(early.body.issues) && early.body.issues.some((i) => i.field === "outcome"),
    JSON.stringify(early.body.issues ?? []).slice(0, 140));

  await api(`/learning-programs/${id}`, { method: "PATCH", token: teacher.token, body: complete() });
  const ok = await api(`/learning-programs/${id}/publish`, { method: "POST", token: teacher.token });
  check("a complete one publishes", ok.status === 200 && ok.body.program.status === "published", `status ${ok.status}`);
  check("at version 1", ok.body.program.version === 1, String(ok.body.program.version));

  // An exam program must name its exam; never infer one.
  const examId = (await api("/learning-programs", { method: "POST", token: teacher.token, body: { type: "exam_preparation" } })).body.program.id;
  await api(`/learning-programs/${examId}`, { method: "PATCH", token: teacher.token, body: complete({ referenceSource: "none" }) });
  const nameless = await api(`/learning-programs/${examId}/publish`, { method: "POST", token: teacher.token });
  check("an exam program with no exam named is refused",
    nameless.status === 422 && nameless.body.issues.some((i) => i.field === "referenceName"),
    JSON.stringify(nameless.body.issues ?? []).slice(0, 140));

  // And it may not promise a result.
  await api(`/learning-programs/${examId}`, { method: "PATCH", token: teacher.token, body: complete({
    referenceName: "Nepal Engineering Council registration examination",
    referenceSource: "teacher_supplied",
    outcome: "Students are guaranteed to pass the registration examination.",
  }) });
  const promising = await api(`/learning-programs/${examId}/publish`, { method: "POST", token: teacher.token });
  check("and one guaranteeing a pass is refused as an unsupported claim",
    promising.status === 422 && promising.body.issues.some((i) => i.code === "unsupported_claim"),
    JSON.stringify(promising.body.issues ?? []).slice(0, 140));

  const unreviewed = await register("teacher", { approved: false });
  const theirs = (await api("/learning-programs", { method: "POST", token: unreviewed.token, body: { type: "custom" } })).body.program.id;
  await api(`/learning-programs/${theirs}`, { method: "PATCH", token: unreviewed.token, body: complete() });
  const refused = await api(`/learning-programs/${theirs}/publish`, { method: "POST", token: unreviewed.token });
  check("an account no operator has approved may write a draft but not publish it",
    refused.status === 403 && refused.body.code === "OPERATOR_REVIEW", `status ${refused.status}`);

  return { teacher, publishedId: id };
}

/* ------------------------------------------------------------------------- */
/* 3. A published program is immutable until it is republished                */
/* ------------------------------------------------------------------------- */

async function immutability(ctx) {
  console.log("\n[3] What a student read cannot be rewritten underneath them");
  const { teacher, publishedId: id } = ctx;

  const before = await api(`/programs/${id}`);
  check("the published page is readable", before.status === 200, `status ${before.status}`);

  const edit = await api(`/learning-programs/${id}`, { method: "PATCH", token: teacher.token, body: { outcome: "Something completely different from what was promised." } });
  check("the teacher may keep editing after publishing", edit.status === 200, `status ${edit.status}`);
  check("and is told there are changes students cannot see yet",
    edit.body.program.hasUnpublishedChanges === true, JSON.stringify(edit.body.program.hasUnpublishedChanges));

  const after = await api(`/programs/${id}`);
  check("the public page is unchanged by the edit",
    after.body.program.outcome === before.body.program.outcome,
    `${before.body.program.outcome} -> ${after.body.program.outcome}`);
  check("and still at version 1", after.body.program.version === 1, String(after.body.program.version));

  const again = await api(`/learning-programs/${id}/publish`, { method: "POST", token: teacher.token });
  check("re-publishing is an explicit act", again.status === 200, `status ${again.status}`);
  check("and it is a new version, so a student can tell it changed",
    again.body.program.version === 2, String(again.body.program.version));
  const now = await api(`/programs/${id}`);
  check("only now does the public page follow", now.body.program.outcome.startsWith("Something completely"),
    now.body.program.outcome);
  check("and nothing is left saying there are unpublished changes",
    again.body.program.hasUnpublishedChanges === false, String(again.body.program.hasUnpublishedChanges));
}

/* ------------------------------------------------------------------------- */
/* 4. Ownership                                                               */
/* ------------------------------------------------------------------------- */

async function ownership() {
  console.log("\n[4] A teacher may touch only their own");
  const mine = await register("teacher");
  const theirs = await register("teacher");
  const student = await register("student");

  const id = (await api("/learning-programs", { method: "POST", token: mine.token, body: { type: "custom" } })).body.program.id;

  for (const [what, call] of [
    ["read", () => api(`/learning-programs/${id}`, { token: theirs.token })],
    ["edit", () => api(`/learning-programs/${id}`, { method: "PATCH", token: theirs.token, body: { title: "Taken over" } })],
    ["publish", () => api(`/learning-programs/${id}/publish`, { method: "POST", token: theirs.token })],
    ["archive", () => api(`/learning-programs/${id}/archive`, { method: "POST", token: theirs.token })],
    ["delete", () => api(`/learning-programs/${id}`, { method: "DELETE", token: theirs.token })],
  ]) {
    const res = await call();
    check(`another teacher cannot ${what} it`, res.status === 404, `status ${res.status}`);
  }

  const still = await api(`/learning-programs/${id}`, { token: mine.token });
  check("and nothing they tried changed it", still.status === 200 && still.body.program.status === "draft",
    `${still.status} ${still.body?.program?.status}`);
  check("the refusal is the same as for an id that does not exist",
    (await api("/learning-programs/99999999", { token: theirs.token })).status === 404);

  const asStudent = await api("/learning-programs", { token: student.token });
  check("a student has no Learning Programs of their own", asStudent.status === 403, `status ${asStudent.status}`);
  const studentWrite = await api("/learning-programs", { method: "POST", token: student.token, body: { type: "custom" } });
  check("and cannot create one by asking", studentWrite.status === 403, `status ${studentWrite.status}`);

  /*
    The identity is the token's, and there is nowhere to say otherwise.

    Sent anyway, because "the field is ignored" is a claim worth a test: a later refactor that
    spread the body into the insert would pass every other check in this suite.
  */
  const spoofed = await api("/learning-programs", { method: "POST", token: mine.token, body: { type: "custom", teacherId: theirs.user.id, id: 1, status: "published", version: 99 } });
  check("a body naming another teacher does not create their program",
    spoofed.status === 201 && spoofed.body.program.status === "draft" && spoofed.body.program.version === 0,
    JSON.stringify({ s: spoofed.body?.program?.status, v: spoofed.body?.program?.version }));
  const owner = sql(`select teacher_id from learning_programs where id = ${spoofed.body.program.id}`);
  check("and the row is owned by the account that asked", Number(owner) === mine.user.id, `${owner} vs ${mine.user.id}`);

  return { mine, theirs, student };
}

/* ------------------------------------------------------------------------- */
/* 5. What the public may read                                                */
/* ------------------------------------------------------------------------- */

async function publicReads(who) {
  console.log("\n[5] Drafts and archived programs are not on the internet");
  const teacher = await register("teacher");

  const draftId = (await api("/learning-programs", { method: "POST", token: teacher.token, body: { type: "custom" } })).body.program.id;
  await api(`/learning-programs/${draftId}`, { method: "PATCH", token: teacher.token, body: complete({ title: "A draft nobody should see" }) });

  const publishedId = await publishOne(teacher.token, "language", { title: "A published programme to find" });
  const archivedId = await publishOne(teacher.token, "custom", { title: "A programme that was put away" });
  await api(`/learning-programs/${archivedId}/archive`, { method: "POST", token: teacher.token });

  check("a draft is not readable publicly", (await api(`/programs/${draftId}`)).status === 404);
  check("an archived program is not readable publicly", (await api(`/programs/${archivedId}`)).status === 404);
  check("a published one is", (await api(`/programs/${publishedId}`)).status === 200);

  const list = await api("/programs?limit=50");
  const ids = list.body.programs.map((p) => p.id);
  check("the public list holds the published one", ids.includes(publishedId), JSON.stringify(ids).slice(0, 80));
  check("and neither the draft nor the archived one",
    !ids.includes(draftId) && !ids.includes(archivedId), JSON.stringify(ids).slice(0, 80));

  /*
    Read while signed out, and it must be the same answer.

    The public routes carry no `requireAuth`, so this is checking that they are genuinely public —
    and, more usefully, that being signed in as somebody else does not open a door.
  */
  check("the same is true for a signed-out reader", (await api(`/programs/${draftId}`, {})).status === 404);
  check("and for a student who is signed in",
    (await api(`/programs/${draftId}`, { token: who.student.token })).status === 404);

  const unreviewed = await register("teacher", { approved: false });
  const theirDraft = (await api("/learning-programs", { method: "POST", token: unreviewed.token, body: { type: "custom" } })).body.program.id;
  // They cannot publish, so there is nothing of theirs to find. Asserted from the public side.
  const listAgain = await api("/programs?limit=50");
  check("nothing from an unreviewed account is in the public list",
    !listAgain.body.programs.some((p) => p.id === theirDraft));

  // A suspended teacher's published program comes off the list without anything being deleted.
  const suspended = await register("teacher");
  const suspendedProgram = await publishOne(suspended.token, "custom", { title: "Published before the suspension" });
  check("it is public first", (await api(`/programs/${suspendedProgram}`)).status === 200);
  sql(`update users set suspended_at = now() where id = ${suspended.user.id}`);
  check("and gone once the account is suspended", (await api(`/programs/${suspendedProgram}`)).status === 404);
  check("without the program being deleted",
    Number(sql(`select count(*) from learning_programs where id = ${suspendedProgram}`)) === 1);

  const one = await api(`/programs/${publishedId}`);
  const keys = Object.keys(one.body.program);
  for (const invented of ["rating", "reviews", "students", "enrolled", "enrolments", "popular", "verified", "price", "available"]) {
    check(`the public page carries no ${invented}`, !keys.includes(invented), JSON.stringify(keys));
  }
  check("it names the teacher, which is a fact rather than a claim",
    typeof one.body.program.teacher?.name === "string" && one.body.program.teacher.name.length > 0);

  return { teacher, publishedId };
}

/* ------------------------------------------------------------------------- */
/* 6. Module order                                                            */
/* ------------------------------------------------------------------------- */

async function moduleOrder() {
  console.log("\n[6] The steps stay in the order the teacher wrote them");
  const teacher = await register("teacher");
  const id = (await api("/learning-programs", { method: "POST", token: teacher.token, body: { type: "custom" } })).body.program.id;

  const five = ["First", "Second", "Third", "Fourth", "Fifth"].map((title, i) => ({
    title, outcome: `Step ${i + 1} outcome, written out at a usable length.`,
  }));
  await api(`/learning-programs/${id}`, { method: "PATCH", token: teacher.token, body: complete({ modules: five }) });

  const owner = await api(`/learning-programs/${id}`, { token: teacher.token });
  check("the draft keeps the order",
    JSON.stringify(owner.body.program.draft.modules.map((m) => m.title)) === JSON.stringify(["First", "Second", "Third", "Fourth", "Fifth"]),
    JSON.stringify(owner.body.program.draft.modules.map((m) => m.title)));
  const stored = sql(`select string_agg(title, ',' order by position) from learning_program_modules where program_id = ${id}`);
  check("and so does the database, by position", stored === "First,Second,Third,Fourth,Fifth", stored);

  await api(`/learning-programs/${id}/publish`, { method: "POST", token: teacher.token });
  const publicView = await api(`/programs/${id}`);
  check("and so does the published page",
    JSON.stringify(publicView.body.program.modules.map((m) => m.title)) === JSON.stringify(["First", "Second", "Third", "Fourth", "Fifth"]),
    JSON.stringify(publicView.body.program.modules.map((m) => m.title)));
  check("numbered densely from zero",
    JSON.stringify(publicView.body.program.modules.map((m) => m.position)) === JSON.stringify([0, 1, 2, 3, 4]));

  // Reordering rewrites the positions rather than leaving a gap or a duplicate.
  const reversed = [...five].reverse();
  const reorder = await api(`/learning-programs/${id}`, { method: "PATCH", token: teacher.token, body: { modules: reversed } });
  /*
    Asserted rather than assumed, because it was not true once.

    A save carrying only `modules` has no program column to write, and an empty `SET` is an error
    the database raises — so this returned 500 and the two checks below failed against a list that
    had never been replaced. A save with one field in it is the ordinary case, not an edge.
  */
  check("a save carrying only steps is accepted", reorder.status === 200, `status ${reorder.status}`);
  const after = sql(`select string_agg(title, ',' order by position) from learning_program_modules where program_id = ${id}`);
  check("reordering rewrites the order", after === "Fifth,Fourth,Third,Second,First", after);
  const positions = sql(`select string_agg(position::text, ',' order by position) from learning_program_modules where program_id = ${id}`);
  check("with no gap and no duplicate", positions === "0,1,2,3,4", positions);

  /*
    A client-supplied position is ignored, because two steps claiming position 3 is a body a client
    can send and a state the reader has no honest way to resolve.
  */
  const claimedPositions = await api(`/learning-programs/${id}`, { method: "PATCH", token: teacher.token, body: { modules: [
    { title: "Says it is third", outcome: "An outcome long enough to be accepted.", position: 3 },
    { title: "Also says it is third", outcome: "An outcome long enough to be accepted.", position: 3 },
  ] } });
  check("and so is one whose steps carry positions of their own", claimedPositions.status === 200,
    `status ${claimedPositions.status}`);
  const claimed = sql(`select string_agg(position::text, ',' order by position) from learning_program_modules where program_id = ${id}`);
  check("a position a client sent is ignored in favour of the order it sent", claimed === "0,1", claimed);

  const tooMany = await api(`/learning-programs/${id}`, { method: "PATCH", token: teacher.token, body: {
    modules: Array.from({ length: 41 }, (_, i) => ({ title: `Step ${i}`, outcome: "x" })),
  } });
  check("more steps than the contract will validate is refused, not truncated",
    tooMany.status === 400, `status ${tooMany.status}`);
}

/* ------------------------------------------------------------------------- */
/* 7. Pagination, filters and malformed input                                 */
/* ------------------------------------------------------------------------- */

async function paging() {
  console.log("\n[7] Pages are bounded, and rubbish is refused rather than guessed at");
  const teacher = await register("teacher");
  for (let i = 0; i < 4; i += 1) {
    await publishOne(teacher.token, "custom", { title: `A paging programme number ${i + 1}` });
  }

  const first = await api("/programs?limit=2");
  check("a page is the size asked for", first.body.programs.length === 2, String(first.body.programs.length));
  check("and says there is another", typeof first.body.nextCursor === "string", String(first.body.nextCursor));

  const second = await api(`/programs?limit=2&cursor=${first.body.nextCursor}`);
  const overlap = first.body.programs.filter((p) => second.body.programs.some((q) => q.id === p.id));
  check("the next page does not repeat the first", overlap.length === 0, JSON.stringify(overlap.map((p) => p.id)));

  /*
    One rule for page size: a whole positive number, capped at the maximum.

    Codex's second smaller correction. `Math.max(1, Number(q) || 20)` passed `1.5` straight into the
    database's LIMIT and turned `"lots"` into the default without ever saying the request was wrong.
    Capping a large number is the one deliberate normalisation — a client asking for a thousand
    means "as many as you will give me" — and everything else that is not a whole positive number
    is refused, because there is no honest guess at what `1.5` meant.
  */
  const huge = await api("/programs?limit=100000");
  check("an enormous limit is capped rather than honoured",
    huge.status === 200 && huge.body.programs.length <= 50, `${huge.status} ${huge.body?.programs?.length}`);
  for (const bad of ["0", "-1", "1.5", "lots", "1e3", " 2", "2 ", "", "Infinity", "NaN"]) {
    const res = await api(`/programs?limit=${encodeURIComponent(bad)}`);
    check(`a page size of "${bad}" is refused rather than guessed at`, res.status === 400, `status ${res.status}`);
  }
  const noLimit = await api("/programs");
  check("and asking for no page size at all gets the default", noLimit.status === 200, `status ${noLimit.status}`);
  const teacherBadLimit = await api("/learning-programs?limit=1.5", { token: teacher.token });
  check("the teacher's own list follows the same rule", teacherBadLimit.status === 400, `status ${teacherBadLimit.status}`);

  check("a page marker that is not a number is refused", (await api("/programs?cursor=abc")).status === 400);
  check("and so is a negative one", (await api("/programs?cursor=-4")).status === 400);
  check("and so is one that names only an id, now that the order is by publication time",
    (await api("/programs?cursor=12")).status === 400);
  check("a filter on a kind of program that does not exist is refused",
    (await api("/programs?type=driving_lesson")).status === 400);
  const filtered = await api("/programs?type=custom&limit=50");
  check("and a real filter returns only that kind",
    filtered.status === 200 && filtered.body.programs.every((p) => p.type === "custom"),
    JSON.stringify(filtered.body.programs.map((p) => p.type)).slice(0, 80));

  for (const bad of ["abc", "1.5", "-1", "0", "1e3", "%20"]) {
    check(`a program address of "${bad}" is refused rather than crashing`,
      [400, 404].includes((await api(`/programs/${bad}`)).status));
  }

  const teacherList = await api("/learning-programs?status=everything", { token: teacher.token });
  check("filtering the teacher's own list by a state that does not exist is refused",
    teacherList.status === 400, `status ${teacherList.status}`);
  const drafts = await api("/learning-programs?status=draft", { token: teacher.token });
  check("and a real one returns only that state",
    drafts.status === 200 && drafts.body.programs.every((p) => p.status === "draft"),
    JSON.stringify(drafts.body?.programs?.map((p) => p.status) ?? []).slice(0, 80));

  const id = (await api("/learning-programs", { method: "POST", token: teacher.token, body: { type: "custom" } })).body.program.id;
  for (const [what, body] of [
    ["a title that is not text", { title: 42 }],
    ["steps that are not a list", { modules: "three of them" }],
    ["a step that is not an object", { modules: ["just a string"] }],
    ["a reference source outside the three", { referenceSource: "endorsed" }],
    ["a kind of program that does not exist", { type: "driving_lesson" }],
    ["a field longer than any honest answer", { summary: "x".repeat(4001) }],
  ]) {
    const res = await api(`/learning-programs/${id}`, { method: "PATCH", token: teacher.token, body });
    check(`${what} is refused`, res.status === 400, `status ${res.status}`);
  }
}

/* ------------------------------------------------------------------------- */
/* 7b. Teacher profiles and follower news                                    */
/* ------------------------------------------------------------------------- */

async function profileProgramsAndFollowers() {
  console.log("\n[7b] A teacher's public profile and the followers waiting for new work");
  const teacher = await register("teacher");
  const other = await register("teacher");
  const follower = await register("student");
  const teacherProfileId = Number(sql(`select id from teacher_profiles where user_id = ${teacher.user.id}`));

  const followed = await api(`/teachers/${teacherProfileId}/follow`, {
    method: "POST", token: follower.token, body: {},
  });
  check("a student can follow the teacher whose profile they are viewing", followed.status === 201,
    `status ${followed.status}`);

  const channel = openChannel(follower.token);
  await channel.open();
  try {
    const ownId = await publishOne(teacher.token, "practical_skill", {
      title: "Fingerstyle guitar from the first pattern",
    });
    const otherId = await publishOne(other.token, "language", {
      title: "Conversational Japanese for beginners",
    });

    const event = await channel.next("program_published");
    check("the follower is told when this teacher first publishes a program",
      event?.programId === ownId && event?.programTitle === "Fingerstyle guitar from the first pattern" &&
        event?.fromUserId === teacher.user.id,
      JSON.stringify(event));

    const profile = await api(`/programs?teacherProfileId=${teacherProfileId}&limit=50`);
    const ids = profile.body?.programs?.map((program) => program.id) ?? [];
    check("the teacher profile returns that teacher's published snapshots",
      profile.status === 200 && ids.includes(ownId), JSON.stringify(ids));
    check("and never leaks another teacher's program into the section",
      !ids.includes(otherId), JSON.stringify(ids));

    await api(`/learning-programs/${ownId}`, {
      method: "PATCH", token: teacher.token, body: { summary: "A clearer description for students." },
    });
    await api(`/learning-programs/${ownId}/publish`, { method: "POST", token: teacher.token });
    await new Promise((resolve) => setTimeout(resolve, 250));
    check("re-publishing an edit does not announce a second new program",
      channel.events.filter((item) => item.kind === "program_published").length === 1,
      JSON.stringify(channel.events));

    await api(`/learning-programs/${ownId}/unpublish`, { method: "POST", token: teacher.token });
    const after = await api(`/programs?teacherProfileId=${teacherProfileId}`);
    check("taking a program down removes it from the teacher's public profile",
      !after.body.programs.some((program) => program.id === ownId));
  } finally {
    channel.close();
  }

  for (const bad of ["no", "1.5", "-1", "0"]) {
    check(`a teacher profile filter of "${bad}" is refused`,
      (await api(`/programs?teacherProfileId=${encodeURIComponent(bad)}`)).status === 400);
  }
}

/* ------------------------------------------------------------------------- */
/* 8. Signed out                                                              */
/* ------------------------------------------------------------------------- */

async function unauthenticated() {
  console.log("\n[8] Signed out, the teacher's side does not answer at all");
  for (const [what, call] of [
    ["list their programs", () => api("/learning-programs")],
    ["create one", () => api("/learning-programs", { method: "POST", body: { type: "custom" } })],
    ["read one", () => api("/learning-programs/1")],
    ["edit one", () => api("/learning-programs/1", { method: "PATCH", body: { title: "x" } })],
    ["publish one", () => api("/learning-programs/1/publish", { method: "POST" })],
    ["archive one", () => api("/learning-programs/1/archive", { method: "POST" })],
    ["delete one", () => api("/learning-programs/1", { method: "DELETE" })],
  ]) {
    const res = await call();
    check(`a stranger cannot ${what}`, res.status === 401, `status ${res.status}`);
  }

  const bad = await api("/learning-programs", { token: "not.a.real.token" });
  check("nor can a made-up token", bad.status === 401, `status ${bad.status}`);

  check("the public list is genuinely public", (await api("/programs")).status === 200);
  check("and so are the builder's templates", (await api("/learning-programs/templates")).status === 200);
}

/* ------------------------------------------------------------------------- */
/* 9. Taking it down, putting it away, deleting it                            */
/* ------------------------------------------------------------------------- */

async function lifecycle() {
  console.log("\n[9] Down, away and gone are three different things");
  const teacher = await register("teacher");

  const id = await publishOne(teacher.token, "custom", { title: "A programme to take down again" });
  const down = await api(`/learning-programs/${id}/unpublish`, { method: "POST", token: teacher.token });
  check("unpublishing returns it to draft", down.status === 200 && down.body.program.status === "draft", `status ${down.status}`);
  check("and it leaves the internet", (await api(`/programs/${id}`)).status === 404);
  check("but what was published is kept, because somebody may have read it",
    down.body.program.published !== null, JSON.stringify(down.body.program.published)?.slice(0, 60));

  const notPublished = await api(`/learning-programs/${id}/unpublish`, { method: "POST", token: teacher.token });
  check("taking down something already down is refused, and says why",
    notPublished.status === 409 && notPublished.body.code === "not-published", `status ${notPublished.status}`);

  const gone = await api(`/learning-programs/${id}`, { method: "DELETE", token: teacher.token });
  check("a program that was once published cannot be deleted",
    gone.status === 409 && gone.body.code === "was-published", `${gone.status} ${gone.body?.code}`);
  check("and the row is still there", Number(sql(`select count(*) from learning_programs where id = ${id}`)) === 1);

  const away = await api(`/learning-programs/${id}/archive`, { method: "POST", token: teacher.token });
  check("archiving it is the way to put it away", away.status === 200 && away.body.program.status === "archived", `status ${away.status}`);
  const edit = await api(`/learning-programs/${id}`, { method: "PATCH", token: teacher.token, body: { title: "Changed while archived" } });
  check("an archived program refuses edits, and names the way out",
    edit.status === 409 && edit.body.code === "archived", `${edit.status} ${edit.body?.code}`);
  const back = await api(`/learning-programs/${id}/restore`, { method: "POST", token: teacher.token });
  check("restoring returns it to draft, never straight to published",
    back.status === 200 && back.body.program.status === "draft", `${back.status} ${back.body?.program?.status}`);
  check("so it does not reappear on the internet without a decision", (await api(`/programs/${id}`)).status === 404);

  const fresh = (await api("/learning-programs", { method: "POST", token: teacher.token, body: { type: "custom" } })).body.program.id;
  const deleted = await api(`/learning-programs/${fresh}`, { method: "DELETE", token: teacher.token });
  check("a draft that was never published can be deleted", deleted.status === 200, `status ${deleted.status}`);
  check("and its steps go with it",
    Number(sql(`select count(*) from learning_program_modules where program_id = ${fresh}`)) === 0);
}

/* ------------------------------------------------------------------------- */
/* 10. Moderation                                                             */
/* ------------------------------------------------------------------------- */

async function moderation() {
  console.log("\n[10] The moderation this app already runs, on the fields a teacher writes");
  const teacher = await register("teacher");
  const id = (await api("/learning-programs", { method: "POST", token: teacher.token, body: { type: "custom" } })).body.program.id;

  const before = Number(sql(`select count(*) from moderation_flags where surface = 'learning_program' and subject_id = ${id}`));
  const term = sql(`select 1`) && "fuck";
  const res = await api(`/learning-programs/${id}`, { method: "PATCH", token: teacher.token, body: complete({ summary: `A summary that says ${term} in the middle of it.` }) });
  check("a teacher is not blocked mid-sentence by a word list", res.status === 200, `status ${res.status}`);
  const after = Number(sql(`select count(*) from moderation_flags where surface = 'learning_program' and subject_id = ${id}`));
  check("but an operator can see what was written", after > before, `${before} -> ${after}`);
  const surface = sql(`select surface from moderation_flags where subject_id = ${id} limit 1`);
  check("filed under its own surface, so a reviewer knows where it came from",
    surface === "learning_program", surface);

  const clean = (await api("/learning-programs", { method: "POST", token: teacher.token, body: { type: "custom" } })).body.program.id;
  await api(`/learning-programs/${clean}`, { method: "PATCH", token: teacher.token, body: complete() });
  check("an ordinary program raises nothing",
    Number(sql(`select count(*) from moderation_flags where subject_id = ${clean} and surface = 'learning_program'`)) === 0);
}

/* ------------------------------------------------------------------------- */
/* 11. The two definitions of the schema agree                                */
/* ------------------------------------------------------------------------- */

/**
 * Does the boot guard's hand-written DDL build the same tables the Drizzle schema describes?
 *
 * It has to. The API redeploys itself on every push and runs the guard; `db:push` is a command the
 * owner runs by hand from his laptop, so the two are never in step. If they build different tables,
 * a deploy and a push disagree about the shape of the thing programs are stored in and nobody finds
 * out until something is wrong.
 *
 * Run against a **throwaway Postgres schema** rather than the live tables: nothing existing is
 * dropped, `db:push` is not invoked, and the comparison is deterministic whichever way the test
 * database happened to be built. The DDL comes from `LEARNING_PROGRAM_DDL` — the array the guard
 * itself executes — rather than from a copy pasted into this file, because a copy would drift the
 * first time somebody edited one and not the other, which is the exact failure this gate exists to
 * catch, reintroduced inside the thing meant to catch it.
 */
async function schemaParity() {
  console.log("\n[11] `ensureSchema.ts` and the Drizzle schema build the same tables");

  /*
    The plain JSON logger, for this process only and only from here.

    `lib/logger.ts` attaches `pino-pretty` outside production, and that transport spawns a worker by
    `__dirname` — which does not exist in an ES module, so importing the bundle fails with a
    `ReferenceError` that has nothing whatever to do with the schema. `floor-tests` records the same
    trap. The API child was spawned before this line and was given `NODE_ENV=test` explicitly, so
    nothing under test is affected.
  */
  process.env.NODE_ENV = "production";
  process.env.LOG_LEVEL = "silent";

  const esbuild = await import(createRequire(path.join(serverRoot, "package.json")).resolve("esbuild"));
  const work = mkdtempSync(path.join(tmpdir(), "lp-parity-"));
  const bundlePath = path.join(work, "parity.mjs");
  const entry = path.join(work, "entry.ts");
  writeFileSync(
    entry,
    [
      `export { LEARNING_PROGRAM_DDL } from ${JSON.stringify(path.join(serverRoot, "src", "lib", "ensureSchema.ts"))};`,
      `export { learningProgramsTable, learningProgramModulesTable, learningProgramBatchesTable, learningProgramBatchLessonsTable, learningProgramTuitionGroupsTable, learningProgramBatchPeriodsTable, learningProgramEnrollmentsTable, learningProgramAllocationsTable, learningProgramLedgerEntriesTable } from ${JSON.stringify(path.join(repoRoot, "lib", "db", "src", "schema", "learningPrograms.ts"))};`,
      `export { getTableColumns } from "drizzle-orm";`,
      `export { teachingClassSetupsTable, teachingClassJoiningTable } from ${JSON.stringify(path.join(repoRoot, "lib", "db", "src", "schema", "learningPrograms.ts"))};`,
    ].join("\n"),
  );
  await (esbuild.build ?? esbuild.default.build)({
    entryPoints: [entry],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["pg-native"],
    banner: { js: "import { createRequire as __cr } from 'node:module';\nglobalThis.require = __cr(import.meta.url);" },
    logLevel: "error",
    absWorkingDir: serverRoot,
    /*
      Where `drizzle-orm` is found.

      The entry above lives in a temporary directory, and esbuild resolves a bare import by walking
      up from the importing file — which from `/tmp` reaches nothing. Naming the two `node_modules`
      explicitly is the same escape hatch `sikshya/scripts/bundle-for-browser.mjs` uses, and it is
      why the scratch file can stay out of the repository.
    */
    nodePaths: [path.join(serverRoot, "node_modules"), path.join(repoRoot, "node_modules")],
  });
  const mod = await import(bundlePath);

  const scratch = `lp_parity_${process.pid}`;
  const ddl = mod.LEARNING_PROGRAM_DDL.join(";\n");
  execFileSync("psql", [PGURL, "-v", "ON_ERROR_STOP=1", "-q", "-c",
    `DROP SCHEMA IF EXISTS ${scratch} CASCADE; CREATE SCHEMA ${scratch};`], { encoding: "utf8" });
  try {
    // `search_path` puts the new tables in the scratch schema while the foreign key to `users`
    // still resolves against the real one — so the constraint is genuinely exercised.
    execFileSync("psql", [PGURL, "-v", "ON_ERROR_STOP=1", "-q", "-c",
      `SET search_path TO ${scratch}, public; ${ddl};`], { encoding: "utf8" });
    check("the boot guard's DDL runs", true);

    /** Drizzle's own view of a table: column name → the shape it expects in Postgres. */
    const fromDrizzle = (table) => {
      const columns = mod.getTableColumns(table);
      const out = new Map();
      for (const column of Object.values(columns)) {
        // `serial` is an integer with a sequence default; Postgres reports the integer.
        const declared = column.getSQLType();
        const type = declared === "serial" ? "integer" : declared;
        out.set(column.name, {
          type,
          notNull: Boolean(column.notNull) || Boolean(column.primary),
          hasDefault: Boolean(column.hasDefault),
        });
      }
      return out;
    };

    const fromDatabase = (tableName) => {
      const rows = sql(`
        select column_name || '|' || data_type || '|' || is_nullable || '|' ||
               (case when column_default is null then 'no' else 'yes' end)
          from information_schema.columns
         where table_schema = '${scratch}' and table_name = '${tableName}'
         order by column_name`);
      const out = new Map();
      for (const line of rows.split("\n").filter(Boolean)) {
        const [name, type, nullable, hasDefault] = line.split("|");
        out.set(name, { type, notNull: nullable === "NO", hasDefault: hasDefault === "yes" });
      }
      return out;
    };

    for (const [name, table] of [
      ["learning_programs", mod.learningProgramsTable],
      ["teaching_class_setups", mod.teachingClassSetupsTable],
      ["teaching_class_joining", mod.teachingClassJoiningTable],
      ["learning_program_modules", mod.learningProgramModulesTable],
      ["learning_program_batches", mod.learningProgramBatchesTable],
      ["learning_program_batch_lessons", mod.learningProgramBatchLessonsTable],
      ["learning_program_tuition_groups", mod.learningProgramTuitionGroupsTable],
      ["learning_program_batch_periods", mod.learningProgramBatchPeriodsTable],
      ["learning_program_enrollments", mod.learningProgramEnrollmentsTable],
      ["learning_program_allocations", mod.learningProgramAllocationsTable],
      ["learning_program_ledger_entries", mod.learningProgramLedgerEntriesTable],
    ]) {
      const wanted = fromDrizzle(table);
      const built = fromDatabase(name);

      const missing = [...wanted.keys()].filter((c) => !built.has(c));
      const extra = [...built.keys()].filter((c) => !wanted.has(c));
      check(`${name}: the guard creates every column the schema declares`,
        missing.length === 0, `missing: ${missing.join(", ")}`);
      check(`${name}: and no column the schema does not`,
        extra.length === 0, `extra: ${extra.join(", ")}`);

      const wrong = [];
      for (const [column, want] of wanted) {
        const got = built.get(column);
        if (!got) continue;
        if (got.type !== want.type) wrong.push(`${column}: ${want.type} vs ${got.type}`);
        if (got.notNull !== want.notNull) wrong.push(`${column}: notNull ${want.notNull} vs ${got.notNull}`);
        if (got.hasDefault !== want.hasDefault) wrong.push(`${column}: default ${want.hasDefault} vs ${got.hasDefault}`);
      }
      check(`${name}: every column has the same type, nullability and default`,
        wrong.length === 0, wrong.join("; "));
    }

    const indexes = sql(`select indexname from pg_indexes where schemaname = '${scratch}' order by indexname`)
      .split("\n").map((s) => s.trim()).filter(Boolean);
    for (const wanted of [
      "learning_programs_teacher_idx",
      "teaching_class_setups_request_idx",
      "learning_programs_public_idx",
      "learning_program_modules_program_idx",
      "learning_program_batches_program_idx",
      "learning_program_batches_public_idx",
      "learning_program_batch_lessons_position_idx",
      "learning_program_batch_lessons_start_idx",
      "learning_program_tuition_groups_program_idx",
      "learning_program_batch_periods_group_idx",
      "learning_program_enrollments_student_program_idx",
      "learning_program_enrollments_teacher_statement_idx",
      "learning_program_allocations_lesson_idx",
      "learning_program_allocations_state_idx",
      "learning_program_ledger_enrollment_idx",
      "learning_program_ledger_created_idx",
    ]) {
      check(`the index ${wanted} is created`, indexes.includes(wanted), indexes.join(", "));
    }

    const fks = sql(`
      select count(*) from information_schema.table_constraints
       where table_schema = '${scratch}' and constraint_type = 'FOREIGN KEY'`);
    check("all Program foreign keys are created, so an orphan row cannot exist", Number(fks) === 18, fks);
  } finally {
    execFileSync("psql", [PGURL, "-q", "-c", `DROP SCHEMA IF EXISTS ${scratch} CASCADE`], { encoding: "utf8" });
  }
}

/* ------------------------------------------------------------------------- */
/* 13. A corrupt or skewed snapshot is not served                             */
/* ------------------------------------------------------------------------- */

/**
 * Codex's first blocking finding, from the public side.
 *
 * `readSnapshot` used to normalise a missing required string to `""` and a missing modules array to
 * `[]`, so a corrupt row reached `/programs` as a public page with no outcome and no steps — which
 * reads as a teacher who could not be bothered rather than as data this app cannot honestly show.
 * The pure tests cover every field; these prove the route behaves the same way, against rows
 * corrupted in the database rather than in a fixture.
 */
async function corruptSnapshots() {
  console.log("\n[13] A snapshot the server cannot vouch for is not shown at all");
  const teacher = await register("teacher");

  const cases = [
    ["a required field is missing", `published_snapshot = published_snapshot - 'outcome'`],
    ["a required field is blank", `published_snapshot = jsonb_set(published_snapshot, '{summary}', '"   "')`],
    ["a required field is a number", `published_snapshot = jsonb_set(published_snapshot, '{title}', '42')`],
    ["the steps are gone", `published_snapshot = jsonb_set(published_snapshot, '{modules}', '[]')`],
    ["a step lost its outcome", `published_snapshot = jsonb_set(published_snapshot, '{modules,0,outcome}', '""')`],
    ["the positions have a gap", `published_snapshot = jsonb_set(published_snapshot, '{modules,1,position}', '4')`],
    ["the positions are duplicated", `published_snapshot = jsonb_set(published_snapshot, '{modules,1,position}', '0')`],
    ["the version is zero", `published_snapshot = jsonb_set(published_snapshot, '{version}', '0')`],
    ["the type is one this build does not know",
      `published_snapshot = jsonb_set(published_snapshot, '{type}', '"driving_lesson"')`],
  ];

  for (const [what, mutation] of cases) {
    const id = await publishOne(teacher.token, "custom", { title: `Corruptible programme ${what}` });
    check(`it is public before anything is broken (${what})`, (await api(`/programs/${id}`)).status === 200);
    sql(`update learning_programs set ${mutation} where id = ${id}`);
    check(`${what}: the page is withheld rather than half-drawn`,
      (await api(`/programs/${id}`)).status === 404);
    const list = await api("/programs?limit=50");
    check(`${what}: and it is not in the list either`,
      !list.body.programs.some((p) => p.id === id), JSON.stringify(list.body.programs.map((p) => p.id)).slice(0, 80));
    sql(`delete from learning_programs where id = ${id}`);
  }

  /*
    The version-skew case, which is its own kind of wrong.

    The row's version and the version inside its snapshot are written by one statement, so a
    disagreement means the two came from different publications — a half-applied write, or a
    hand-edited row. Both halves are individually well-formed, which is exactly why the check has to
    be against the row rather than inside the snapshot.
  */
  const skewed = await publishOne(teacher.token, "custom", { title: "A programme whose versions disagree" });
  sql(`update learning_programs set version = 7 where id = ${skewed}`);
  check("a snapshot whose version disagrees with its row is not served",
    (await api(`/programs/${skewed}`)).status === 404);
  check("and is not listed", !(await api("/programs?limit=50")).body.programs.some((p) => p.id === skewed));
  sql(`update learning_programs set version = 1 where id = ${skewed}`);
  check("and it comes back once they agree again", (await api(`/programs/${skewed}`)).status === 200);

  /*
    A page of results is not cut short by one bad row.

    The cursor is taken from the last row read rather than the last program rendered, so an
    unreadable snapshot costs the page one entry and never stops the paging on it.
  */
  const good1 = await publishOne(teacher.token, "custom", { title: "Readable programme one" });
  const bad = await publishOne(teacher.token, "custom", { title: "Programme that will be broken" });
  const good2 = await publishOne(teacher.token, "custom", { title: "Readable programme two" });
  sql(`update learning_programs set published_snapshot = published_snapshot - 'outcome' where id = ${bad}`);
  const page = await api("/programs?limit=50");
  const ids = page.body.programs.map((p) => p.id);
  check("the readable programs on the same page are still there",
    ids.includes(good1) && ids.includes(good2) && !ids.includes(bad),
    JSON.stringify(ids).slice(0, 100));
}

/* ------------------------------------------------------------------------- */
/* 14. Ordering says what the query does                                      */
/* ------------------------------------------------------------------------- */

async function ordering() {
  console.log("\n[14] Newest published first, and the cursor follows the same order");
  const teacher = await register("teacher");

  const first = await publishOne(teacher.token, "custom", { title: "Published first of the three" });
  const second = await publishOne(teacher.token, "custom", { title: "Published second of the three" });
  const third = await publishOne(teacher.token, "custom", { title: "Published third of the three" });

  const before = (await api("/programs?limit=50")).body.programs.map((p) => p.id);
  check("the newest publication is first",
    before.indexOf(third) < before.indexOf(second) && before.indexOf(second) < before.indexOf(first),
    JSON.stringify(before.slice(0, 6)));

  /*
    The case where ordering by id and ordering by publication time disagree.

    Republishing the *oldest* program makes it the newest publication. Under a `desc(id)` ordering
    it stays last, which is what the description called "newest-published first" while doing
    something else — Codex's first smaller correction.
  */
  await api(`/learning-programs/${first}`, { method: "PATCH", token: teacher.token, body: { summary: "A revised summary, long enough to satisfy the contract." } });
  const again = await api(`/learning-programs/${first}/publish`, { method: "POST", token: teacher.token });
  check("the oldest program can be republished", again.status === 200, `status ${again.status}`);

  const after = (await api("/programs?limit=50")).body.programs.map((p) => p.id);
  check("republishing it moves it to the front",
    after.indexOf(first) < after.indexOf(third), `${JSON.stringify(after.slice(0, 6))}`);

  // And the cursor walks that same order without repeating or skipping.
  const seen = [];
  let cursor = null;
  for (let page = 0; page < 8; page += 1) {
    const res = await api(`/programs?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (res.status !== 200) { check("paging stayed valid", false, `status ${res.status}`); break; }
    seen.push(...res.body.programs.map((p) => p.id));
    cursor = res.body.nextCursor;
    if (!cursor) break;
  }
  check("paging never returns the same program twice", new Set(seen).size === seen.length,
    JSON.stringify(seen).slice(0, 120));
  check("and it reaches every one of them",
    [first, second, third].every((id) => seen.includes(id)), JSON.stringify(seen).slice(0, 120));
}

/* ------------------------------------------------------------------------- */
/* 14b. Public search                                                         */
/* ------------------------------------------------------------------------- */

/**
 * The one filter that reads text: `?q=…`.
 *
 * Every input goes through a bound parameter — so this is a search test, not a SQL-injection
 * safety-net. What it exercises is that the fields a student would recognise are actually the ones
 * matched, that the escape for `%` and `_` behaves, that the query is bounded rather than
 * unbounded, that pagination stays deterministic under a search, that filter and search compose,
 * and that no unpublished or suspended row can be surfaced by any wording.
 */
async function publicSearch() {
  console.log("\n[14b] Public search only reaches what a student may see");
  const anjali = await register("teacher");
  sql(`update users set name = 'Anjali Rai' where id = ${anjali.user.id}`);
  const dipendra = await register("teacher");
  sql(`update users set name = 'Dipendra Shrestha' where id = ${dipendra.user.id}`);

  const mathsId = await publishOne(anjali.token, "school_subject", {
    title: "Grade 10 Mathematics, term by term",
    summary: "A term of Grade 10 mathematics, worked through week by week together.",
    outcome: "Students can work through a whole past paper with support.",
    intendedLearner: "Students in Grade 10 preparing for the board examination",
    referenceName: "NEB Mathematics syllabus",
  });
  const guitarId = await publishOne(dipendra.token, "practical_skill", {
    title: "Beginner guitar from the first chord",
    summary: "Six weeks of playing songs on acoustic guitar together.",
    outcome: "Play three songs from memory with clean chord changes.",
  });
  const engineeringId = await publishOne(anjali.token, "exam_preparation", {
    title: "Engineering entrance exam preparation",
    summary: "Full preparation for the engineering entrance exam.",
    outcome: "Sit the exam prepared for every kind of question it will ask.",
    referenceName: "IOE entrance",
  });

  const idsOf = (r) => (r.body?.programs ?? []).map((p) => p.id);
  const call = async (q, extra = "") => api(`/programs?limit=50&q=${encodeURIComponent(q)}${extra}`);

  check("search finds a program by title", idsOf(await call("mathematics")).includes(mathsId));
  check("and by summary", idsOf(await call("acoustic")).includes(guitarId));
  check("and by outcome", idsOf(await call("past paper")).includes(mathsId));
  check("and by intended learner", idsOf(await call("board examination")).includes(mathsId));
  check("and by teacher name", idsOf(await call("dipendra")).includes(guitarId));
  check("and by reference name", idsOf(await call("NEB")).includes(mathsId));
  check("and by the type label", idsOf(await call("practical skill")).includes(guitarId));

  // Case does not matter.
  check("search is case-insensitive", idsOf(await call("GUITAR")).includes(guitarId));

  const empty = await call("guaranteed100percent");
  check("a query nobody wrote matches nothing", empty.status === 200 && empty.body.programs.length === 0,
    `${empty.status} ${empty.body?.programs?.length}`);

  // `_` and `%` are wildcards in SQL LIKE. Escaping them means a query with those characters
  // matches literally, not as a wildcard.
  const wildcard = await call("100%");
  check("SQL wildcards typed by a student do not match everything",
    wildcard.status === 200 && wildcard.body.programs.length === 0,
    `${wildcard.status} ${wildcard.body?.programs?.length}`);
  const underscore = await call("____________not_a_real_title____________");
  check("underscore does not match every character",
    underscore.status === 200 && underscore.body.programs.length === 0);

  // Bounded input: a huge query is truncated rather than making the server work through kilobytes.
  const long = await call("m".repeat(2000));
  check("an over-long search is accepted and truncated", long.status === 200, `status ${long.status}`);

  // Filter and search compose.
  const filtered = await api(`/programs?limit=50&type=practical_skill&q=${encodeURIComponent("guitar")}`);
  check("filter and search compose",
    idsOf(filtered).includes(guitarId) && filtered.body.programs.every((p) => p.type === "practical_skill"),
    JSON.stringify(filtered.body?.programs?.map((p) => p.type)).slice(0, 80));
  const filteredOut = await api(`/programs?limit=50&type=school_subject&q=${encodeURIComponent("guitar")}`);
  check("the filter narrows the search",
    filteredOut.status === 200 && !idsOf(filteredOut).includes(guitarId),
    JSON.stringify(filteredOut.body?.programs?.map((p) => p.title)).slice(0, 80));

  // Pagination stays deterministic under a search: two overlapping pages contain the same rows
  // in the same order, and every match is reachable across pages.
  for (let i = 0; i < 3; i += 1) {
    await publishOne(anjali.token, "school_subject", {
      title: `Grade 9 Mathematics chapter ${i + 1}`,
      summary: "Working through Chapter " + (i + 1) + " of the Grade 9 syllabus.",
      outcome: "Understand the whole of the chapter.",
    });
  }
  const walked = [];
  let cursor = null;
  for (let page = 0; page < 8; page += 1) {
    const res = await api(`/programs?limit=2&q=${encodeURIComponent("mathematics")}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (res.status !== 200) { check("search paging stayed valid", false, `status ${res.status}`); break; }
    walked.push(...idsOf(res));
    cursor = res.body.nextCursor;
    if (!cursor) break;
  }
  check("search paging never repeats a program", new Set(walked).size === walked.length,
    JSON.stringify(walked).slice(0, 120));
  check("and reaches every match", walked.includes(mathsId), JSON.stringify(walked).slice(0, 120));

  // Search must not surface anything unpublished, archived, or from a suspended/unapproved teacher.
  const draftId = (await api("/learning-programs", {
    method: "POST", token: anjali.token, body: { type: "custom" },
  })).body.program.id;
  await api(`/learning-programs/${draftId}`, {
    method: "PATCH", token: anjali.token, body: { title: "Do not publish this Mathematics draft" },
  });
  const found = idsOf(await call("Do not publish this Mathematics draft"));
  check("a draft with a matching title is not surfaced by search", !found.includes(draftId), JSON.stringify(found));

  // Suspend Dipendra: the guitar program disappears from search too, not just from the list.
  sql(`update users set suspended_at = now() where id = ${dipendra.user.id}`);
  const afterSuspend = idsOf(await call("guitar"));
  check("a suspended teacher's programs are not returned by search",
    !afterSuspend.includes(guitarId), JSON.stringify(afterSuspend));
  // Restore for the next test's benefit.
  sql(`update users set suspended_at = null where id = ${dipendra.user.id}`);

  // No commercial claim ever leaks through the response.
  const sample = (await api("/programs?limit=50")).body.programs;
  for (const p of sample) {
    for (const forbidden of ["price", "priceNpr", "rating", "starRating", "reviewCount", "studentCount", "seats", "popularity"]) {
      check(`the list carries no ${forbidden} on program ${p.id}`, !(forbidden in p), Object.keys(p).join(","));
    }
  }
  // And nothing from the private snapshot fields either.
  const detail = (await api(`/programs/${mathsId}`)).body.program;
  for (const forbidden of ["issues", "hasUnpublishedChanges", "status", "archivedAt"]) {
    check(`the detail carries no ${forbidden}`, !(forbidden in detail), Object.keys(detail).join(","));
  }
}

/* ------------------------------------------------------------------------- */
/* 15. Two requests at once                                                   */
/* ------------------------------------------------------------------------- */

/**
 * Codex's second blocking finding, staged rather than raced.
 *
 * Every case below holds the program row still in a second database session, lets the request under
 * test reach the point where it blocks, commits a change from that session, and then lets the
 * request finish. That makes the interleaving a decision rather than a coin toss: the request
 * genuinely observes a world that changed after it set out, which is the whole of the finding.
 *
 * Against `58523f1` each of these fails, and fails in the way the review describes — a version
 * silently overwritten, a stale draft published over a newer save, a published program erased by a
 * delete that set out while it was still a draft, a transition applied to a state that had moved on.
 */
async function openSession() {
  const require = createRequire(path.join(repoRoot, "lib", "db", "package.json"));
  const pg = (await import(pathToFileURL(require.resolve("pg")).href)).default;
  const client = new pg.Client({ connectionString: PGURL });
  await client.connect();
  return client;
}

/**
 * Wait until the request under test is actually stuck on a lock.
 *
 * Polling `pg_stat_activity` rather than sleeping a guessed number of milliseconds: the point of
 * these tests is the ordering, and an ordering established by a timeout is an ordering that is
 * wrong on a slower machine.
 */
async function waitForBlocked(client, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await client.query(
      `select count(*)::int as waiting from pg_stat_activity
        where wait_event_type = 'Lock' and pid <> pg_backend_pid()`,
    );
    if (rows[0].waiting > 0) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

/** A valid published snapshot for a program, as the server would have written it. */
function snapshotJson(version, title, modules) {
  return {
    version,
    type: "custom",
    title,
    summary: "What this covers, who it suits, and how the weeks are spent together.",
    outcome: "Students can work through the material with support.",
    intendedLearner: "Anyone starting out",
    startingLevel: "Beginner",
    teachingLanguage: "Nepali and English",
    prerequisites: null,
    equipment: null,
    referenceName: null,
    referenceSource: "none",
    modules: modules.map((m, position) => ({
      position, title: m.title, outcome: m.outcome, description: null, practicePrompt: null,
    })),
  };
}

async function concurrency() {
  console.log("\n[15] Two requests at once, with the interleaving decided rather than raced");
  const teacher = await register("teacher");
  const client = await openSession();

  try {
    /* --- publish crossing another publication --------------------------- */
    {
      const id = await publishOne(teacher.token, "custom", { title: "A programme published twice at once" });
      check("it starts at version 1", Number(sql(`select version from learning_programs where id = ${id}`)) === 1);

      await client.query("BEGIN");
      await client.query("select id from learning_programs where id = $1 for update", [id]);
      const inFlight = api(`/learning-programs/${id}/publish`, { method: "POST", token: teacher.token });
      check("the second publish waits for the first", await waitForBlocked(client));

      // The other publication commits while this one is held.
      await client.query(
        `update learning_programs set version = 2, published_at = now(), published_snapshot = $2 where id = $1`,
        [id, JSON.stringify(snapshotJson(2, "A programme published twice at once", MODULES))],
      );
      await client.query("COMMIT");

      const res = await inFlight;
      check("the held publish still succeeds", res.status === 200, `status ${res.status}`);
      const version = Number(sql(`select version from learning_programs where id = ${id}`));
      check("and it is version 3, so the other publication was not silently overwritten",
        version === 3, `version ${version}`);
      check("the row and its snapshot agree about the version",
        Number(sql(`select (published_snapshot->>'version')::int from learning_programs where id = ${id}`)) === version);
      check("and the public page can still be read", (await api(`/programs/${id}`)).status === 200);
    }

    /* --- publish crossing a save ---------------------------------------- */
    {
      const made = await api("/learning-programs", { method: "POST", token: teacher.token, body: { type: "custom" } });
      const id = made.body.program.id;
      await api(`/learning-programs/${id}`, { method: "PATCH", token: teacher.token, body: complete({ title: "The draft before the save" }) });

      await client.query("BEGIN");
      await client.query("select id from learning_programs where id = $1 for update", [id]);
      await client.query("select id from learning_program_modules where program_id = $1 for update", [id]);
      const inFlight = api(`/learning-programs/${id}/publish`, { method: "POST", token: teacher.token });
      check("the publish waits for the save", await waitForBlocked(client));

      // A complete save commits: a new title *and* a third step, as one draft.
      await client.query("update learning_programs set title = $2 where id = $1", [id, "The draft after the save"]);
      await client.query("delete from learning_program_modules where program_id = $1", [id]);
      await client.query(
        `insert into learning_program_modules (program_id, position, title, outcome)
         values ($1,0,'One','A first outcome long enough to be accepted.'),
                ($1,1,'Two','A second outcome long enough to be accepted.'),
                ($1,2,'Three','A third outcome long enough to be accepted.')`,
        [id],
      );
      await client.query("COMMIT");

      const res = await inFlight;
      check("the publish succeeds", res.status === 200, `status ${res.status}`);

      const published = await api(`/programs/${id}`);
      const title = published.body?.program?.title;
      const steps = published.body?.program?.modules?.length;
      /*
        One whole draft, and the one that was current when the publication took effect.

        The old code read the row before the save and the modules after it, so the snapshot could
        carry one draft's title and another draft's steps. It also published a draft that no longer
        existed, which is the same defect seen from the student's side.
      */
      check("what was published is one complete draft, not two halves",
        title === "The draft after the save" && steps === 3, `title=${title} steps=${steps}`);
      const storedTitle = sql(`select title from learning_programs where id = ${id}`);
      const storedSteps = Number(sql(`select count(*) from learning_program_modules where program_id = ${id}`));
      check("and it is the draft the database now holds", title === storedTitle && steps === storedSteps,
        `snapshot(${title}, ${steps}) vs stored(${storedTitle}, ${storedSteps})`);
    }

    /* --- delete crossing a publication ---------------------------------- */
    {
      const made = await api("/learning-programs", { method: "POST", token: teacher.token, body: { type: "custom" } });
      const id = made.body.program.id;
      await api(`/learning-programs/${id}`, { method: "PATCH", token: teacher.token, body: complete({ title: "A draft about to be published" }) });

      await client.query("BEGIN");
      await client.query("select id from learning_programs where id = $1 for update", [id]);
      const inFlight = api(`/learning-programs/${id}`, { method: "DELETE", token: teacher.token });
      check("the delete waits", await waitForBlocked(client));

      await client.query(
        `update learning_programs
            set status = 'published', version = 1, published_at = now(), published_snapshot = $2
          where id = $1`,
        [id, JSON.stringify(snapshotJson(1, "A draft about to be published", MODULES))],
      );
      await client.query("COMMIT");

      const res = await inFlight;
      check("a delete that set out while it was a draft is refused once it is published",
        res.status === 409 && res.body.code === "not-draft", `${res.status} ${res.body?.code}`);
      check("and the newly published program survives",
        Number(sql(`select count(*) from learning_programs where id = ${id}`)) === 1);
      check("with its snapshot, which is the only record of what was promised",
        (await api(`/programs/${id}`)).status === 200);
    }

    /* --- a transition crossing another transition ------------------------ */
    {
      const id = await publishOne(teacher.token, "custom", { title: "A programme taken down and away at once" });

      await client.query("BEGIN");
      await client.query("select id from learning_programs where id = $1 for update", [id]);
      const inFlight = api(`/learning-programs/${id}/unpublish`, { method: "POST", token: teacher.token });
      check("the unpublish waits", await waitForBlocked(client));
      await client.query("update learning_programs set status = 'archived', archived_at = now() where id = $1", [id]);
      await client.query("COMMIT");

      const res = await inFlight;
      check("taking down a program that has since been archived is an honest conflict",
        res.status === 409 && res.body.code === "not-published", `${res.status} ${res.body?.code}`);
      check("and the archive stands", sql(`select status from learning_programs where id = ${id}`) === "archived");
    }

    {
      const id = await publishOne(teacher.token, "custom", { title: "A programme restored while it moved" });
      await api(`/learning-programs/${id}/archive`, { method: "POST", token: teacher.token });

      await client.query("BEGIN");
      await client.query("select id from learning_programs where id = $1 for update", [id]);
      const inFlight = api(`/learning-programs/${id}/restore`, { method: "POST", token: teacher.token });
      check("the restore waits", await waitForBlocked(client));
      await client.query("update learning_programs set status = 'draft', archived_at = null where id = $1", [id]);
      await client.query("COMMIT");

      const res = await inFlight;
      check("restoring something that is no longer archived is an honest conflict",
        res.status === 409 && res.body.code === "not-archived", `${res.status} ${res.body?.code}`);
      check("and it is left as the draft it now is",
        sql(`select status from learning_programs where id = ${id}`) === "draft");
    }

    /* --- and the same properties under a genuine race -------------------- */
    {
      /*
        Not a substitute for the staged cases above — a race that happens to interleave proves
        nothing when it does not. It is here because the staged cases each fix one ordering, and
        this asks the same questions of whatever ordering the machine actually produces.
      */
      const id = await publishOne(teacher.token, "custom", { title: "A programme published from two tabs" });
      const before = Number(sql(`select version from learning_programs where id = ${id}`));
      const rounds = 5;
      for (let round = 0; round < rounds; round += 1) {
        const [a, b] = await Promise.all([
          api(`/learning-programs/${id}/publish`, { method: "POST", token: teacher.token }),
          api(`/learning-programs/${id}/publish`, { method: "POST", token: teacher.token }),
        ]);
        if (a.status !== 200 || b.status !== 200) {
          check("both simultaneous publishes are answered", false, `${a.status} / ${b.status}`);
          break;
        }
      }
      const after = Number(sql(`select version from learning_programs where id = ${id}`));
      check("every simultaneous publication counted",
        after === before + rounds * 2, `${before} -> ${after}, expected ${before + rounds * 2}`);
      check("the row and its snapshot still agree",
        Number(sql(`select (published_snapshot->>'version')::int from learning_programs where id = ${id}`)) === after);
      check("and the public page is readable throughout", (await api(`/programs/${id}`)).status === 200);
    }
  } finally {
    try { await client.query("ROLLBACK"); } catch { /* already committed */ }
    await client.end();
  }
}

/* ------------------------------------------------------------------------- */
/* 16. Moderation reads the draft as it now stands                            */
/* ------------------------------------------------------------------------- */

async function moderationReload() {
  console.log("\n[16] A partial save moderates the whole stored draft, not the part that was sent");
  const teacher = await register("teacher");
  const id = (await api("/learning-programs", { method: "POST", token: teacher.token, body: { type: "custom" } })).body.program.id;

  const flagged = "fuck";
  await api(`/learning-programs/${id}`, { method: "PATCH", token: teacher.token, body: complete({
    modules: [
      { title: "An ordinary step", outcome: "An outcome long enough to be accepted." },
      { title: "A step that says something", outcome: `Practise saying ${flagged} out loud.` },
    ],
  }) });
  // The response is deliberately sent before the non-blocking moderation write finishes.
  // Observe that eventual side effect with a bound instead of racing the server process.
  const first = await eventuallySqlNumber(
    `select count(*) from moderation_flags where surface = 'learning_program' and subject_id = ${id}`,
    (value) => value > 0,
  );
  check("a step's own words are read when the steps are sent", first > 0, String(first));

  /*
    Codex's third smaller correction.

    Moderation used to be handed the modules *from the request*, which is an empty array whenever a
    request did not carry any — so a teacher fixing one word in their title had their whole learning
    path read as blank, and a flagged step already saved was never looked at again.
  */
  const before = Number(sql(`select count(*) from moderation_flags where surface = 'learning_program' and subject_id = ${id}`));
  const patch = await api(`/learning-programs/${id}`, { method: "PATCH", token: teacher.token, body: { title: "A title changed on its own" } });
  check("a title-only save succeeds", patch.status === 200, `status ${patch.status}`);
  const after = Number(sql(`select count(*) from moderation_flags where surface = 'learning_program' and subject_id = ${id}`));
  check("and the stored steps are read again rather than an empty list", after > before, `${before} -> ${after}`);
  const excerpt = sql(`select excerpt from moderation_flags where subject_id = ${id} order by id desc limit 1`);
  check("the excerpt describes the saved draft, including its steps",
    excerpt.includes("A title changed on its own") && excerpt.includes(flagged), excerpt.slice(0, 120));
  check("the teacher is still not blocked by it", patch.body.program.status === "draft", patch.body?.program?.status);
}

/* ------------------------------------------------------------------------- */
/* 12. Nothing else moved                                                     */
/* ------------------------------------------------------------------------- */

/**
 * The tables this feature must not have touched, before and after everything above.
 *
 * Phase 1 is additive by design: two new tables, no column anywhere else, no booking, no
 * enrolment, no recurring row. Asserting it here rather than trusting the diff is worth the six
 * lines — a route that quietly wrote an enrolment would be the single worst thing this change
 * could do, and it would look like nothing in a code review of a file about programs.
 */
async function nothingElseMoved(before) {
  console.log("\n[12] Booking, enrolment and the monthly tables are untouched");
  for (const [table, was] of Object.entries(before)) {
    const now = Number(sql(`select count(*) from ${table}`));
    check(`${table} has the same number of rows as when this suite started`, now === was, `${was} -> ${now}`);
  }
}

/* ------------------------------------------------------------------------- */

async function main() {
  const server = spawn(process.execPath, [path.join(serverRoot, "dist", "index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(API_PORT),
      DATABASE_URL: PGURL,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "learning-program-test-secret",
    },
    stdio: "ignore",
  });
  const stop = () => { try { server.kill("SIGKILL"); } catch { /* gone */ } };
  process.on("exit", stop);

  let up = false;
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(`${API}/api/healthz`)).ok) { up = true; break; } } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!up) { console.error("the API never came up"); stop(); process.exit(1); }

  console.log("\nLearning Programs, against a real API and a real database\n");

  const watched = {};
  for (const table of [
    "sessions", "session_enrollments", "recurring_sessions", "recurring_days",
    "recurring_enrollments", "teacher_plans", "refunds",
  ]) {
    watched[table] = Number(sql(`select count(*) from ${table}`));
  }

  try {
    await programTypes();
    const published = await publishing();
    await immutability(published);
    const who = await ownership();
    await publicReads(who);
    await moduleOrder();
    await paging();
    await profileProgramsAndFollowers();
    await unauthenticated();
    await lifecycle();
    await moderation();
    await corruptSnapshots();
    await ordering();
    await publicSearch();
    await concurrency();
    await moderationReload();
    await batchPublication();
    await tuitionPeriods();
    await simpleClasses();
    await schemaParity();
    await nothingElseMoved(watched);
    await scheduleConflicts();
    await billingTransition();
  } catch (err) {
    console.error(err);
    failed += 1;
    failures.push(`threw: ${err.message}`);
  }

  stop();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

async function batchPublication() {
  console.log("\n[Batch publication] No-op, concurrent requests, immutable offers and parent revisions");
  const teacher = await register("teacher");
  const other = await register("teacher");
  const programId = await publishOne(teacher.token, "custom");
  const made = await api(`/learning-programs/${programId}/batches`, { method: "POST", token: teacher.token, body: {} });
  check("batch created as unpublished draft", made.status === 201 && made.body.batch.version === 0);
  const id = made.body.batch.id;
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const input = { capacity: 6, totalTuitionNpr: 3000, lessons: [{ date, time: "16:30", durationMinutes: 60 }] };
  const patch = (body) => api(`/learning-program-batches/${id}`, { method: "PATCH", token: teacher.token, body });
  const publish = () => api(`/learning-program-batches/${id}/publish`, { method: "POST", token: teacher.token, body: {} });
  check("other teacher cannot edit batch", (await api(`/learning-program-batches/${id}`, { method: "PATCH", token: other.token, body: input })).status === 404);
  check("batch draft saved", (await patch(input)).status === 200);
  const first = await publish();
  check("first publication creates version one", first.status === 200 && first.body.batch.version === 1);
  const repeated = await Promise.all(Array.from({ length: 8 }, publish));
  check("eight concurrent duplicates are all successful no-ops", repeated.every((reply) => reply.status === 200 && reply.body.unchanged === true && reply.body.batch.version === 1));
  check("duplicates preserve publication time and complete snapshot", repeated.every((reply) => reply.body.batch.publishedAt === first.body.batch.publishedAt && JSON.stringify(reply.body.batch.published) === JSON.stringify(first.body.batch.published)));
  const changed = await patch({ ...input, totalTuitionNpr: 4200 });
  check("saving changed draft preserves old public price", changed.status === 200 && changed.body.batch.published.totalTuitionNpr === 3000);
  const updated = await Promise.all([publish(), publish()]);
  check("changed draft publishes exactly one additional version", updated.every((reply) => reply.status === 200 && reply.body.batch.version === 2 && reply.body.batch.published.totalTuitionNpr === 4200) && updated.filter((reply) => reply.body.unchanged === false).length === 1);
  await api(`/learning-programs/${programId}`, { method: "PATCH", token: teacher.token, body: complete({ title: "Updated course title for the next run" }) });
  const parent = await api(`/learning-programs/${programId}/publish`, { method: "POST", token: teacher.token });
  const refreshed = await publish();
  check("new parent publication is not mistaken for an unchanged Batch", refreshed.status === 200 && refreshed.body.batch.version === 3 && refreshed.body.batch.currentProgramVersion === parent.body.program.version && refreshed.body.batch.published.programTitle === "Updated course title for the next run");
  const closed = await api(`/learning-program-batches/${id}/close`, { method: "POST", token: teacher.token });
  check("closed Batch remains closed under an edit attempt", closed.status === 200 && (await patch(input)).status === 409);
  check("closed Batch cannot be republished", (await publish()).status === 409);
}

async function tuitionPeriods() {
  console.log("\n[Tuition periods] Shared anchor, advance cutoff, repeated next-period requests and unchanged old contracts");
  const teacher = await register("teacher"), other = await register("teacher"), student = await register("student");
  const program = await publishOne(teacher.token, "custom");
  const start = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const offsetDay = (n) => new Date(Date.parse(`${start}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const make = (format, token = teacher.token) => api(`/learning-programs/${program}/batches`, { method: "POST", token, body: { format } });
  const patch = (id, days, price = 3000) => api(`/learning-program-batches/${id}`, { method: "PATCH", token: teacher.token, body: { capacity: 6, totalTuitionNpr: price, lessons: days.map((day) => ({ date: offsetDay(day), time: "16:00", durationMinutes: 60 })), tuitionPeriod: { groupId: 99, index: 99 } } });
  const publish = (id) => api(`/learning-program-batches/${id}/publish`, { method: "POST", token: teacher.token });
  const next = (id, token = teacher.token) => api(`/learning-program-batches/${id}/next-period`, { method: "POST", token });
  const made = await make("ongoing");
  check("ongoing draft creates a distinct stable group without dates", made.status === 201 && made.body.batch.format === "ongoing" && made.body.batch.tuitionGroupId > 0 && made.body.batch.tuitionPeriod === null);
  const id = made.body.batch.id;
  check("unknown format refused", (await make("monthly_credit")).status === 422);
  check("students cannot create groups", (await make("ongoing", student.token)).status === 403);
  check("another teacher cannot prepare or read this group's next period", (await next(id, other.token)).status === 404);
  check("unpublished period cannot produce a renewal draft", (await next(id)).status === 409);
  await patch(id, [0, 30]);
  check("lesson at exclusive boundary cannot publish", (await publish(id)).status === 422);
  check("failed publication does not freeze anchor", sql(`select anchor_at is null from learning_program_tuition_groups where id=${made.body.batch.tuitionGroupId}`) === "t");
  await patch(id, [0, 7, 14, 21, 28]);
  const first = await publish(id);
  check("five weekly lessons publish as one 30-day period", first.status === 200 && first.body.batch.published.lessons.length === 5 && first.body.batch.periodAnchorLocked);
  const p = first.body.batch.published.tuitionPeriod;
  check("server ignores client group and index; derives thirty days", p.index === 0 && p.groupId === made.body.batch.tuitionGroupId && Date.parse(p.endsAt) - Date.parse(p.startsAt) === 30 * 86400000);
  check("public snapshot exposes advance payment boundary", (await api(`/programs/${program}/batches`)).body.batches[0].enrollmentClosesAt === p.startsAt);
  check("unchanged ongoing publish is a no-op", (await publish(id)).body.unchanged === true);
  // A draft is not a new published price, and preparation must not silently use it.
  await patch(id, [1, 7, 14], 4000);
  const requests = await Promise.all(Array.from({ length: 8 }, () => next(id)));
  check("eight concurrent preparations create exactly one next draft", requests.filter((r) => r.status === 201).length === 1 && requests.every((r) => [200, 201].includes(r.status)) && new Set(requests.map((r) => r.body.batch.id)).size === 1);
  const second = requests[0].body.batch;
  check("same group, exact boundary, no copied lessons or unpublished price", second.tuitionGroupId === p.groupId && second.tuitionPeriod.index === 1 && second.tuitionPeriod.startsAt === p.endsAt && second.lessons.length === 0 && second.totalTuitionNpr === 3000 && second.status === "draft");
  await patch(second.id, [29]);
  check("next period rejects dates before its start", (await publish(second.id)).status === 422);
  await patch(second.id, [31, 38]);
  const secondPublished = await publish(second.id);
  check("next period may start teaching later without moving payment cutoff", secondPublished.status === 200 && secondPublished.body.batch.published.enrollmentClosesAt === p.endsAt);
  const firstAgain = await publish(id);
  check("changing first lesson later never moves frozen group anchor", firstAgain.status === 200 && firstAgain.body.batch.tuitionPeriod.startsAt === p.startsAt);
  check("periods never create enrolments", sql(`select count(*) from learning_program_enrollments where program_id=${program}`) === "0");
  const fixed = await make("fixed");
  check("fixed courses have no tuition group", fixed.body.batch.format === "fixed" && fixed.body.batch.tuitionGroupId === null);
  check("fixed course cannot prepare ongoing renewal", (await next(fixed.body.batch.id)).status === 409);
  await api(`/learning-program-batches/${second.id}/close`, { method: "POST", token: teacher.token });
  check("closing a period does not cause a duplicate replacement", (await next(id)).body.batch.id === second.id);
  check("closed period cannot create a successor", (await next(second.id)).status === 409);
}

async function scheduleConflicts() {
  console.log("\n[Teacher schedule] Cross-product conflicts, drafts, snapshots and concurrent writers");
  const teacher = await register("teacher"), other = await register("teacher");
  const tid = teacher.user.id;
  const program = await publishOne(teacher.token, "custom");
  const another = await publishOne(teacher.token, "custom");
  const otherProgram = await publishOne(other.token, "custom");
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const at = (time) => `${date}T${time}:00+05:45`;
  const input = (time, durationMinutes = 60) => ({ capacity: 6, totalTuitionNpr: 3000, lessons: [{ date, time, durationMinutes }] });
  const patch = (id, value, token = teacher.token) => api(`/learning-program-batches/${id}`, { method: "PATCH", token, body: value });
  const publish = (id, token = teacher.token) => api(`/learning-program-batches/${id}/publish`, { method: "POST", token, body: {} });
  const close = (id) => api(`/learning-program-batches/${id}/close`, { method: "POST", token: teacher.token });
  const create = async (p = program, token = teacher.token) => {
    const result = await api(`/learning-programs/${p}/batches`, { method: "POST", token, body: {} });
    assertStatus(result, 201, "create batch fixture");
    return result.body.batch.id;
  };
  const createClass = (time, token = teacher.token) => api("/sessions", { method: "POST", token, body: { subject: "Guitar", topic: "Schedule test class", date: at(time), duration: 60, maxStudents: 10, price: 500 } });
  function assertStatus(result, expected, context) { if (result.status !== expected) throw new Error(`${context}: ${result.status} ${JSON.stringify(result.body)}`); }
  try {
    const a = await create(), b = await create(another);
    let saved = await patch(a, { ...input("17:00"), lessons: [...input("17:00").lessons, ...input("17:30", 30).lessons] });
    check("overlapping draft saves and names both lessons", saved.status === 200 && /Lesson 2.*Lesson 1/.test(saved.body.batch.scheduleIssues.join(" ")));
    check("internal overlap supplies both editable lesson positions", saved.body.batch.scheduleConflicts[0]?.lessonIndex === 1 && saved.body.batch.scheduleConflicts[0]?.otherLessonIndex === 0);
    let refused = await publish(a);
    check("duration overlap within Batch blocks publication", refused.status === 409 && refused.body.issues.length > 0);
    check("refused publication writes no version or snapshot", sql(`select version || ':' || status || ':' || (published_snapshot is null)::text from learning_program_batches where id=${a}`) === "0:draft:true");
    saved = await patch(a, { ...input("17:00"), lessons: [...input("17:00").lessons, ...input("17:00").lessons] });
    check("identical starts can be saved but cannot be published", saved.status === 200 && (await publish(a)).status === 409);
    await patch(a, input("17:00"));
    await patch(b, input("17:30"));
    const race = await Promise.all([publish(a), publish(b)]);
    check("cross-Program simultaneous overlapping publications permit exactly one", race.filter((r) => r.status === 200).length === 1 && race.filter((r) => r.status === 409).length === 1);
    const winner = race[0].status === 200 ? a : b, loser = winner === a ? b : a;
    const oldTime = winner === a ? "17:00" : "17:30";
    const otherBatch = await create(otherProgram, other.token);
    await patch(otherBatch, input("17:30"), other.token);
    check("different teachers may teach concurrently", (await publish(otherBatch, other.token)).status === 200);
    saved = await patch(winner, input("12:00"));
    check("saved replacement keeps previous published time reserved", saved.status === 200 && saved.body.batch.published.lessons[0].startsAt === new Date(at(oldTime)).toISOString());
    const crossReview = await patch(loser, input("17:45", 30));
    check("other published schedule has a structured safe edit target", crossReview.body.batch.scheduleConflicts[0]?.source?.id === winner && crossReview.body.batch.scheduleConflicts[0]?.source?.locked === null);
    check("draft time does not erase original published reservation", (await publish(loser)).status === 409);
    check("ordinary class cannot be created over a published Batch", (await createClass("17:45")).status === 409);
    await patch(loser, input("12:00"));
    check("unpublished replacement does not reserve its draft time", (await publish(loser)).status === 200);
    await close(winner); await close(loser);
    const ordinary = await createClass("17:00");
    assertStatus(ordinary, 201, "ordinary class fixture");
    const classId = ordinary.body.session?.id ?? ordinary.body.id;
    const c = await create();
    let ordinaryConflict = await patch(c, input("17:30"));
    check("legacy class does not invent edit safety", ordinaryConflict.body.batch.scheduleConflicts[0]?.source?.kind === "session" && ordinaryConflict.body.batch.scheduleConflicts[0]?.source?.locked === "review");
    const paidFixture = await register("student");
    sql(`insert into session_enrollments (session_id,student_id,payment_status,payment_reference) values (${classId},${paidFixture.user.id},'paid','synthetic-conflict-test-only')`);
    ordinaryConflict = await patch(c, input("17:30"));
    check("paid existing class cannot be offered as editable conflict target", ordinaryConflict.body.batch.scheduleConflicts[0]?.source?.locked === "paid");
    check("Batch cannot cover an ordinary class", (await publish(c)).status === 409);
    await patch(c, input("18:00"));
    check("back-to-back Batch starts when ordinary class ends", (await publish(c)).status === 200);
    check("duration-only edit cannot grow into Batch", (await api(`/sessions/${classId}`, { method: "PATCH", token: teacher.token, body: { duration: 90 } })).status === 409);
    check("rejected extension leaves duration unchanged", Number(sql(`select duration from sessions where id=${classId}`)) === 60);
    check("reschedule cannot move into Batch", (await api(`/sessions/${classId}`, { method: "PATCH", token: teacher.token, body: { date: at("18:15") } })).status === 409);
    await close(c);
    const d = await create(); await patch(d, input("20:00"));
    const mixedRace = await Promise.all([publish(d), createClass("20:00")]);
    check("Batch versus Single Class race commits exactly one", mixedRace.filter((r) => r.status === 200 || r.status === 201).length === 1 && mixedRace.filter((r) => r.status === 409).length === 1);
    await close(d);
    sql(`delete from sessions where teacher_id=${tid}`);
    const plan = Number(sql(`insert into teacher_plans (teacher_id,price,cycle_anchor) values (${tid},1000,now()) returning id` ).split("\n")[0]);
    const futureBatch = await create(); await patch(futureBatch, input("16:00")); await publish(futureBatch);
    const monthly = (minute) => api("/monthly/classes", { method: "POST", token: teacher.token, body: { subject: "Guitar", topic: "Daily guitar", startMinute: minute, durationMinutes: 60, monthlyPrice: 1000, maxStudents: 10, timeZone: "Asia/Kathmandu" } });
    const refusedMonthly = await monthly(16 * 60 + 30);
    check("new Monthly timetable cannot overlap a Batch", refusedMonthly.status === 409, JSON.stringify(refusedMonthly.body));
    check("refused Monthly creation is atomic", Number(sql(`select count(*) from recurring_sessions where teacher_id=${tid}`)) === 0);
    await close(futureBatch);
    // Explicit DB fixtures: cover a repeating timetable beyond its generated cycle and a make-up.
    const course = Number(sql(`insert into recurring_sessions (plan_id,teacher_id,subject,topic,start_minute,duration_minutes,monthly_price) values (${plan},${tid},'Guitar','Daily guitar',960,60,1000) returning id`).split("\n")[0]);
    const farDate = new Date(Date.now() + 100 * 86400000).toISOString().slice(0, 10);
    const e = await create();
    await patch(e, { ...input("16:30"), lessons: [{ date: farDate, time: "16:30", durationMinutes: 30 }] });
    check("ungenerated future Monthly recurrence still reserves its time", (await publish(e)).status === 409);
    sql(`insert into recurring_days (recurring_id,cycle_index,kind,scheduled_for,status) values (${course},0,'makeup','${at("19:00")}','planned')`);
    await patch(e, input("19:15", 30));
    check("Monthly make-up also blocks Batch publication", (await publish(e)).status === 409);
    sql(`update recurring_days set status='cancelled' where recurring_id=${course}`);
    check("cancelled make-up releases its time", (await publish(e)).status === 200);
    // Create a missed day for the actual make-up endpoint, respecting the active cycle.
    const missed = Number(sql(`insert into recurring_days (recurring_id,cycle_index,kind,scheduled_for,status) values (${course},0,'regular',now() - interval '1 hour','missed') returning id`).split("\n")[0]);
    const makeup = await api(`/monthly/classes/${course}/makeups`, { method: "POST", token: teacher.token, body: { missedDayId: missed, at: at("19:20") } });
    check("new make-up cannot overlap a published Batch", makeup.status === 409, JSON.stringify(makeup.body));
    const moveMonthly = await api(`/monthly/classes/${course}/time`, { method: "PATCH", token: teacher.token, body: { startMinute: 19 * 60 + 15 } });
    check("changed Monthly timetable cannot overlap Batch", moveMonthly.status === 409 && /overlap/.test(moveMonthly.body.error), JSON.stringify(moveMonthly.body));
    check("failed Monthly move keeps its original start", Number(sql(`select start_minute from recurring_sessions where id=${course}`)) === 960);
    const cancelled = await createClass("10:00");
    assertStatus(cancelled, 201, "cancellation fixture");
    const cancelledId = cancelled.body.session?.id ?? cancelled.body.id;
    sql(`update sessions set status='cancelled' where id=${cancelledId}`);
    const f = await create(); await patch(f, input("10:00"));
    check("cancelled ordinary classes release their time", (await publish(f)).status === 200);
    const resurrect = await api(`/sessions/${cancelledId}`, { method: "PATCH", token: teacher.token, body: { status: "upcoming" } });
    check("reactivating a cancelled class cannot bypass conflict protection", resurrect.status === 409);
  } finally {
    // Only synthetic fixtures created here, never existing or production rows.
    sql(`delete from recurring_days where recurring_id in (select id from recurring_sessions where teacher_id=${tid}); delete from recurring_sessions where teacher_id=${tid}; delete from teacher_plans where teacher_id=${tid}; delete from sessions where teacher_id=${tid}`);
  }
}

async function simpleClasses() {
  console.log("\n[Simple classes] One teacher action, atomic draft/publication, unchanged safeguards");
  const teacher = await register("teacher"), other = await register("teacher"), student = await register("student"), pending = await register("teacher", { approved: false });
  const day = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const body = { requestKey: `simple-class-${Date.now()}`, format: "ongoing", title: "SEE Maths evening tuition", summary: "We solve school exercises together and make time for questions.", teachingLanguage: "Nepali", outline: "", capacity: 6, totalTuitionNpr: 3000, lessons: [{ date: day, time: "15:00", durationMinutes: 60 }] };
  const create = (payload = body, token = teacher.token) => api("/teaching-classes", { method: "POST", token, body: payload });
  const read = (id, token = teacher.token) => api(`/teaching-classes/${id}`, { token });
  const versions = (item) => ({ expectedUpdatedAt: item.batch.updatedAt, expectedProgramUpdatedAt: item.programUpdatedAt });
  const publish = (item, token = teacher.token) => api(`/teaching-classes/${item.batch.id}/publish`, { method: "POST", token, body: versions(item) });
  const save = (item, patch = {}) => api(`/teaching-classes/${item.batch.id}`, { method: "PATCH", token: teacher.token, body: { ...body, ...versions(item), ...patch } });
  check("student cannot create a teaching class", (await create(body, student.token)).status === 403);
  const before = sql("select count(*) from learning_programs");
  check("bad description rejected", (await create({ ...body, title: "a" })).status === 422);
  check("invalid date rejected", (await create({ ...body, lessons: [{ date: "nonsense", time: "15:00", durationMinutes: 60 }] })).status === 422);
  check("fixed course cannot enable late joining", (await create({ ...body, format: "fixed", allowLateJoining: true })).status === 422);
  check("late joining requires an actual boolean", (await create({ ...body, allowLateJoining: "true" })).status === 422);
  check("invalid requests create no parent behind the scenes", sql("select count(*) from learning_programs") === before);
  const attempts = await Promise.all([create(), create()]);
  check("concurrent first-save retries create one class", attempts.every((r) => [200, 201].includes(r.status)) && attempts[0].body.item.batch.id === attempts[1].body.item.batch.id);
  let item = attempts[0].body.item;
  const id = item.batch.id, pid = item.batch.programId;
  check("one saved draft contains description, dates, price and stable tuition group", item.title === body.title && item.batch.lessons.length === 1 && item.batch.capacity === 6 && item.batch.format === "ongoing" && item.batch.tuitionGroupId > 0);
  check("existing class defaults to late joining off", item.batch.allowLateJoining === false);
  check("no invented modules", sql(`select count(*) from learning_program_modules where program_id=${pid}`) === "0");
  check("only one idempotency mapping exists", sql(`select count(*) from teaching_class_setups where program_id=${pid}`) === "1");
  check("older Programs list does not lead simple classes into the wrong editor", !(await api("/learning-programs", { token: teacher.token })).body.programs.some((p) => p.id === pid));
  check("older Program editor cannot rewrite a simple class", (await api(`/learning-programs/${pid}`, { method: "PATCH", token: teacher.token, body: complete() })).status === 409);
  check("draft hidden from public", (await api(`/programs/${pid}`)).status === 404);
  check("another teacher cannot read class", (await read(id, other.token)).status === 404);
  check("student cannot list teacher's classes", (await api("/teaching-classes", { token: student.token })).status === 403);
  check("invalid id is not a server error", (await read("Infinity")).status === 404);
  check("forged owner publication refused", (await publish(item, other.token)).status === 404);
  check("stale publication refused", (await api(`/teaching-classes/${id}/publish`, { method: "POST", token: teacher.token, body: {} })).status === 409);
  let response = await publish(item);
  check("one publication publishes description AND offer", response.status === 200 && response.body.item.batch.status === "published", JSON.stringify(response.body));
  item = response.body.item;
  const publicRead = await api(`/programs/${pid}`);
  check("simple snapshot served without required formal learning path", publicRead.status === 200 && publicRead.body.program.presentation === "class" && publicRead.body.program.modules.length === 0, JSON.stringify(publicRead.body));
  check("course catalog does not duplicate a simple class", !(await api("/programs?presentation=program&limit=50")).body.programs.some((program) => program.id === pid));
  check("class catalog can select the simple-class snapshot", (await api("/programs?presentation=class&limit=50")).body.programs.some((program) => program.id === pid));
  check("unknown public catalog is refused", (await api("/programs?presentation=everything")).status === 400);
  check("offer immediately public with exact advance cutoff", (await api(`/programs/${pid}/batches`)).body.batches[0]?.enrollmentClosesAt === item.batch.tuitionPeriod.startsAt);
  const again = await publish(item);
  check("unchanged republish is idempotent", again.status === 200 && again.body.unchanged === true && again.body.item.batch.version === item.batch.version);
  const changed = await save(item, { summary: "A revised explanation of how our Maths tuition supports schoolwork." });
  check("edit saved as draft", changed.status === 200);
  check("edit does not change published description", (await api(`/programs/${pid}`)).body.program.summary === body.summary);
  check("old editor cannot overwrite newer shared description", (await save(item)).status === 409);
  item = changed.body.item;
  const revised = await publish(item);
  check("explicit republish updates description and offer together", revised.status === 200 && revised.body.item.batch.published.programVersion === revised.body.item.publishedDescription.version);
  item = revised.body.item;
  const next = await api(`/learning-program-batches/${id}/next-period`, { method: "POST", token: teacher.token });
  const nextItem = (await read(next.body.batch.id)).body.item;
  check("next thirty days stay in simple class flow", nextItem.title === item.title && nextItem.batch.tuitionPeriod.index === 1 && nextItem.batch.lessons.length === 0);
  const offsetDay = new Date(Date.parse(`${day}T00:00:00Z`) + 31 * 86400000).toISOString().slice(0, 10);
  const nextSaved = await save(nextItem, { summary: item.summary, lessons: [{ date: offsetDay, time: "15:00", durationMinutes: 60 }] });
  check("next set of dates publishes without changing description version", (await publish(nextSaved.body.item)).status === 200);
  const siblingEdit = await save((await read(id)).body.item, { title: "Changed name would hide another listing" });
  check("shared-description change cannot silently invalidate another published offer", (await publish(siblingEdit.body.item)).status === 409);
  check("both offers stay publicly visible after refused shared revision", (await api(`/programs/${pid}/batches`)).body.batches.length === 2);
  const overlap = (await create({ ...body, requestKey: body.requestKey + "-overlap", format: "fixed" })).body.item;
  check("new class conflicts with published existing timetable", (await publish(overlap)).status === 409);
  check("conflict does not partially publish description", (await api(`/programs/${overlap.batch.programId}`)).status === 404);
  check("conflict leaves batch draft", (await read(overlap.batch.id)).body.item.batch.status === "draft");
  const unapproved = (await create(body, pending.token)).body.item;
  check("existing account approval gate preserved", (await publish(unapproved, pending.token)).status === 403);
  sql(`update users set suspended_at=now() where id=${teacher.user.id}`);
  check("suspended teacher cannot publish", (await publish((await read(id)).body.item)).status === 403);
  check("suspended listing hidden publicly", (await api(`/programs/${pid}`)).status === 404);
  sql(`update users set suspended_at=null where id=${teacher.user.id}`);
  check("student cannot use operator-only simulated enrolment", (await api(`/admin/program-commerce/programs/${pid}/test-enrolments`, { method: "POST", token: student.token, body: { studentId: student.user.id, totalTuitionNpr: 3000, paidLessonCount: 1 } })).status === 403);

  // A separate teacher keeps this contract probe independent of conflict fixtures above.
  const lateBody = { ...body, requestKey: body.requestKey + "-late", allowLateJoining: true, totalTuitionNpr: 5000,
    lessons: Array.from({ length: 18 }, (_, index) => ({ date: new Date(Date.parse(day) + index * 86400000).toISOString().slice(0, 10), time: "15:00", durationMinutes: 60 })) };
  const lateCreated = await create(lateBody, other.token);
  let lateItem = lateCreated.body.item;
  check("late-joining teacher choice persists", lateCreated.status === 201 && lateItem.batch.allowLateJoining === true);
  const latePublished = await publish(lateItem, other.token);
  check("late-joining publication passes validation", latePublished.status === 200, JSON.stringify(latePublished.body));
  lateItem = latePublished.body.item;
  const lateId = lateItem.batch.id, latePid = lateItem.batch.programId;
  let latePublic = (await api(`/programs/${latePid}/batches`)).body.batches[0];
  check("public choice is frozen and cutoff is last lesson start", latePublic.allowLateJoining === true && latePublic.enrollmentClosesAt === latePublic.lessons[17].startsAt);
  check("advance estimate is full price without inventing seat availability", latePublic.joiningPreview.amountNpr === 5000 && latePublic.joiningPreview.previewOnly === true && !("seatsRemaining" in latePublic));
  const policyDraft = await api(`/teaching-classes/${lateId}`, { method: "PATCH", token: other.token, body: { ...lateBody, ...versions(lateItem), allowLateJoining: false } });
  check("policy edit saves separately from published promise", policyDraft.status === 200 && policyDraft.body.item.batch.allowLateJoining === false && (await api(`/programs/${latePid}/batches`)).body.batches[0].allowLateJoining === true);
  check("another teacher cannot change late policy", (await api(`/teaching-classes/${lateId}`, { method: "PATCH", token: teacher.token, body: { ...lateBody, ...versions(policyDraft.body.item), allowLateJoining: false } })).status === 404);
  // Move ONLY this synthetic published snapshot to a mid-period instant. The public API still
  // applies its real visibility rules, validator and server clock. Never alter an existing user.
  const snapshot = structuredClone(latePublic);
  delete snapshot.joiningPreview;
  const anchor = Date.now() - 6 * 86400000 - 60000;
  snapshot.tuitionPeriod.startsAt = new Date(anchor).toISOString();
  snapshot.tuitionPeriod.endsAt = new Date(anchor + 30 * 86400000).toISOString();
  snapshot.lessons.forEach((lesson, index) => { lesson.startsAt = new Date(anchor + index * 86400000).toISOString(); });
  snapshot.enrollmentClosesAt = snapshot.lessons[17].startsAt;
  sql(`update learning_program_batches set published_snapshot='${JSON.stringify(snapshot).replaceAll("'", "''")}'::jsonb where id=${lateId}`);
  latePublic = (await api(`/programs/${latePid}/batches`)).body.batches[0];
  check("mid-period listing remains visible with exact 11-lesson quote", latePublic?.joiningPreview.amountNpr === 3056 && latePublic.joiningPreview.remainingLessonCount === 11);
  check("already-started lesson excluded and period end retained", latePublic?.joiningPreview.lessonPositions[0] === 7 && latePublic.joiningPreview.periodEndsAt === snapshot.tuitionPeriod.endsAt);
  sql(`update users set suspended_at=now() where id=${other.user.id}`);
  check("late joining never bypasses suspension", (await api(`/programs/${latePid}/batches`)).body.batches.length === 0);
  sql(`update users set suspended_at=null where id=${other.user.id}`);
}

async function billingTransition() {
  console.log("\n[Billing transition] Legacy sales paused, existing access untouched");
  const teacher = await register("teacher"), student = await register("student");
  const profileId = Number(sql(`select id from teacher_profiles where user_id=${teacher.user.id}`));
  const before = sql(`select row_to_json(p) from teacher_profiles p where user_id=${teacher.user.id}`);
  const planCount = sql(`select count(*) from teacher_plans where teacher_id=${teacher.user.id}`);
  const port = API_PORT + 3;
  const server = spawn(process.execPath, [path.join(serverRoot, "dist", "index.mjs")], {
    cwd: repoRoot, stdio: "ignore",
    env: { ...process.env, NODE_ENV: "test", PORT: String(port), DATABASE_URL: PGURL,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "learning-program-test-secret",
      LEGACY_TEACHER_PLAN_SALES: "paused", PAYMENT_WEBHOOK_SECRET: "billing-refusal-test-only" },
  });
  const request = async (route, token = teacher.token, body) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${route}`, { method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/healthz`)).ok) { ready = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error("paused billing API did not start");
    const policy = await request("/teachers/me/billing");
    check("billing policy is authenticated, paused and not checkout", policy.status === 200 && policy.body.legacyPlanSalesOpen === false && policy.body.newClassCheckoutOpen === false);
    check("student cannot read teacher billing endpoint", (await request("/teachers/me/billing", student.token)).status === 403);
    for (const route of [`/teachers/${profileId}/subscribe`, "/monthly/plan"]) {
      const response = await request(route, teacher.token, { tier: "tier4", paymentMethod: "synthetic" });
      check(`${route}: refused before gateway or mutation`, response.status === 409 && response.body.code === "LEGACY_PLAN_SALES_PAUSED");
    }
    check("tier profile is byte-for-byte unchanged by refused sale", sql(`select row_to_json(p) from teacher_profiles p where user_id=${teacher.user.id}`) === before);
    check("no monthly plan inserted by refused sale", sql(`select count(*) from teacher_plans where teacher_id=${teacher.user.id}`) === planCount);
    const monthly = await request("/monthly/plan");
    check("monthly no-plan screen gets authoritative sale state", monthly.status === 200 && monthly.body.legacyPlanSalesOpen === false);
    check("existing teaching allowance remains readable", (await request("/teachers/me/allowance")).status === 200);
  } finally { server.kill("SIGKILL"); }
}

await main();
