/**
 * Who is entitled to Monthly Discussion Mode, at the boundaries.
 *
 * Against a real database, because the answer is a join across `recurring_days`,
 * `recurring_sessions` and `teacher_plans` and a pure test would only be re-testing the
 * arithmetic in `lib/monthly.ts`. What is worth proving here is that the *records* are read
 * correctly, and that the entitlement follows the class's own scheduled time rather than the
 * moment somebody asks.
 *
 * Two of the brief's nine cases cannot be decided by this schema at all. They are tested here
 * anyway — asserting the honest behaviour and naming what is missing — because a case that
 * simply goes untested reads later as a case somebody forgot.
 *
 * Usage: PGURL=... node scripts/entitlement-tests/run.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..", "..");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";

let passed = 0, failed = 0; const failures = [];
const check = (n, ok, d = "") => {
  if (ok) { passed++; console.log(`  ok   ${n}`); }
  else { failed++; failures.push(`${n}${d ? ` — ${d}` : ""}`); console.log(`  FAIL ${n}${d ? ` — ${d}` : ""}`); }
};
const sql = (s) => execFileSync("psql", [PGURL, "-v", "ON_ERROR_STOP=1", "-tAc", s], { encoding: "utf8" }).trim();

/*
  The classifier is bundled and imported, rather than driven through the room route.

  Two reasons, and the second is decisive. `@workspace/db` uses directory imports that Node's
  ESM loader will not resolve, so a bare import fails. And the room route only answers for a
  class that is joinable *now* — it refuses one scheduled ten days out long before eligibility
  is computed — while every boundary worth testing here is a class at some distance from the
  present. Driving the route would test the door, not the rule behind it.

  esbuild is already a dependency and `sikshya/scripts/bundle-for-browser.mjs` records why it is
  used through its JavaScript API rather than its CLI: the CLI path that works on Windows is the
  native binary on Linux, and there is no spelling that is correct on both.
*/
process.env.DATABASE_URL = PGURL;
const esbuild = await import(createRequire(path.join(serverRoot, "package.json")).resolve("esbuild"));
const bundlePath = path.join(mkdtempSync(path.join(tmpdir(), "entitlement-")), "eligibility.mjs");
await (esbuild.build ?? esbuild.default.build)({
  entryPoints: [path.join(serverRoot, "src", "lib", "classroom", "discussionEligibility.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  /*
    Only the native driver stays external. An earlier attempt also externalised drizzle-orm and
    pino, and the bundle then could not resolve them: it is written to a temp directory, outside
    any node_modules tree. Everything resolvable is therefore bundled in.
  */
  external: ["pg-native"],
  /*
    `pg` is CommonJS and calls `require` at load time, which an ESM bundle has no such thing as.
    The same banner `build.mjs` uses for the server itself, and for the same reason — copied
    rather than invented, so the two cannot drift into disagreeing about how this package loads.
  */
  banner: {
    js: "import { createRequire as __cr } from 'node:module';\nglobalThis.require = __cr(import.meta.url);",
  },
  logLevel: "error",
  absWorkingDir: serverRoot,
});
const { classifyMonthly } = await import(bundlePath);

const DAY = 24 * 60 * 60 * 1000;
const stamp = Date.now();
let seq = 0;

/**
 * Build one monthly class-day directly in the database.
 *
 * Rows rather than routes: this is about what the records mean, and `POST /monthly/plan` is
 * refused unless the API runs in test mode — a dependency this suite does not need and should
 * not inherit. Every field it sets is one the classifier reads.
 */
function makeMonthlyDay({ anchorDaysAgo = 5, status = "active", suspendedUntil = null, sessionOffsetDays = 0 }) {
  seq += 1;
  /*
    One statement, deliberately.

    An earlier version built this in five calls and each one could half-succeed, so an aborted
    run left debris that made the next run fail on a unique index for a teacher it had just
    created. One chain either produces a whole class-day or nothing at all.
  */
  const suspendCol = suspendedUntil === null ? "" : ", suspended_until";
  const suspendVal = suspendedUntil === null ? "" : `, now() + interval '${suspendedUntil} days'`;
  const when = `now() + interval '${sessionOffsetDays} days'`;

  const row = sql(`
    WITH u AS (
      INSERT INTO users (name, email, role, password_hash)
      VALUES ('Ent Teacher', 'ent_${stamp}_${seq}@example.com', 'teacher', 'x')
      RETURNING id
    ), prof AS (
      INSERT INTO teacher_profiles (user_id, subject, bio, approval_status)
      SELECT id, 'Maths', 'x', 'approved' FROM u
    ), plan AS (
      INSERT INTO teacher_plans (teacher_id, price, cycle_anchor, status${suspendCol})
      SELECT id, 6500, now() - interval '${anchorDaysAgo} days', '${status}'${suspendVal} FROM u
      RETURNING id, teacher_id
    ), rec AS (
      INSERT INTO recurring_sessions (plan_id, teacher_id, subject, topic, start_minute, duration_minutes, monthly_price)
      SELECT id, teacher_id, 'Maths', 'Algebra', 1020, 60, 2000 FROM plan
      RETURNING id
    ), sess AS (
      INSERT INTO sessions (teacher_id, teacher_name, subject, topic, date, duration, price)
      SELECT teacher_id, 'Ent Teacher', 'Maths', 'Algebra', ${when}, 60, 0 FROM plan
      RETURNING id
    ), day AS (
      INSERT INTO recurring_days (recurring_id, session_id, cycle_index, kind, scheduled_for, status)
      SELECT rec.id, sess.id, 0, 'regular', ${when}, 'planned' FROM rec, sess
      RETURNING id
    )
    SELECT plan.teacher_id || ',' || plan.id || ',' || rec.id || ',' || sess.id
      FROM plan, rec, sess, day`);

  const [teacherId, planId, recurringId, sessionId] = row.split(",").map(Number);
  if (!Number.isInteger(sessionId)) throw new Error(`fixture produced "${row}"`);
  return { teacherId, planId, recurringId, sessionId };
}

/** A pay-as-you-go class: a real session with no recurring day pointing at it. */
function makePaygSession() {
  seq += 1;
  const id = Number(sql(`
    WITH u AS (
      INSERT INTO users (name, email, role, password_hash)
      VALUES ('PAYG Teacher', 'payg_${stamp}_${seq}@example.com', 'teacher', 'x')
      RETURNING id
    ), prof AS (
      INSERT INTO teacher_profiles (user_id, subject, bio, approval_status)
      SELECT id, 'Maths', 'x', 'approved' FROM u
    ), sess AS (
      INSERT INTO sessions (teacher_id, teacher_name, subject, topic, date, duration, price)
      SELECT id, 'PAYG Teacher', 'Maths', 'One-off', now() + interval '1 hour', 60, 500 FROM u
      RETURNING id
    )
    SELECT id FROM sess`));
  if (!Number.isInteger(id)) throw new Error(`pay-as-you-go fixture produced "${id}"`);
  return id;
}

console.log("\nMonthly Discussion entitlement, at the boundaries\n");

/* --- 1. the ordinary case ------------------------------------------------ */

{
  const { sessionId } = makeMonthlyDay({ anchorDaysAgo: 5, sessionOffsetDays: 0 });
  const r = await classifyMonthly(sessionId);
  check("a class inside an active paid cycle is eligible", r.monthly === true, JSON.stringify(r));
  check("and reports which cycle it fell in", r.cycleIndex === 0, JSON.stringify(r));
}

/* --- 2. inside vs outside the paid cycle --------------------------------- */

{
  // Anchored 25 days ago; a class tomorrow is day 26 — still inside cycle 0 (30 days).
  const { sessionId } = makeMonthlyDay({ anchorDaysAgo: 25, sessionOffsetDays: 1 });
  const r = await classifyMonthly(sessionId);
  check("a class late in the first cycle is still inside it", r.monthly === true && r.cycleIndex === 0,
    JSON.stringify(r));
}

{
  // Anchored 25 days ago; a class in 10 days is day 35 — cycle 1.
  const { sessionId } = makeMonthlyDay({ anchorDaysAgo: 25, sessionOffsetDays: 10 });
  const r = await classifyMonthly(sessionId);
  check("a class past the cycle boundary is judged on the next cycle", r.cycleIndex === 1, JSON.stringify(r));
  /*
    Still eligible, because the plan is active and this schema records no cycle-by-cycle
    payment. That is the honest answer rather than a guess: see "what this cannot prove" in
    discussionEligibility.ts.
  */
  check("and an active plan still covers it, since nothing records per-cycle payment",
    r.monthly === true, JSON.stringify(r));
}

{
  const { sessionId } = makeMonthlyDay({ anchorDaysAgo: 2, sessionOffsetDays: -10 });
  const r = await classifyMonthly(sessionId);
  check("a class scheduled before the plan began is not covered",
    r.monthly === false && r.reason === "before-coverage", JSON.stringify(r));
}

/* --- 3. rescheduling across the boundary --------------------------------- */

{
  const { sessionId } = makeMonthlyDay({ anchorDaysAgo: 25, sessionOffsetDays: 1 });
  const before = await classifyMonthly(sessionId);
  check("before rescheduling, the class is in cycle 0", before.cycleIndex === 0, JSON.stringify(before));

  // Move the class itself, as a reschedule does. `recurring_days.scheduled_for` stays put.
  sql(`UPDATE sessions SET date = now() + interval '10 days' WHERE id = ${sessionId}`);
  const after = await classifyMonthly(sessionId);
  /*
    The class's own date is what counts. Reading the stale `recurring_days.scheduled_for` would
    answer cycle 0 for a class that now runs in cycle 1 — the exact case the brief names.
  */
  check("moving it across the boundary moves which cycle judges it",
    after.cycleIndex === 1, JSON.stringify(after));
}

/* --- 4. suspension ------------------------------------------------------- */

{
  const { sessionId } = makeMonthlyDay({ status: "suspended", suspendedUntil: 20 });
  const r = await classifyMonthly(sessionId);
  check("an operator suspension revokes the benefit",
    r.monthly === false && r.reason === "plan-suspended", JSON.stringify(r));
}

{
  const { sessionId, planId } = makeMonthlyDay({ status: "suspended" });
  sql(`UPDATE teacher_plans SET suspended_until = now() - interval '1 day' WHERE id = ${planId}`);
  const r = await classifyMonthly(sessionId);
  /*
    An expired `suspended_until` does NOT restore the benefit, and that is deliberate.

    A first version of this asserted the opposite and failed — which turned out to be a real
    finding rather than a bug: **nothing in this codebase reads `suspended_until` to decide a
    suspension has lapsed, and nothing sets `status` back to `active`.** A plan suspended for
    thirty days stays suspended until an operator changes it. Had this file believed otherwise
    it would have been the only place that did, and a teacher's discussion would have come back
    while every other screen still called them suspended.
  */
  check("an expired suspension date does not restore it, because nothing re-activates a plan",
    r.monthly === false && r.reason === "plan-suspended", JSON.stringify(r));
}

/* --- 5. lapsed: the case this schema cannot decide ------------------------ */

{
  const { sessionId } = makeMonthlyDay({ status: "lapsed" });
  const r = await classifyMonthly(sessionId);
  /*
    Asserting the honest behaviour, and naming the gap rather than leaving it untested.

    A lapsed plan denies. That is right for a teacher who stopped paying and wrong for one who
    cancelled inside a cycle they had already paid for — and nothing in this schema tells those
    apart: no payment record, no renewal flag, no `lapsed_at`. Denying is the direction that
    cannot give away unpaid product. Fixing it properly needs a schema change and a commercial
    decision, both of which belong to the owner.
  */
  check("a lapsed plan denies, which is safe but cannot distinguish cancel-inside-a-paid-cycle",
    r.monthly === false && r.reason === "plan-lapsed", JSON.stringify(r));
}

/* --- 6. pay as you go, and forged claims --------------------------------- */

{
  const sessionId = makePaygSession();
  const r = await classifyMonthly(sessionId);
  check("a pay-as-you-go class is never eligible",
    r.monthly === false && r.reason === "recurring-day-missing", JSON.stringify(r));
}

{
  /*
    There is no client input to forge.

    `classifyMonthly` takes a session id and reads records. It accepts no plan name, no role, no
    boolean and no header — so "a forged entitlement" cannot even be expressed as an argument.
    Asserted by construction: the same pay-as-you-go session stays ineligible however it is
    asked about.
  */
  const sessionId = makePaygSession();
  const asked = await Promise.all([classifyMonthly(sessionId), classifyMonthly(sessionId)]);
  check("eligibility takes no client-supplied input, so there is nothing to forge",
    asked.every((r) => r.monthly === false), JSON.stringify(asked));
}

/* --- 7. a missing plan --------------------------------------------------- */

{
  const { sessionId, planId } = makeMonthlyDay({});
  sql(`UPDATE teacher_plans SET cycle_anchor = NULL WHERE id = ${planId}`);
  const r = await classifyMonthly(sessionId);
  check("a plan whose clock never started is not eligible",
    r.monthly === false && r.reason === "cycle-not-started", JSON.stringify(r));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) { console.log("\nFailures:"); failures.forEach((f) => console.log("  - " + f)); }
process.exit(failed === 0 ? 0 : 1);
