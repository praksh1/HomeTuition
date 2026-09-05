/**
 * The retention sweep: summarise a class's fine-grained proof, then remove it.
 *
 * ## Why this has a suite of its own
 *
 * Every other failure in this product can be retried into correctness. This one cannot: once the
 * rows are gone, an aggregate that was computed wrongly is simply wrong forever, and the evidence
 * it replaced is not coming back. So the arithmetic is tested pure in `retention.test.ts`, and
 * this suite tests the part that only a real database can show — the ordering, the transaction,
 * and the fact that exactly the rows counted are the rows deleted.
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
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";

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

function runSweep(harness, options) {
  const out = execFileSync(process.execPath, [harness, JSON.stringify(options)], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: PGURL, NODE_ENV: "test", LOG_LEVEL: "silent" },
  });
  const line = out.trim().split("\n").filter(Boolean).pop();
  return JSON.parse(line);
}

const DAY = 86_400_000;
const NOW = Date.now();
/** Comfortably past the thirty-day window, so "expired" is not a boundary question here. */
const OLD = new Date(NOW - 45 * DAY);
const RECENT = new Date(NOW - 2 * DAY);

async function main() {
  const harness = await buildHarness();

  /*
    A teacher, a student and a class, made directly.

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
  const sessionId = newSession(`Retention ${RUN}`);

  const ev = (tag, type, at, meeting, userId = "NULL") => sql(`
    INSERT INTO session_provider_events
      (provider, provider_event_id, event_type, event_at, event_at_source, session_id, provider_room,
       provider_meeting_id, participant_user_id)
    VALUES ('daily', 'sweep_${RUN}_${tag}', '${type}', '${at.toISOString()}', 'occurred', ${sessionId},
            'sikshya${sessionId}', ${meeting === null ? "NULL" : `'${meeting}'`}, ${userId})
    RETURNING id`);

  const sample = (tag, quality, reconnect, at) => sql(`
    INSERT INTO session_quality_samples (session_id, user_id, role, quality, reconnect, observed_at)
    VALUES (${sessionId}, ${teacherId}, 'teacher', '${quality}', ${reconnect}, '${at.toISOString()}')
    RETURNING id`);

  console.log("\nA class whose fine-grained proof has expired\n");

  // Two meetings, an hour apart, both expired.
  ev("a1", "meeting.started", new Date(OLD.getTime()), "mtg-a");
  ev("a2", "meeting.ended", new Date(OLD.getTime() + 20 * 60_000), "mtg-a");
  ev("b1", "meeting.started", new Date(OLD.getTime() + 80 * 60_000), "mtg-b");
  ev("b2", "meeting.ended", new Date(OLD.getTime() + 90 * 60_000), "mtg-b");
  ev("j1", "participant.joined", new Date(OLD.getTime() + 60_000), "mtg-a", String(teacherId));
  ev("j2", "participant.joined", new Date(OLD.getTime() + 120_000), "mtg-a");
  // One that has not expired, to prove the cutoff is respected.
  ev("fresh", "meeting.started", RECENT, "mtg-c");

  sample("s1", "bad", true, new Date(OLD.getTime() + 5 * 60_000));
  sample("s2", "good", false, new Date(OLD.getTime() + 6 * 60_000));
  sample("s3", "warning", false, RECENT);

  const eventsBefore = sql(`select count(*) from session_provider_events where session_id = ${sessionId}`);
  const samplesBefore = sql(`select count(*) from session_quality_samples where session_id = ${sessionId}`);
  check("the fixture is in place", eventsBefore === "7" && samplesBefore === "3",
    `${eventsBefore} events, ${samplesBefore} samples`);

  console.log("\nA dry run changes nothing\n");
  {
    /*
      Asserted against this run's own class, never against totals.

      The database is shared with the other suites and with earlier runs of this one, so a global
      count passes once and fails forever after. This project has already been bitten by exactly
      that: a suite that asserted absolute row counts went green on its first run and red on its
      second.
    */
    const dry = runSweep(harness, { nowMs: NOW, available: { provider: true, telemetry: true }, dryRun: true });
    check("it reports that there was something to remove",
      dry.providerEventsRemoved >= 6 && dry.qualitySamplesRemoved >= 2, JSON.stringify(dry));
    check("and says it was a dry run", dry.dryRun === true);
    check("but every row is still there",
      sql(`select count(*) from session_provider_events where session_id = ${sessionId}`) === eventsBefore &&
      sql(`select count(*) from session_quality_samples where session_id = ${sessionId}`) === samplesBefore);
    check("and no summary was written",
      sql(`select count(*) from session_proof_aggregates where session_id = ${sessionId}`) === "0");
  }

  console.log("\nA real sweep summarises first, then removes\n");
  {
    const result = runSweep(harness, { nowMs: NOW, available: { provider: true, telemetry: true } });
    check("it removed rows and said how many", result.providerEventsRemoved >= 6 && result.qualitySamplesRemoved >= 2,
      JSON.stringify(result));
    check("this class lost exactly its six expired events",
      Number(eventsBefore) - Number(sql(`select count(*) from session_provider_events where session_id = ${sessionId}`)) === 6);
    check("and exactly its two expired samples",
      Number(samplesBefore) - Number(sql(`select count(*) from session_quality_samples where session_id = ${sessionId}`)) === 2);
    check("a summary now exists for the class",
      sql(`select count(*) from session_proof_aggregates where session_id = ${sessionId}`) === "1");

    /*
      Two twenty-and-ten-minute meetings, not one ninety-minute one.

      The span must be the sum of each meeting's own length. Measuring from the first start to the
      last end would count the hour nobody was in the room as teaching, which is precisely the
      number a refund argument would lean on.
    */
    check("the surviving span is the sum of the meetings, not the distance between them",
      sql(`select provider_meeting_span_ms from session_proof_aggregates where session_id = ${sessionId}`) === String(30 * 60_000),
      sql(`select provider_meeting_span_ms from session_proof_aggregates where session_id = ${sessionId}`));
    check("it counted two meetings",
      sql(`select provider_meeting_count from session_proof_aggregates where session_id = ${sessionId}`) === "2");
    check("only the named join survived as a named join",
      sql(`select provider_participant_join_events from session_proof_aggregates where session_id = ${sessionId}`) === "1");
    check("the reported reconnection survived",
      sql(`select reported_reconnects_total from session_proof_aggregates where session_id = ${sessionId}`) === "1");
    check("the quality counts survived",
      sql(`select quality_bad || '/' || quality_good from session_proof_aggregates where session_id = ${sessionId}`) === "1/1");

    check("the rows inside the window were left alone",
      sql(`select count(*) from session_provider_events where session_id = ${sessionId}`) === "1" &&
      sql(`select count(*) from session_quality_samples where session_id = ${sessionId}`) === "1");
    check("and the one left is the recent one",
      sql(`select provider_event_id from session_provider_events where session_id = ${sessionId}`) === `sweep_${RUN}_fresh`);

    /*
      The privacy property the whole window exists for.

      "The teacher's device reported one bad period" is a fact about a lesson and may outlive the
      dispute window. "At 19:42:11 this person's connection was bad" is surveillance and may not.
    */
    check("no per-sample timestamp survived into the summary",
      sql(`select count(*) from information_schema.columns where table_name = 'session_proof_aggregates'
           and column_name in ('observed_at','event_at','user_id','participant_user_id','provider_room')`) === "0");
  }

  console.log("\nThe class itself is untouched\n");
  {
    check("the session row is still there and unchanged",
      sql(`select status from sessions where id = ${sessionId}`) === "completed");
    check("and nobody's account was removed",
      sql(`select count(*) from users where id = ${teacherId}`) === "1");
  }

  console.log("\nA second sweep adds to the summary rather than replacing it\n");
  {
    // A class can expire in pieces; an overwrite would silently drop what an earlier pass recorded.
    ev("c1", "meeting.started", new Date(OLD.getTime() - DAY), "mtg-d");
    ev("c2", "meeting.ended", new Date(OLD.getTime() - DAY + 15 * 60_000), "mtg-d");
    const second = runSweep(harness, { nowMs: NOW, available: { provider: true, telemetry: true } });
    check("it swept the newly expired rows", second.providerEventsRemoved === 2, JSON.stringify(second));
    check("and the span accumulated instead of being overwritten",
      sql(`select provider_meeting_span_ms from session_proof_aggregates where session_id = ${sessionId}`) === String(45 * 60_000));
    check("still one summary row for the class",
      sql(`select count(*) from session_proof_aggregates where session_id = ${sessionId}`) === "1");
  }

  console.log("\nA source that was never watching is recorded as unknown, not zero\n");
  {
    const otherSession = newSession(`Unwatched ${RUN}`);
    sql(`
      INSERT INTO session_quality_samples (session_id, user_id, role, quality, reconnect, observed_at)
      VALUES (${otherSession}, ${teacherId}, 'teacher', 'bad', false, '${OLD.toISOString()}')`);

    runSweep(harness, { nowMs: NOW, available: { provider: false, telemetry: true } });
    check("a source that was not being ingested is null, never a zero",
      sql(`select coalesce(provider_meeting_count::text, 'null') from session_proof_aggregates
           where session_id = ${otherSession}`) === "null");
    check("and it is named so a later reader knows why",
      sql(`select unavailable_sources from session_proof_aggregates where session_id = ${otherSession}`) === "provider");
  }

  console.log("\nAn event that never correlated to a class\n");
  {
    sql(`
      INSERT INTO session_provider_events
        (provider, provider_event_id, event_type, event_at, event_at_source, session_id, provider_room)
      VALUES ('daily', 'sweep_${RUN}_orphan', 'meeting.started', '${OLD.toISOString()}', 'delivery', NULL,
              'sikshya-not-ours')`);
    const swept = runSweep(harness, { nowMs: NOW, available: { provider: true, telemetry: true } });
    check("an uncorrelated event expires with nothing written for it", swept.unattachedEventsRemoved >= 1,
      JSON.stringify(swept));
    check("and it is gone",
      sql(`select count(*) from session_provider_events where provider_event_id = 'sweep_${RUN}_orphan'`) === "0");
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
