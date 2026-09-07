/**
 * Says whether the LiveKit credentials are right, in words.
 *
 * ## This is the second-choice way to run this check
 *
 * The first choice is the support desk in a browser: sign in as an agent, and the card at the
 * top of the queue runs exactly these checks on the server that actually serves video. That is
 * where the owner should go, because every time this project has handed them a command instead,
 * something environmental has broken it — once the wrong branch, once `&&` pasted into
 * PowerShell where it is not a statement separator. Neither had anything to do with LiveKit.
 *
 * This file stays for the case the web page cannot cover: checking a `.env` on a machine where
 * the server is not running yet. It prints; it decides nothing. Every judgement comes from
 * `../src/lib/video/diagnose.ts`, which the web route calls too — two copies of a diagnostic
 * would eventually disagree, and one that disagrees with itself is worse than none.
 *
 * Usage, from the repository root:
 *   pnpm run livekit:check
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/*
  `fileURLToPath`, not `new URL(...).pathname`.

  On Windows the second gives `/C:/Projects/...` — with a leading slash — and every filesystem
  call on it fails. This is a diagnostic whose whole job is to run on the owner's Windows
  machine, so it was broken in exactly the place it was written for.
*/
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.resolve(HERE, "..", "..", "..", ".env");

/** Reads the same root .env the API server reads, so this cannot disagree with it. */
if (existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile?.(ENV_FILE);
  } catch (err) {
    console.log(`\n  WRONG Could not read ${ENV_FILE}: ${err.message}`);
    console.log("        → Check the file is not open in another program, then try again.\n");
    process.exit(1);
  }
} else {
  console.log(`\n  WRONG There is no .env file at ${ENV_FILE}`);
  console.log("        → That is the file the four LiveKit lines go in. Create it there.\n");
  process.exit(1);
}

const { diagnoseVideo, WHERE } = await import(path.join(HERE, "..", "src", "lib", "video", "diagnose.ts"));

console.log("\nChecking the LiveKit settings in your .env file\n");

// The same checks the web page runs, but every remedy points at the file this just read rather
// than at Railway — the reader is standing at their own machine.
const result = await diagnoseVideo(process.env, WHERE.local);

for (const finding of result.findings) {
  const mark = finding.verdict === "ok" ? "OK   " : finding.verdict === "wrong" ? "WRONG" : "?    ";
  console.log(`  ${mark} ${finding.title}`);
  if (finding.fix) console.log(`        → ${finding.fix}`);
}

console.log(`\n${result.summary}\n`);

/*
  Exit 1 on a wrong setting, 0 on an unreachable network.

  Being unable to see livekit.cloud from this machine is not a verdict on the settings, and the
  build environment here cannot reach it at all. Failing the command for that would make this
  script unrunnable in CI while telling nobody anything true.
*/
process.exit(result.findings.some((f) => f.verdict === "wrong") ? 1 : 0);
