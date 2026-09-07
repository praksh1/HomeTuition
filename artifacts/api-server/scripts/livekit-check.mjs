/**
 * Says whether the LiveKit credentials are right, in words.
 *
 * ## Why this exists
 *
 * The owner is not a developer and will be setting these three variables alone, probably in the
 * evening, on a Windows machine. Without this, a wrong secret shows up as a video panel that
 * says "the call could not start" — which is true and useless, because it is the same message a
 * bad wi-fi connection produces. There is nowhere to look that answers "is it me or is it the
 * key?".
 *
 * So this answers exactly that question and nothing else, and it names the next thing to do
 * after every answer. This project's rule is to hand over the route rather than the destination.
 *
 * ## What it checks, in order
 *
 * 1. Are all three variables present, and do they look like what they claim to be?
 * 2. Can the secret sign a token this server would accept back?
 * 3. **Does LiveKit itself accept them?** This is the one that matters — a key can be perfectly
 *    well-formed and belong to a project that was deleted. It asks LiveKit to list the rooms,
 *    which needs no rooms to exist and changes nothing.
 *
 * Step 3 needs the internet, and it is the only step that does. It has never been run against a
 * real LiveKit project from inside this repository's build environment, because the network
 * there cannot reach livekit.cloud — see the note it prints when the connection fails.
 *
 * Usage, from the repository root:
 *   node artifacts/api-server/scripts/livekit-check.mjs
 *
 * On Windows, from C:\\Projects\\Paathshala\\Paathshala:
 *   node artifacts\\api-server\\scripts\\livekit-check.mjs
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
const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env");

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

/*
  Loaded after the environment, and dynamically.

  A static import would crash with a module-not-found stack trace before printing anything at
  all if `pnpm install` had not been run since this branch was checked out — which is the most
  likely reason somebody is running this for the first time.
*/
let AccessToken, RoomServiceClient;
try {
  ({ AccessToken, RoomServiceClient } = await import("livekit-server-sdk"));
} catch {
  console.log("\n  WRONG The LiveKit library is not installed yet.");
  console.log("        → Run this first, from C:\\Projects\\Paathshala\\Paathshala:");
  console.log("            pnpm.cmd install\n");
  process.exit(1);
}

const KEY = process.env.LIVEKIT_API_KEY?.trim();
const SECRET = process.env.LIVEKIT_API_SECRET?.trim();
const URL_ = process.env.LIVEKIT_URL?.trim();

let failed = false;
const ok = (m) => console.log(`  OK    ${m}`);
const bad = (m, fix) => {
  failed = true;
  console.log(`  WRONG ${m}`);
  if (fix) console.log(`        → ${fix}`);
};

console.log("\nChecking the LiveKit settings in your .env file\n");

/* ---------- 1. Are they there? ---------- */

if (!KEY) bad("LIVEKIT_API_KEY is missing or empty.", "Add it to .env at the top level of the project folder.");
else ok(`LIVEKIT_API_KEY is set (${KEY.slice(0, 6)}…, ${KEY.length} characters).`);

/*
  The secret is never printed, not even partially, and not even here.

  A support screenshot of a diagnostic is exactly how a signing key ends up in a chat log, and
  this one is meant to be run when something is wrong — which is when people take screenshots.
  Its length is enough to tell an empty value from a truncated paste.
*/
if (!SECRET) bad("LIVEKIT_API_SECRET is missing or empty.", "Add it to the same .env file. Never paste it into a chat or a screenshot.");
else if (SECRET.length < 20) bad(`LIVEKIT_API_SECRET is only ${SECRET.length} characters, which is too short to be a real one.`, "It was probably cut off when pasted. Copy it again from the LiveKit dashboard.");
else ok(`LIVEKIT_API_SECRET is set (${SECRET.length} characters, not shown).`);

if (!URL_) {
  bad("LIVEKIT_URL is missing or empty.", "It looks like wss://your-project.livekit.cloud");
} else if (!URL_.startsWith("wss://")) {
  bad(
    `LIVEKIT_URL is "${URL_}", which does not start with wss://`,
    URL_.startsWith("https://")
      ? `Change https:// to wss:// — so wss://${URL_.slice("https://".length)}`
      : "It must look like wss://your-project.livekit.cloud",
  );
} else {
  ok(`LIVEKIT_URL is ${URL_}`);
}

/*
  Stop on any settings problem, not only a missing one.

  Going on to ask LiveKit about credentials that are already known to be wrong produces a second,
  vaguer error underneath the specific one — and the reader then has two things to fix and no
  idea which caused which. One problem at a time, with its remedy attached.
*/
if (failed) {
  console.log("\nFix the lines marked WRONG above, then run this again.");
  console.log("All three settings are needed together, so nothing is checked against LiveKit until they are.\n");
  process.exit(1);
}

/* ---------- 2. Can the secret sign something? ---------- */

let signed = null;
try {
  const token = new AccessToken(KEY, SECRET, { identity: "preflight", ttl: 60 });
  token.addGrant({ roomJoin: true, room: "sikshya0" });
  signed = await token.toJwt();
  const [, payload] = signed.split(".");
  const claims = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  if (claims?.video?.room === "sikshya0") ok("A join token can be signed with that key and secret.");
  else bad("A token was produced but does not carry the room it should.", "This is a bug in the app, not in your settings. Report it.");
} catch (err) {
  bad(`A token could not be signed: ${err.message}`, "The key or secret is malformed — copy both again from the LiveKit dashboard.");
}

/* ---------- 3. Does LiveKit accept them? ---------- */

console.log("\nAsking LiveKit whether it recognises them…\n");

// The REST API is https, on the same host as the wss address.
const httpsHost = URL_.replace(/^wss:/, "https:").replace(/^ws:/, "http:");

try {
  const rooms = new RoomServiceClient(httpsHost, KEY, SECRET);
  const list = await rooms.listRooms();
  ok(`LiveKit accepted the credentials. ${list.length} room(s) open right now.`);
  console.log("\nEverything is set up correctly. You can start a class and join the call.\n");
} catch (err) {
  const message = String(err?.message ?? err);
  if (/401|unauthor|invalid/i.test(message)) {
    bad(
      "LiveKit refused the key and secret.",
      "They are well-formed but wrong, or they belong to a different project. " +
        "Open your LiveKit Cloud dashboard, create a fresh key, and copy all three values again — " +
        "the URL as well, since a key only works with its own project.",
    );
  } else if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) {
    bad(
      `The address ${URL_} could not be found.`,
      "Check the project name in LIVEKIT_URL against the dashboard. If it is right, this machine has no internet.",
    );
  } else if (
    /ECONNREFUSED|ETIMEDOUT|ENETUNREACH|fetch failed|allowlist|egress|proxy|\b40[37]\b/i.test(message)
  ) {
    /*
      Blocked on the way out rather than refused at the other end.

      A company or school network that filters outbound traffic answers for LiveKit and says
      something about a proxy or an allowlist. That is not a credential problem, and calling it
      one sends somebody to regenerate a key that was fine. This repository's own build
      environment does exactly this, which is how the case was found.
    */
    console.log(`  ?     Could not reach LiveKit: ${message}`);
    console.log("        → The settings look right; this machine just cannot reach livekit.cloud.");
    console.log("          A firewall, a proxy, or no internet. The first two checks above still passed.");
  } else {
    bad(`LiveKit answered with something unexpected: ${message}`, "Worth reporting with this output — but remove nothing and add no secret to it.");
  }
}

process.exit(failed ? 1 : 0);
