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
import { fileURLToPath } from "node:url";
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
  await api(`/learning-programs/${id}`, { method: "PATCH", token: teacher.token, body: { modules: reversed } });
  const after = sql(`select string_agg(title, ',' order by position) from learning_program_modules where program_id = ${id}`);
  check("reordering rewrites the order", after === "Fifth,Fourth,Third,Second,First", after);
  const positions = sql(`select string_agg(position::text, ',' order by position) from learning_program_modules where program_id = ${id}`);
  check("with no gap and no duplicate", positions === "0,1,2,3,4", positions);

  /*
    A client-supplied position is ignored, because two steps claiming position 3 is a body a client
    can send and a state the reader has no honest way to resolve.
  */
  await api(`/learning-programs/${id}`, { method: "PATCH", token: teacher.token, body: { modules: [
    { title: "Says it is third", outcome: "An outcome long enough to be accepted.", position: 3 },
    { title: "Also says it is third", outcome: "An outcome long enough to be accepted.", position: 3 },
  ] } });
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

  const huge = await api("/programs?limit=100000");
  check("an enormous limit is capped rather than honoured", huge.body.programs.length <= 50, String(huge.body.programs.length));
  const zero = await api("/programs?limit=0");
  check("a limit of zero still returns a page", zero.body.programs.length >= 1, String(zero.body.programs.length));
  const nonsense = await api("/programs?limit=lots");
  check("a limit that is not a number falls back to the default rather than failing",
    nonsense.status === 200 && nonsense.body.programs.length <= 20, `${nonsense.status} ${nonsense.body?.programs?.length}`);

  check("a page marker that is not a number is refused", (await api("/programs?cursor=abc")).status === 400);
  check("and so is a negative one", (await api("/programs?cursor=-4")).status === 400);
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
      `export { learningProgramsTable, learningProgramModulesTable } from ${JSON.stringify(path.join(repoRoot, "lib", "db", "src", "schema", "learningPrograms.ts"))};`,
      `export { getTableColumns } from "drizzle-orm";`,
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
          hasDefault: Boolean(column.hasDefault) || Boolean(column.primary),
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
      ["learning_program_modules", mod.learningProgramModulesTable],
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
      "learning_programs_public_idx",
      "learning_program_modules_program_idx",
    ]) {
      check(`the index ${wanted} is created`, indexes.includes(wanted), indexes.join(", "));
    }

    const fks = sql(`
      select count(*) from information_schema.table_constraints
       where table_schema = '${scratch}' and constraint_type = 'FOREIGN KEY'`);
    check("both foreign keys are created, so an orphan row cannot exist", Number(fks) === 2, fks);
  } finally {
    execFileSync("psql", [PGURL, "-q", "-c", `DROP SCHEMA IF EXISTS ${scratch} CASCADE`], { encoding: "utf8" });
  }
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
    await unauthenticated();
    await lifecycle();
    await moderation();
    await schemaParity();
    await nothingElseMoved(watched);
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

await main();
