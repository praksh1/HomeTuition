/**
 * The retention sweep: summarise a class's fine-grained proof, then remove it.
 *
 * ## Why this has a suite of its own
 *
 * Every other failure in this product can be retried into correctness. This one cannot: once the
 * rows are gone, an aggregate that was computed wrongly is simply wrong forever, and the evidence
 * it replaced is not coming back. So the arithmetic is tested pure in `retention.test.ts`, and
 * this suite tests the part that only a real database can show — the ordering, the transaction,
 * the locking, and the fact that exactly the rows counted are the rows deleted.
 *
 * ## The defect at the centre of it
 *
 * Retention used to work row by row. A meeting that starts at 10:00 and ends at 11:00 has two rows
 * an hour apart, so on the day the window passed **the start expired an hour before the end**. One
 * sweep took the start and recorded "one meeting, span zero"; the next took the end and added
 * another. The class was left permanently summarised as two meetings of no length — a lesson that
 * plainly happened, reduced to evidence that it did not, with the rows gone and no way to correct
 * it. The first two blocks below reproduce exactly that timeline and prove it no longer happens.
 *
 * ## Nothing in the product calls it
 *
 * `sweepExpiredSessionProof` is not scheduled, not called at boot and not on any route. This
 * script bundles it and calls it directly, which is deliberately the only way it runs anywhere.
 * Turning it on in production is a separate decision — see SESSION-PROOF.md — and must not happen
 * before provider ingestion has been proven against a real delivery, because deleting rows nobody
 * ever verified is deleting the chance to find out they were wrong.
 *
 * Usage: PGURL=... node scripts/retention-sweep/run.mjs
 */
import { execFile, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..", "..");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";
const RUN = crypto.randomUUID().slice(0, 8);

let passed = 0;
let failed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

// `-q` so an INSERT ... RETURNING gives back the id alone rather than the id and psql's own
// "INSERT 0 1" status line, which turns every returned id into NaN.
const sql = (s) => execFileSync("psql", [PGURL, "-q", "-v", "ON_ERROR_STOP=1", "-tAc", s], { encoding: "utf8" }).trim();

/**
 * The sweep, bundled on the fly.
 *
 * Bundled rather than added to the production build because production must not ship an entry
 * point that deletes evidence. The harness prints one JSON line so the caller can assert on it.
 */
async function buildHarness() {
  const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sweep-")), "harness.mjs");
  await esbuild({
    stdin: {
      contents: `
        import { sweepExpiredSessionProof } from "./lib/sessionProof/retentionSweep";
        const opts = JSON.parse(process.argv[2]);
        sweepExpiredSessionProof(opts)
          .then((r) => { console.log(JSON.stringify(r)); process.exit(0); })
          .catch((e) => { console.error(e); process.exit(1); });
      `,
      resolveDir: path.join(serverRoot, "src"),
      loader: "ts",
      sourcefile: "sweep-harness.ts",
    },
    platform: "node",
    bundle: true,
    format: "esm",
    outfile,
    logLevel: "silent",
    external: ["*.node", "pg-native"],
    banner: {
      js: `import { createRequire as __cr } from 'node:module'; globalThis.require = __cr(import.meta.url);`,
    },
  });
  return outfile;
}

const sweepEnv = () => ({ ...process.env, DATABASE_URL: PGURL, NODE_ENV: "test", LOG_LEVEL: "silent" });
const lastJson = (out) => JSON.parse(out.trim().split("\n").filter(Boolean).pop());

function runSweep(harness, options) {
  return lastJson(execFileSync(process.execPath, [harness, JSON.stringify(options)], {
    encoding: "utf8",
    env: sweepEnv(),
    // Captured rather than inherited: one block below makes the sweep fail on purpose, and a
    // stack trace printed in the middle of a passing suite reads as a broken suite.
    stdio: ["ignore", "pipe", "pipe"],
  }));
}

/** The same, asynchronously, so two sweeps can be raced against each other. */
async function runSweepAsync(harness, options) {
  const { stdout } = await execFileAsync(process.execPath, [harness, JSON.stringify(options)], {
    encoding: "utf8", env: sweepEnv(),
  });
  return lastJson(stdout);
}

const MIN = 60_000;
const DAY = 86_400_000;
const WINDOW = 30 * DAY;
/** A fixed base so every arrival time in this suite is written down rather than implied. */
const BASE = Date.now() - 40 * DAY;

const iso = (ms) => new Date(ms).toISOString();

async function main() {
  const harness = await buildHarness();

  /*
    A teacher and some classes, made directly.

    No HTTP: this suite is about a function nothing calls, and routing a request through the
    product to reach it would be testing the product rather than the sweep.
  */
  const teacherId = Number(sql(`
    INSERT INTO users (name, email, password_hash, role)
    VALUES ('Sweep Teacher ${RUN}', 'sweep_t_${RUN}@example.com', 'not-a-real-hash', 'teacher') RETURNING id`));
  const newSession = (topic) => Number(sql(`
    INSERT INTO sessions (teacher_id, teacher_name, subject, topic, date, duration, max_students,
                          enrolled_count, price, status)
    VALUES (${teacherId}, 'Sweep Teacher ${RUN}', 'Maths', '${topic}', now() - interval '45 days',
            60, 10, 0, 0, 'completed')
    RETURNING id`));

  /**
   * One stored provider event, with **both** clocks written down explicitly.
   *
   * `event_at` is when the provider says it happened; `received_at` is when this server wrote the
   * row. Retention measures from the second, and the difference between them is the whole subject
   * of the first two blocks below.
   */
  const ev = (sessionId, tag, type, eventAtMs, receivedAtMs, meeting, userId = "NULL") => sql(`
    INSERT INTO session_provider_events
      (provider, provider_event_id, event_type, event_at, event_at_source, session_id, provider_room,
       provider_meeting_id, participant_user_id, received_at)
    VALUES ('daily', 'sweep_${RUN}_${tag}', '${type}', '${iso(eventAtMs)}', 'occurred', ${sessionId},
            'sikshya${sessionId}', ${meeting === null ? "NULL" : `'${meeting}'`}, ${userId},
            '${iso(receivedAtMs)}')
    RETURNING id`);

  const sample = (sessionId, quality, reconnect, observedAtMs, receivedAtMs) => sql(`
    INSERT INTO session_quality_samples
      (session_id, user_id, role, quality, reconnect, observed_at, received_at)
    VALUES (${sessionId}, ${teacherId}, 'teacher', '${quality}', ${reconnect},
            '${iso(observedAtMs)}', '${iso(receivedAtMs)}')
    RETURNING id`);

  const summaryOf = (sessionId, column) =>
    sql(`select coalesce(${column}::text, 'null') from session_proof_aggregates where session_id = ${sessionId}`);
  const eventsFor = (sessionId) =>
    sql(`select count(*) from session_provider_events where session_id = ${sessionId}`);
  const samplesFor = (sessionId) =>
    sql(`select count(*) from session_quality_samples where session_id = ${sessionId}`);

  /* ------------------------------------------------------------------ the split-meeting defect */

  console.log("\nA meeting whose two ends expire an hour apart\n");
  const split = newSession(`Split ${RUN}`);
  {
    // The lesson: started at BASE, ended an hour later, each row written as it arrived.
    ev(split, "split_start", "meeting.started", BASE, BASE, "mtg-split");
    ev(split, "split_end", "meeting.ended", BASE + 60 * MIN, BASE + 60 * MIN, "mtg-split");

    /*
      A sweep on the day the *start* passes thirty days, half an hour before the end does.

      Row-by-row retention took the start here and wrote "one meeting, span zero". Everything below
      asserts that nothing at all happens instead.
    */
    const half = runSweep(harness, {
      nowMs: BASE + WINDOW + 30 * MIN,
      available: { provider: true, telemetry: true },
    });
    check("the class is held back rather than half-swept", half.sessionsHeldBack >= 1, JSON.stringify(half));
    check("nothing was summarised for it", half.sessionsSummarised === 0, JSON.stringify(half));
    check("neither row was removed", eventsFor(split) === "2");
    check("and no partial summary was written",
      sql(`select count(*) from session_proof_aggregates where session_id = ${split}`) === "0");

    /*
      An hour later both ends are past the window, and the lesson survives as one meeting of one
      hour — which is what actually happened.
    */
    const whole = runSweep(harness, {
      nowMs: BASE + WINDOW + 90 * MIN,
      available: { provider: true, telemetry: true },
    });
    check("once every row is past the window the class is rolled up", whole.sessionsSummarised >= 1,
      JSON.stringify(whole));
    check("exactly one meeting survives", summaryOf(split, "provider_meeting_count") === "1");
    check("and its length is the hour it actually ran",
      summaryOf(split, "provider_meeting_span_ms") === String(60 * MIN),
      summaryOf(split, "provider_meeting_span_ms"));
    check("with nothing left unmeasured", summaryOf(split, "provider_meetings_unmeasured") === "0");
    check("both rows are gone", eventsFor(split) === "0");
    check("no source is marked unknown", summaryOf(split, "unavailable_sources") === "null");
    check("and nothing arrived too late to count", summaryOf(split, "late_arrivals") === "0");
  }

  console.log("\nA class that dropped and was rejoined\n");
  const two = newSession(`Two ${RUN}`);
  {
    ev(two, "a1", "meeting.started", BASE, BASE, "mtg-a");
    ev(two, "a2", "meeting.ended", BASE + 20 * MIN, BASE + 20 * MIN, "mtg-a");
    ev(two, "b1", "meeting.started", BASE + 80 * MIN, BASE + 80 * MIN, "mtg-b");
    ev(two, "b2", "meeting.ended", BASE + 90 * MIN, BASE + 90 * MIN, "mtg-b");
    ev(two, "j1", "participant.joined", BASE + MIN, BASE + MIN, "mtg-a", String(teacherId));
    ev(two, "j2", "participant.joined", BASE + 2 * MIN, BASE + 2 * MIN, "mtg-a");
    sample(two, "bad", true, BASE + 5 * MIN, BASE + 5 * MIN);
    sample(two, "good", false, BASE + 6 * MIN, BASE + 6 * MIN);

    const r = runSweep(harness, { nowMs: BASE + WINDOW + 2 * DAY, available: { provider: true, telemetry: true } });
    check("the class was rolled up", r.sessionsSummarised >= 1, JSON.stringify(r));
    check("two meetings are recorded", summaryOf(two, "provider_meeting_count") === "2");
    /*
      Thirty minutes of meeting, not the ninety between the first start and the last end. The gap
      is time nobody was in the room, and counting it would bill it as teaching.
    */
    check("the span is the sum of the two, never the distance between them",
      summaryOf(two, "provider_meeting_span_ms") === String(30 * MIN),
      summaryOf(two, "provider_meeting_span_ms"));
    check("only the join the provider could name is counted",
      summaryOf(two, "provider_participant_join_events") === "1");
    check("the reported reconnection survived", summaryOf(two, "reported_reconnects_total") === "1");
    check("the quality counts survived",
      sql(`select quality_bad || '/' || quality_good from session_proof_aggregates where session_id = ${two}`) === "1/1");
    check("every fine-grained row is gone", eventsFor(two) === "0" && samplesFor(two) === "0");

    /*
      The privacy property the whole window exists for. "The teacher's device reported one bad
      period" is a fact about a lesson and may outlive the dispute window; "at 19:42:11 this
      person's connection was bad" is surveillance and may not.
    */
    check("no per-sample timestamp or identifier survived into the summary",
      sql(`select count(*) from information_schema.columns where table_name = 'session_proof_aggregates'
           and column_name in ('observed_at','event_at','user_id','participant_user_id','provider_room')`) === "0");
  }

  console.log("\nA meeting the provider never reported the end of\n");
  const halfMeeting = newSession(`Half ${RUN}`);
  {
    ev(halfMeeting, "h1", "meeting.started", BASE, BASE, "mtg-h");
    runSweep(harness, { nowMs: BASE + WINDOW + DAY, available: { provider: true, telemetry: true } });
    check("it is counted as a meeting", summaryOf(halfMeeting, "provider_meeting_count") === "1");
    check("its length contributes nothing", summaryOf(halfMeeting, "provider_meeting_span_ms") === "0");
    // Without this the span reads as a complete measurement of a meeting nobody measured.
    check("and it is declared unmeasured rather than silently zero",
      summaryOf(halfMeeting, "provider_meetings_unmeasured") === "1");
  }

  console.log("\nA dry run changes nothing\n");
  const dry = newSession(`Dry ${RUN}`);
  {
    ev(dry, "d1", "meeting.started", BASE, BASE, "mtg-d");
    ev(dry, "d2", "meeting.ended", BASE + 10 * MIN, BASE + 10 * MIN, "mtg-d");
    const r = runSweep(harness, {
      nowMs: BASE + WINDOW + DAY, available: { provider: true, telemetry: true }, dryRun: true,
    });
    check("it says it was a dry run", r.dryRun === true);
    check("it reports what it would remove", r.providerEventsRemoved >= 2, JSON.stringify(r));
    check("every row is still there", eventsFor(dry) === "2");
    check("and no summary was written",
      sql(`select count(*) from session_proof_aggregates where session_id = ${dry}`) === "0");
  }

  console.log("\nA source that was not being watched\n");
  const unwatched = newSession(`Unwatched ${RUN}`);
  {
    sample(unwatched, "bad", false, BASE, BASE);
    runSweep(harness, { nowMs: BASE + WINDOW + DAY, available: { provider: false, telemetry: true } });
    /*
      The fabrication this guards. A zero written for a source nobody was watching is
      indistinguishable from a real zero, and once the rows are deleted nothing can tell them apart
      again.
    */
    check("a source that was not ingested is null, never zero",
      summaryOf(unwatched, "provider_meeting_count") === "null");
    check("and never false either", summaryOf(unwatched, "provider_saw_meeting") === "null");
    check("it is named so a later reader knows why",
      summaryOf(unwatched, "unavailable_sources") === "provider");
    check("the source that was watching is recorded normally",
      summaryOf(unwatched, "quality_bad") === "1");

    /*
      And it can be resolved honestly if evidence turns up later: null becomes a real number, and
      the source stops being listed as unknown.
    */
    ev(unwatched, "u1", "meeting.started", BASE + DAY, BASE + DAY, "mtg-u");
    ev(unwatched, "u2", "meeting.ended", BASE + DAY + 15 * MIN, BASE + DAY + 15 * MIN, "mtg-u");
    runSweep(harness, { nowMs: BASE + DAY + WINDOW + DAY, available: { provider: true, telemetry: true } });
    check("later provider evidence fills in what was unknown",
      summaryOf(unwatched, "provider_meeting_count") === "1");
    check("with its real length", summaryOf(unwatched, "provider_meeting_span_ms") === String(15 * MIN));
    check("and the source is no longer listed as unknown",
      summaryOf(unwatched, "unavailable_sources") === "null");
    check("the telemetry figures were not disturbed", summaryOf(unwatched, "quality_bad") === "1");
  }

  console.log("\nEvidence that arrives after the class was summarised\n");
  const late = newSession(`Late ${RUN}`);
  {
    ev(late, "l1", "meeting.started", BASE, BASE, "mtg-l");
    ev(late, "l2", "meeting.ended", BASE + 45 * MIN, BASE + 45 * MIN, "mtg-l");
    runSweep(harness, { nowMs: BASE + WINDOW + DAY, available: { provider: true, telemetry: true } });
    check("the class is summarised as one meeting of forty-five minutes",
      summaryOf(late, "provider_meeting_count") === "1" &&
      summaryOf(late, "provider_meeting_span_ms") === String(45 * MIN));

    /*
      A `meeting.ended` delivered more than a month late, for a meeting whose start is already
      gone.

      Merging it would add "a second meeting of no length" to a class that had exactly one — the
      same corruption the split-meeting defect produced, arriving by a different route. It is
      counted as a late arrival and deleted.
    */
    ev(late, "l3", "meeting.ended", BASE + 50 * MIN, BASE + 5 * DAY, "mtg-late");
    const r = runSweep(harness, { nowMs: BASE + 5 * DAY + WINDOW + DAY, available: { provider: true, telemetry: true } });
    check("the late row is removed", eventsFor(late) === "0");
    check("the meeting count is unchanged", summaryOf(late, "provider_meeting_count") === "1");
    check("the span is unchanged", summaryOf(late, "provider_meeting_span_ms") === String(45 * MIN));
    check("and it is recorded as having arrived too late to count",
      summaryOf(late, "late_arrivals") === "1", summaryOf(late, "late_arrivals"));
    check("the sweep reports it too", r.lateArrivalsRemoved >= 1, JSON.stringify(r));
  }

  console.log("\nA delivery that arrived long after the thing it describes\n");
  const delayed = newSession(`Delayed ${RUN}`);
  {
    /*
      Thirty days has to mean thirty days of *us holding the row*.

      This meeting happened forty days ago and the webhook for it only reached us two days ago —
      the ordinary shape of a provider retrying after an outage. An age taken from `event_at` would
      make it instantly eligible and delete it after two days of retention, which is not a window,
      it is a coin toss. Age comes from `received_at`, so the clock starts when we got it.
    */
    const arrived = Date.now() - 2 * DAY;
    ev(delayed, "dl1", "meeting.started", BASE, arrived, "mtg-dl");
    ev(delayed, "dl2", "meeting.ended", BASE + 40 * MIN, arrived, "mtg-dl");

    const early = runSweep(harness, { nowMs: Date.now(), available: { provider: true, telemetry: true } });
    check("a row we have only held for two days is not swept, however old the event is",
      eventsFor(delayed) === "2", JSON.stringify(early));
    check("and no summary was written for it",
      sql(`select count(*) from session_proof_aggregates where session_id = ${delayed}`) === "0");

    runSweep(harness, { nowMs: Date.now() + 29 * DAY, available: { provider: true, telemetry: true } });
    check("thirty days after it arrived, it is swept normally", eventsFor(delayed) === "0");
    check("and the meeting survives at its real length",
      summaryOf(delayed, "provider_meeting_span_ms") === String(40 * MIN));
  }

  console.log("\nOne class, one row delivered on time and one delivered weeks late\n");
  const mixed = newSession(`Mixed ${RUN}`);
  {
    /*
      The shape that decides which clock the eligibility rule reads.

      The start arrived when it happened, forty days ago, so the class *is* a candidate for
      sweeping. The end describes the same forty-day-old meeting but only reached us two days ago —
      a provider retrying after an outage. Both rows carry an old `event_at`; only one carries an
      old `received_at`.

      Judged by `event_at` the whole class looks ready, and the end is deleted after two days of
      retention while its start is summarised — the split-meeting corruption again, arriving
      through the other clock. Judged by `received_at`, the class waits.
    */
    ev(mixed, "mx1", "meeting.started", BASE, BASE, "mtg-mx");
    ev(mixed, "mx2", "meeting.ended", BASE + 55 * MIN, Date.now() - 2 * DAY, "mtg-mx");

    const held = runSweep(harness, { nowMs: Date.now(), available: { provider: true, telemetry: true } });
    check("the class is held back by the row we have only just received",
      held.sessionsHeldBack >= 1, JSON.stringify(held));
    check("neither row was removed", eventsFor(mixed) === "2");
    check("and no partial summary was written",
      sql(`select count(*) from session_proof_aggregates where session_id = ${mixed}`) === "0");

    runSweep(harness, { nowMs: Date.now() + 31 * DAY, available: { provider: true, telemetry: true } });
    check("once the late row has been held its full window the class rolls up whole",
      summaryOf(mixed, "provider_meeting_count") === "1");
    check("as one meeting of the length it actually ran",
      summaryOf(mixed, "provider_meeting_span_ms") === String(55 * MIN),
      summaryOf(mixed, "provider_meeting_span_ms"));
    check("with nothing counted as a late arrival", summaryOf(mixed, "late_arrivals") === "0");
  }

  console.log("\nA source that stops being watched after it was recorded\n");
  const wentDark = newSession(`Dark ${RUN}`);
  {
    ev(wentDark, "w1", "meeting.started", BASE, BASE, "mtg-w");
    ev(wentDark, "w2", "meeting.ended", BASE + 20 * MIN, BASE + 20 * MIN, "mtg-w");
    runSweep(harness, { nowMs: BASE + WINDOW + DAY, available: { provider: true, telemetry: true } });
    check("the provider figures are recorded", summaryOf(wentDark, "provider_meeting_count") === "1");
    check("and nothing is listed as unknown", summaryOf(wentDark, "unavailable_sources") === "null");

    /*
      Now ingestion is switched off and a late row is swept while it is off.

      The list of unknown sources is derived from the figures rather than from what this particular
      sweep could see — otherwise the summary would say "provider unknown" directly above a
      provider meeting count of 1, which is a contradiction a reader has no way to resolve.
    */
    ev(wentDark, "w3", "meeting.ended", BASE + 25 * MIN, BASE + 3 * DAY, "mtg-w2");
    runSweep(harness, { nowMs: BASE + 3 * DAY + WINDOW + DAY, available: { provider: false, telemetry: true } });
    check("a source that has real figures is not relisted as unknown",
      summaryOf(wentDark, "unavailable_sources") === "null",
      summaryOf(wentDark, "unavailable_sources"));
    check("its figures are untouched by the sweep that could not see it",
      summaryOf(wentDark, "provider_meeting_count") === "1");
    check("and the row it could not account for is counted as a late arrival",
      summaryOf(wentDark, "late_arrivals") === "1");
  }

  console.log("\nAn event that never correlated to a class\n");
  {
    sql(`
      INSERT INTO session_provider_events
        (provider, provider_event_id, event_type, event_at, event_at_source, session_id, provider_room, received_at)
      VALUES ('daily', 'sweep_${RUN}_orphan', 'meeting.started', '${iso(BASE)}', 'delivery', NULL,
              'sikshya-not-ours', '${iso(BASE)}')`);
    const r = runSweep(harness, { nowMs: BASE + WINDOW + DAY, available: { provider: true, telemetry: true } });
    check("an uncorrelated event expires with nothing written for it", r.unattachedEventsRemoved >= 1,
      JSON.stringify(r));
    check("and it is gone",
      sql(`select count(*) from session_provider_events where provider_event_id = 'sweep_${RUN}_orphan'`) === "0");
  }

  console.log("\nIf the delete fails, the summary is not written\n");
  const rollback = newSession(`Rollback ${RUN}`);
  {
    ev(rollback, "r1", "meeting.started", BASE, BASE, "mtg-r");
    ev(rollback, "r2", "meeting.ended", BASE + 25 * MIN, BASE + 25 * MIN, "mtg-r");

    /*
      A real failure, not an injected one.

      A trigger that refuses the DELETE makes the sweep fail exactly where it matters — after the
      summary has been written and before the rows are gone. If those two were not in one
      transaction, this would leave a class summarised *and* still holding its evidence, and the
      next sweep would count it all over again.
    */
    sql(`
      CREATE OR REPLACE FUNCTION sweep_block_${RUN}() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'blocked for the rollback test'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER sweep_block_trg_${RUN} BEFORE DELETE ON session_provider_events
        FOR EACH ROW WHEN (OLD.session_id = ${rollback}) EXECUTE FUNCTION sweep_block_${RUN}();
    `);
    let threw = false;
    try {
      runSweep(harness, { nowMs: BASE + WINDOW + DAY, available: { provider: true, telemetry: true } });
    } catch { threw = true; }
    sql(`DROP TRIGGER sweep_block_trg_${RUN} ON session_provider_events; DROP FUNCTION sweep_block_${RUN}();`);

    check("the sweep failed rather than half-completing", threw);
    check("no summary was left behind for that class",
      sql(`select count(*) from session_proof_aggregates where session_id = ${rollback}`) === "0");
    check("and its rows are untouched", eventsFor(rollback) === "2");

    // With the obstruction gone it completes normally, so the failure cost nothing but a retry.
    runSweep(harness, { nowMs: BASE + WINDOW + DAY, available: { provider: true, telemetry: true } });
    check("a retry after the failure succeeds", summaryOf(rollback, "provider_meeting_span_ms") === String(25 * MIN));
    check("and removes the rows", eventsFor(rollback) === "0");
  }

  console.log("\nTwo sweeps running at once\n");
  const raced = newSession(`Raced ${RUN}`);
  {
    ev(raced, "c1", "meeting.started", BASE, BASE, "mtg-c");
    ev(raced, "c2", "meeting.ended", BASE + 35 * MIN, BASE + 35 * MIN, "mtg-c");
    sample(raced, "warning", true, BASE + MIN, BASE + MIN);

    const opts = { nowMs: BASE + WINDOW + DAY, available: { provider: true, telemetry: true } };
    const [a, b] = await Promise.all([
      runSweepAsync(harness, opts).catch((e) => ({ error: String(e) })),
      runSweepAsync(harness, opts).catch((e) => ({ error: String(e) })),
    ]);
    check("neither sweep errored", !a.error && !b.error, `${JSON.stringify(a)} | ${JSON.stringify(b)}`);
    /*
      One does the work and the other finds nothing: the loser waits on the row locks, and by the
      time it gets them the rows are gone.
    */
    check("the class was rolled up exactly once, not twice",
      summaryOf(raced, "provider_meeting_span_ms") === String(35 * MIN),
      summaryOf(raced, "provider_meeting_span_ms"));
    check("its meeting was not double counted", summaryOf(raced, "provider_meeting_count") === "1");
    check("its reconnection was not double counted", summaryOf(raced, "reported_reconnects_total") === "1");
    check("nothing was recorded as a late arrival", summaryOf(raced, "late_arrivals") === "0");
    check("and every row is gone", eventsFor(raced) === "0" && samplesFor(raced) === "0");
    check("exactly one summary row exists",
      sql(`select count(*) from session_proof_aggregates where session_id = ${raced}`) === "1");
  }

  console.log("\nThe classes themselves are untouched\n");
  {
    check("every session row is still there and unchanged",
      sql(`select count(*) from sessions where teacher_id = ${teacherId} and status = 'completed'`) ===
      sql(`select count(*) from sessions where teacher_id = ${teacherId}`));
    check("and nobody's account was removed",
      sql(`select count(*) from users where id = ${teacherId}`) === "1");
  }

  console.log("\nNothing schedules any of this\n");
  {
    /*
      Nothing imports it, so nothing can call it.

      Searched for an import of the module rather than for the function's name: the name appears in
      prose in several files that explain why it is not scheduled, and a check that trips over its
      own documentation is a check nobody keeps.
    */
    let importers = "";
    try {
      importers = execFileSync("grep", [
        "-rn", "--include=*.ts", "-E", "from \"[^\"]*retentionSweep\"", path.join(serverRoot, "src"),
      ], { encoding: "utf8" }).trim();
    } catch { importers = ""; }
    check("no module in the server imports the sweep, so nothing can call it", importers === "", importers);

    const defined = execFileSync("grep", [
      "-rln", "--include=*.ts", "export async function sweepExpiredSessionProof", path.join(serverRoot, "src"),
    ], { encoding: "utf8" }).trim().split("\n");
    check("and it is defined in exactly one place",
      defined.length === 1 && defined[0].endsWith("retentionSweep.ts"), defined.join(" | "));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
