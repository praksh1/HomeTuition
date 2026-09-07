/**
 * A genuine two-person LiveKit call. Real server, real tokens, real media.
 *
 * ## What this closes
 *
 * Everything written for the LiveKit trial so far has been correct-looking and unproven. The
 * server suite mints tokens and never sends one anywhere; `scripts/livekit-tests` drives the
 * real component over a *fake* provider, which is the right way to produce a dropped connection
 * or a refused camera on demand but proves nothing about packets. VIDEO.md has said so in
 * plain words: **no media has ever flowed**. That sentence is what this file exists to delete.
 *
 * It runs `livekit-server` on this machine, has the real API mint real join tokens against it,
 * opens two Chromium browsers with fake cameras, and asserts that each one **decodes frames
 * that came out of the other**. Not that a tile appeared — that `framesDecoded` on the inbound
 * RTP stream went up. A black tile and a working one look identical to a DOM query.
 *
 * ## Why a local server rather than LiveKit Cloud
 *
 * No account, no card, no credentials in a test, and it runs in CI. The server is the same open
 * source binary LiveKit Cloud runs, so the SFU behaviour — simulcast layer selection, dynacast,
 * subscription changes — is the real thing. What it does *not* reproduce is the internet: no
 * latency, no packet loss, no TURN relay, no cloud region. A pass here means the code is right;
 * it does not mean a class in Nepal will be smooth. That still needs the owner's own two-browser
 * test through LiveKit Cloud, and VIDEO.md still says so.
 *
 * ## Requires
 *
 *   livekit-server on PATH, or LIVEKIT_SERVER_BIN pointing at it
 *   PGURL / DATABASE_URL for the throwaway database
 *
 * Usage, from artifacts/sikshya:  node scripts/livekit-live/run.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";
import { bundleForBrowser } from "../bundle-for-browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const serverRoot = path.resolve(appRoot, "..", "api-server");

const LK_PORT = Number(process.env.LIVEKIT_PORT ?? 7880);
const API_PORT = Number(process.env.LIVE_API_PORT ?? 8095);
const API = `http://127.0.0.1:${API_PORT}`;
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ht";
/** Screenshots land outside the repository, so a run never dirties the working tree. */
const SHOTS = process.env.LIVEKIT_SHOT_DIR || path.join(tmpdir(), "livekit-live-shots");

/*
  The dev-mode credentials, which are `livekit-server --dev`'s own published pair and not a
  secret of ours. They are here so the suite needs no configuration; nothing outside this
  machine will ever accept them.
*/
const DEV_KEY = "devkey";
const DEV_SECRET = "secret";
const LK_URL = `ws://127.0.0.1:${LK_PORT}`;

let passed = 0, failed = 0; const failures = [];
/**
 * A check whose failure makes every later one meaningless.
 *
 * Without this the first run reported eleven failures — nine of which were "no video flowed"
 * caused by a teacher with no teaching plan, three steps earlier. A cascade like that hides
 * the one line that matters and reads like the feature is broken when the fixture is.
 */
const must = (n, ok, d = "") => {
  check(n, ok, d);
  if (!ok) {
    console.log("\nStopping: everything after this would fail for the same reason.");
    stop();
    process.exit(1);
  }
};

const check = (n, ok, d = "") => {
  if (ok) { passed++; console.log(`  ok   ${n}`); }
  else { failed++; failures.push(`${n}${d ? ` — ${d}` : ""}`); console.log(`  FAIL ${n}${d ? ` — ${d}` : ""}`); }
};
const sql = (s) => execFileSync("psql", [PGURL, "-tAc", s], { encoding: "utf8" }).trim();

function findServerBinary() {
  if (process.env.LIVEKIT_SERVER_BIN) return process.env.LIVEKIT_SERVER_BIN;
  for (const candidate of ["/root/go/bin/livekit-server", "/usr/local/bin/livekit-server"]) {
    if (existsSync(candidate)) return candidate;
  }
  try {
    return execFileSync("which", ["livekit-server"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

const binary = findServerBinary();
if (!binary) {
  /*
    Skip rather than fail.

    This suite needs a binary that is not a package dependency and cannot be installed from npm.
    Failing without it would mean every developer without it has a red run they cannot fix, and
    a red run people learn to ignore is worse than a skipped one they can read.
  */
  console.log("\nSKIPPED — livekit-server was not found.");
  console.log("  Build it with:  git clone --depth 1 --branch v1.13.6 \\");
  console.log("    https://github.com/livekit/livekit-server.git && cd livekit-server \\");
  console.log("    && go build -o ~/go/bin/livekit-server ./cmd/server");
  console.log("  Or set LIVEKIT_SERVER_BIN to an existing one.\n");
  process.exit(0);
}

const work = mkdtempSync(path.join(tmpdir(), "livekit-live-"));
mkdirSync(SHOTS, { recursive: true });
const children = [];
const stop = () => { for (const c of children) { try { c.kill("SIGKILL"); } catch {} } };
process.on("exit", stop);

async function waitFor(fn, attempts = 80, gap = 250) {
  for (let i = 0; i < attempts; i++) {
    try { if (await fn()) return true; } catch {}
    await new Promise((r) => setTimeout(r, gap));
  }
  return false;
}

async function api(p, o = {}) {
  const h = { "Content-Type": "application/json" };
  if (o.token) h.Authorization = `Bearer ${o.token}`;
  // The app tells the server what it is; without this a browser would be handed Daily.
  h["X-Fadko-Platform"] = o.platform ?? "web";
  const r = await fetch(`${API}${p.startsWith("/api") ? "" : "/api"}${p}`, {
    method: o.method ?? "GET",
    headers: h,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  const t = await r.text();
  let b = null; try { b = t ? JSON.parse(t) : null; } catch { b = { raw: t }; }
  return { status: r.status, body: b };
}

// ---------------------------------------------------------------------------
// 1. The SFU
// ---------------------------------------------------------------------------

console.log("\nStarting livekit-server");

const lk = spawn(binary, ["--dev", "--bind", "127.0.0.1"], {
  env: { ...process.env, LIVEKIT_KEYS: `${DEV_KEY}: ${DEV_SECRET}` },
  stdio: "ignore",
});
children.push(lk);

const lkUp = await waitFor(async () => (await fetch(`http://127.0.0.1:${LK_PORT}/`)).status < 500);
check("livekit-server is listening", lkUp, `nothing answered on ${LK_PORT}`);
if (!lkUp) { stop(); process.exit(1); }

// ---------------------------------------------------------------------------
// 2. The API, pointed at it
// ---------------------------------------------------------------------------

const apiProcess = spawn(process.execPath, [path.join(serverRoot, "dist", "index.mjs")], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: String(API_PORT),
    DATABASE_URL: PGURL,
    SESSION_SECRET: process.env.SESSION_SECRET ?? "livekit-live-secret",
    VIDEO_PROVIDER: "livekit",
    LIVEKIT_API_KEY: DEV_KEY,
    LIVEKIT_API_SECRET: DEV_SECRET,
    LIVEKIT_URL: LK_URL,
  },
  stdio: "ignore",
});
children.push(apiProcess);
const apiUp = await waitFor(async () => (await fetch(`${API}/api/healthz`)).ok);
check("the API came up on LiveKit", apiUp);
if (!apiUp) { stop(); process.exit(1); }

// ---------------------------------------------------------------------------
// 3. A real class, booked and started
// ---------------------------------------------------------------------------

console.log("\nA teacher and a student, a class, a booking");

const stamp = Date.now();
const register = (name, role, email, extra = {}) => api("/auth/register", {
  method: "POST",
  // A teacher is refused without a subject and a bio; a student without a date of birth.
  body: { name, email, password: "password123", role, grade: "10", dateOfBirth: "2000-01-01", ...extra },
});

const teacher = (await register("Ram Bahadur", "teacher", `lkt_${stamp}@example.com`, { subject: "Mathematics", bio: "Ten years teaching algebra in Pokhara." })).body;
const student = (await register("Sita Sharma", "student", `lks_${stamp}@example.com`)).body;
check("both accounts exist", Boolean(teacher?.user?.id && student?.user?.id), JSON.stringify({teacher, student}).slice(0, 500));
if (!(teacher?.user?.id && student?.user?.id)) { stop(); process.exit(1); }

/*
  Straight to the state that matters, in SQL.

  Approval, email verification and onboarding each have their own suites; walking them here
  would make a failure in any of them look like a video failure. What this suite is about
  starts at "two people are entitled to be in the same room".
*/
sql(`
  UPDATE account_security SET email_verified_at = now() WHERE user_id IN (${teacher.user.id}, ${student.user.id});
  UPDATE user_onboarding SET completed_at = now() WHERE user_id IN (${teacher.user.id}, ${student.user.id});
  UPDATE teacher_profiles SET approval_status = 'approved', subscription_active = true, subscription_tier = 'base'
   WHERE user_id = ${teacher.user.id};
`);

// Starting five minutes from now: doors open ten minutes before, so it is joinable at once.
const startsAt = new Date(Date.now() + 5 * 60_000).toISOString();
const created = await api("/sessions", {
  method: "POST",
  token: teacher.token,
  // The route's own field names, not the screen's: subject, topic, date, duration, price.
  body: {
    subject: "Mathematics",
    topic: "Algebra, live",
    date: startsAt,
    duration: 60,
    maxStudents: 5,
    // Must be a whole number above zero — free classes are refused on a paid platform.
    price: 500,
  },
});
must("the teacher created a class", created.status < 300, `status=${created.status} ${JSON.stringify(created.body).slice(0, 300)}`);
const sessionId = created.body?.session?.id ?? created.body?.id;

const booked = await api(`/sessions/${sessionId}/book`, { method: "POST", token: student.token });
must("the student booked it", booked.status < 300, `status=${booked.status} ${JSON.stringify(booked.body).slice(0, 200)}`);

// ---------------------------------------------------------------------------
// 4. The tokens, from the real route
// ---------------------------------------------------------------------------

console.log("\nJoin tokens, minted by the API from the real secret");

const teacherRoom = await api(`/sessions/${sessionId}/room`, { token: teacher.token });
const studentRoom = await api(`/sessions/${sessionId}/room`, { token: student.token });

must("the teacher was given a room", teacherRoom.status === 200, `status=${teacherRoom.status} ${JSON.stringify(teacherRoom.body).slice(0, 200)}`);
must("so was the student", studentRoom.status === 200, `status=${studentRoom.status} ${JSON.stringify(studentRoom.body).slice(0, 200)}`);

const tRoom = teacherRoom.body ?? {};
const sRoom = studentRoom.body ?? {};
check("it is LiveKit carrying this call", tRoom.provider === "livekit", `provider=${tRoom.provider}`);
check("both were sent to the same room", typeof tRoom.roomUrl === "string" && tRoom.roomUrl === sRoom.roomUrl, `${tRoom.roomUrl} vs ${sRoom.roomUrl}`);
check("and given different tokens", Boolean(tRoom.token) && tRoom.token !== sRoom.token);

/**
 * The credential dies with the class.
 *
 * A join token used to be good for eight hours, so somebody who joined at 10:00 still held a
 * working key at 17:00 — after the lesson, after a refund, after being unenrolled. It now
 * expires at the class's own cutoff, which this reads straight out of the JWT the route just
 * minted rather than trusting the constant.
 *
 * That was only safe to change once a real server had been asked whether expiry hangs up on a
 * live call. It does not: a participant on a twenty-second token stayed connected for two
 * hundred seconds past expiry with no disconnect and no reconnect. The token is a door key,
 * not a heartbeat. See VIDEO.md.
 */
const claims = JSON.parse(Buffer.from(String(tRoom.token).split(".")[1], "base64url").toString("utf8"));
const livesForMinutes = (claims.exp - Math.floor(Date.now() / 1000)) / 60;
check("the token expires with the class, not eight hours later",
  livesForMinutes > 0 && livesForMinutes < 8 * 60,
  `lives for ${livesForMinutes.toFixed(1)} minutes`);
/*
  Booked to start five minutes from now for sixty minutes, so the cutoff — ten minutes past the
  booked finish — is about 75 minutes away. Asserted as a window rather than a value, because a
  few seconds pass between minting and reading.
*/
check("and expires at the class's cutoff specifically",
  livesForMinutes > 70 && livesForMinutes < 80,
  `lives for ${livesForMinutes.toFixed(1)} minutes, expected ~75`);

/*
  The security property, checked against the wire rather than against the source.

  `LIVEKIT_API_SECRET` signs the token and must never be inside one. A JWT is only base64, so a
  secret accidentally placed in a grant would travel to every browser looking like gibberish and
  nobody would notice by reading the screen.
*/
const wholeResponse = JSON.stringify(tRoom) + JSON.stringify(sRoom);
const decoded = [tRoom.token, sRoom.token]
  .filter(Boolean)
  .map((jwt) => Buffer.from(String(jwt).split(".")[1] ?? "", "base64url").toString("utf8"))
  .join("");
check("the API secret is not in the response", !wholeResponse.includes(DEV_SECRET));
check("nor inside either token", !decoded.includes(DEV_SECRET), decoded.slice(0, 200));

// ---------------------------------------------------------------------------
// 5. Two browsers, real cameras, one room
// ---------------------------------------------------------------------------

console.log("\nTwo browsers join, with cameras");

const entry = path.join(work, "entry.jsx");
writeFileSync(
  entry,
  `
import React from "react";
import { createRoot } from "react-dom/client";
import LiveKitEmbed from ${JSON.stringify(path.join(appRoot, "components", "LiveKitEmbed.web.tsx"))};

/*
  No alias here, deliberately. \`scripts/livekit-tests\` swaps \`@/lib/video\` for a fake so it
  can produce failures on demand; this one does not, so the bundle contains the real adapter
  and the real livekit-client. That is the whole difference between the two suites.
*/
const params = new URLSearchParams(location.search);

window.__events = { left: 0, watchedLeft: 0 };

function Harness() {
  return React.createElement("div", { style: { position: "relative", width: "100vw", height: "100vh" } },
    React.createElement(LiveKitEmbed, {
      roomUrl: params.get("url"),
      meetingToken: params.get("token"),
      displayName: params.get("name"),
      canScreenShare: params.get("owner") === "1",
      onLeft: () => { window.__events.left += 1; },
      onWatchedParticipantLeft: () => { window.__events.watchedLeft += 1; },
    }),
  );
}
createRoot(document.getElementById("root")).render(React.createElement(Harness));
`,
);

const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({ entry, outfile: bundle });
if (!built.ok) {
  console.error(built.error);
  stop();
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}
writeFileSync(
  path.join(work, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><title>live call</title>
<style>body{margin:0}</style></head><body><div id="root"></div><script src="bundle.js"></script></body></html>`,
);

const chromium = await getChromium();
/*
  Fake devices, not a real webcam.

  `--use-fake-device-for-media-stream` gives Chromium a synthetic camera showing a moving
  pattern and a synthetic microphone playing a tone. Moving matters: a still image would let a
  frozen stream pass a frame count, and the whole point of the assertion below is that frames
  keep arriving.
*/
const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

async function open(room, name, owner) {
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 700 },
    permissions: ["camera", "microphone"],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const q = new URLSearchParams({ url: room.roomUrl, token: room.token, name, owner: owner ? "1" : "0" });
  await page.goto(`file://${path.join(work, "index.html")}?${q}`);
  return { ctx, page, errors };
}

const t = await open(tRoom, "Ram Bahadur", true);
const s = await open(sRoom, "Sita Sharma", false);

/** Two tiles on screen means both sides agree somebody else is there. */
const bothSee = async (p) =>
  (await p.locator('[data-testid^="livekit-tile-"]').count()) >= 2;

const connected = await waitFor(async () => (await bothSee(t.page)) && (await bothSee(s.page)), 100, 300);
check("both browsers connected and see each other", connected,
  `teacher tiles=${await t.page.locator('[data-testid^="livekit-tile-"]').count()}, student tiles=${await s.page.locator('[data-testid^="livekit-tile-"]').count()}`);
check("the teacher's page threw nothing", t.errors.length === 0, t.errors[0] ?? "");
check("the student's page threw nothing", s.errors.length === 0, s.errors[0] ?? "");

// ---------------------------------------------------------------------------
// 6. The assertion the whole file exists for
// ---------------------------------------------------------------------------

console.log("\nMedia actually flows");

/**
 * Frames decoded from somebody else's camera, straight out of WebRTC's own statistics.
 *
 * A DOM check cannot tell a working tile from a black one, and `videoWidth` is set the moment a
 * track is attached whether or not a single packet ever arrives. `framesDecoded` rising over an
 * interval is the only claim worth making here, and it is the one VIDEO.md has been unable to
 * make since the trial began.
 */
async function inboundVideo(page) {
  return page.evaluate(async () => {
    const videos = [...document.querySelectorAll("video")];
    const stats = { framesDecoded: 0, bytesReceived: 0, tracks: 0 };
    for (const v of videos) {
      const stream = v.srcObject;
      if (!stream) continue;
      for (const track of stream.getVideoTracks()) stats.tracks += 1;
    }
    // Every peer connection this page holds, via the SDK's own engine.
    for (const pc of window.__lkPeerConnections ?? []) {
      const report = await pc.getStats();
      report.forEach((r) => {
        if (r.type === "inbound-rtp" && r.kind === "video") {
          stats.framesDecoded += r.framesDecoded ?? 0;
          stats.bytesReceived += r.bytesReceived ?? 0;
        }
      });
    }
    return stats;
  });
}

/*
  Reaching the peer connections.

  livekit-client does not expose them, and a test that reads private fields breaks on the next
  release. Instead the constructor is wrapped before the bundle runs, so every connection the
  SDK makes is recorded as it is made. That is stable across SDK versions because it is the
  browser's own API being wrapped, not LiveKit's.
*/
async function trackPeerConnections(page) {
  await page.addInitScript(() => {
    window.__lkPeerConnections = [];
    const Original = window.RTCPeerConnection;
    window.RTCPeerConnection = function (...args) {
      const pc = new Original(...args);
      window.__lkPeerConnections.push(pc);
      return pc;
    };
    window.RTCPeerConnection.prototype = Original.prototype;
  });
}

// Both pages have to be reloaded with the wrapper in place, so it is installed and they rejoin.
await trackPeerConnections(t.page);
await trackPeerConnections(s.page);
await t.page.reload();
await s.page.reload();

const rejoined = await waitFor(async () => (await bothSee(t.page)) && (await bothSee(s.page)), 100, 300);
check("both rejoined after the reload", rejoined);

const first = { t: await inboundVideo(t.page), s: await inboundVideo(s.page) };
await new Promise((r) => setTimeout(r, 4000));
const second = { t: await inboundVideo(t.page), s: await inboundVideo(s.page) };

check("the teacher is decoding video frames from the student",
  second.t.framesDecoded > first.t.framesDecoded && second.t.framesDecoded > 0,
  `${first.t.framesDecoded} → ${second.t.framesDecoded}`);
check("the student is decoding video frames from the teacher",
  second.s.framesDecoded > first.s.framesDecoded && second.s.framesDecoded > 0,
  `${first.s.framesDecoded} → ${second.s.framesDecoded}`);
check("and bytes are arriving on both sides",
  second.t.bytesReceived > 0 && second.s.bytesReceived > 0,
  `teacher=${second.t.bytesReceived} student=${second.s.bytesReceived}`);

/**
 * Would a person actually see a picture?
 *
 * `framesDecoded` proves packets arrive and decode. It does not prove the element is playing,
 * sized, visible, or painting anything but black — and a black tile is exactly what a student
 * would report as "the video does not work". So this draws the live element into a canvas and
 * reads the pixels back, which is the only check that answers the question being asked.
 *
 * It also reads the track's own dimensions, which is where the bandwidth design stops being a
 * configuration and becomes an observation: `VideoPresets43.h480` is meant to cap every camera
 * at 640×480, and this is the far end of the wire saying that it did.
 */
async function paintedPicture(page) {
  return page.evaluate(async () => {
    const out = [];
    for (const v of document.querySelectorAll("video")) {
      const before = v.currentTime;
      await new Promise((r) => setTimeout(r, 900));
      const advanced = v.currentTime - before;

      let nonBlackPct = 0;
      const c = document.createElement("canvas");
      c.width = Math.min(v.videoWidth || 0, 160);
      c.height = Math.min(v.videoHeight || 0, 120);
      if (c.width && c.height) {
        const ctx = c.getContext("2d");
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let lit = 0;
        for (let i = 0; i < d.length; i += 4) {
          if ((d[i] + d[i + 1] + d[i + 2]) / 3 > 12) lit += 1;
        }
        nonBlackPct = (100 * lit) / (d.length / 4);
      }
      out.push({
        w: v.videoWidth, h: v.videoHeight,
        playing: !v.paused && v.readyState >= 3 && advanced > 0.3,
        nonBlackPct,
      });
    }
    return out;
  });
}

/**
 * Wait until every tile has actually started, rather than sampling once and hoping.
 *
 * The first version took a single blind reading straight after the rejoin and passed three
 * times, then failed on the fourth with one tile reporting `playing: false, nonBlackPct: 0` —
 * a tile caught before its first decoded frame. Nothing was wrong with the call; the assertion
 * was racing it.
 *
 * A flaky test is worse than no test, because it teaches people that red means nothing. So the
 * question asked is "does every tile start within a reasonable time", which is the real claim,
 * and the last reading is returned either way so a genuine failure still prints what it saw.
 */
async function settledPicture(page, attempts = 20, gap = 500) {
  let last = [];
  for (let i = 0; i < attempts; i++) {
    last = await paintedPicture(page);
    const ready = last.length >= 2 && last.every((v) => v.playing && v.nonBlackPct > 50);
    if (ready) return last;
    await new Promise((r) => setTimeout(r, gap));
  }
  return last;
}

const painted = { t: await settledPicture(t.page), s: await settledPicture(s.page) };
check("both browsers are playing video, not just receiving it",
  painted.t.length >= 2 && painted.s.length >= 2
  && painted.t.every((v) => v.playing) && painted.s.every((v) => v.playing),
  JSON.stringify(painted));
check("and the tiles show a picture rather than black",
  painted.t.every((v) => v.nonBlackPct > 50) && painted.s.every((v) => v.nonBlackPct > 50),
  JSON.stringify(painted));
/*
  The 480p cap, measured at the receiving end.

  Not "we set a preset" — this is the decoder reporting the size of frames that actually
  crossed the SFU. A regression that let 720p through would cost a student on a 3G handset
  roughly three and a half times the bitrate and show up nowhere else.
*/
check("every incoming camera is capped at 480 lines",
  [...painted.t, ...painted.s].every((v) => v.h > 0 && v.h <= 480 && v.w <= 640),
  JSON.stringify([...painted.t, ...painted.s].map((v) => `${v.w}x${v.h}`)));

/*
  A picture of the thing that was said to be impossible.

  Kept because "no media has ever flowed" was the honest line in VIDEO.md for the whole trial,
  and the frame counts above are the proof while this is the thing a person can look at.

  **The video tiles in these files are black, and that is not a bug.** Headless Chromium does
  not composite video frames into a screenshot. The check directly above reads the pixels out
  of the live element instead and finds a picture in every one of them; the layout is what
  these images are for.
*/
await t.page.screenshot({ path: path.join(SHOTS, "two-person-call-teacher.png") });
await s.page.screenshot({ path: path.join(SHOTS, "two-person-call-student.png") });
console.log(`  (screenshots in ${SHOTS})`);

// ---------------------------------------------------------------------------
// 7. The server's own view of the room
// ---------------------------------------------------------------------------

console.log("\nThe server agrees");

/*
  `livekit-server-sdk` is a dependency of api-server, not of this app — these suites are the
  only thing here that reaches for it. Resolved through `createRequire` from that package's
  manifest rather than by walking `../../..` into node_modules, for the reason
  `bundle-for-browser.mjs` records about esbuild: pnpm's layout is not a path you can guess,
  and the guess is what breaks first.
*/
const { RoomServiceClient, TrackSource } = await import(
  createRequire(path.join(serverRoot, "package.json")).resolve("livekit-server-sdk")
);
const rooms = new RoomServiceClient(`http://127.0.0.1:${LK_PORT}`, DEV_KEY, DEV_SECRET);
const open_ = await rooms.listRooms();
must("exactly one room is open", open_.length === 1, `rooms=${open_.map((r) => r.name).join(",")}`);
check("named for the class, so attendance can correlate on it",
  /^sikshya\d+$/.test(open_[0]?.name ?? ""), open_[0]?.name ?? "none");

const inRoom = await rooms.listParticipants(open_[0].name);
check("two people are in it", inRoom.length === 2, `n=${inRoom.length}`);
check("identified by account, not by display name",
  inRoom.every((p) => /\d/.test(p.identity)), inRoom.map((p) => p.identity).join(","));

/*
  Only the teacher may share a screen. The token says so, and the server is the one enforcing
  it — which is the point of gating `canPublishSources` on `isOwner` rather than hiding a button.
*/
/**
 * May this person share a screen, according to the server?
 *
 * Compared against the SDK's own `TrackSource` enum rather than against text. At runtime
 * `canPublishSources` holds numeric enum values; it only renders as ["CAMERA", "SCREEN_SHARE"]
 * when something calls `toJSON` on it. A first version of this matched the *printed* form and
 * so reported that the teacher could not share a screen while the token plainly said they
 * could — the assertion was wrong, not the token.
 *
 * An empty list means LiveKit imposes no restriction at all, which is a yes.
 */
const canScreen = (p) => {
  const sources = p.permission?.canPublishSources ?? [];
  if (sources.length === 0) return true;
  return sources.some((src) => src === TrackSource.SCREEN_SHARE || String(src) === "SCREEN_SHARE");
};
/*
  Matched on the account id inside the identity, which `providerUserId` puts there so a
  provider's own records can be correlated with a person during a dispute.
*/
const teacherParticipant = inRoom.find((p) => String(p.identity).includes(String(teacher.user.id)));
const studentParticipant = inRoom.find((p) => String(p.identity).includes(String(student.user.id)));
check("both people were matched by account id", Boolean(teacherParticipant && studentParticipant),
  inRoom.map((p) => p.identity).join(","));

check("the teacher's token permits a screen share", teacherParticipant ? canScreen(teacherParticipant) : false,
  JSON.stringify(teacherParticipant?.permission ?? null));
check("the student's does not", studentParticipant ? !canScreen(studentParticipant) : false,
  JSON.stringify(studentParticipant?.permission ?? null));

// ---------------------------------------------------------------------------
// 8. The controls, against a real connection
// ---------------------------------------------------------------------------

console.log("\nThe controls do what they say");

await s.page.locator('[data-testid="livekit-mic"]').click();
const mutedSeen = await waitFor(async () =>
  (await t.page.locator('[data-testid="livekit-tile-' + student.user.id + '"]').getByText("muted").count()) > 0
  || (await t.page.locator("text=muted").count()) > 0, 40, 250);
check("a student muting is visible to the teacher", mutedSeen);

/*
  Audio-only, the reason this provider was chosen.

  Both halves have to happen: this person stops publishing a camera, and — the half that matters
  on a weak line — stops *subscribing* to everyone else's. The proof is that inbound video
  frames stop rising while the call stays up.
*/
await s.page.locator('[data-testid="livekit-audio-only"]').click();
await new Promise((r) => setTimeout(r, 2500));
const beforeQuiet = await inboundVideo(s.page);
await new Promise((r) => setTimeout(r, 4000));
const afterQuiet = await inboundVideo(s.page);
check("audio-only stops incoming video, not just outgoing",
  afterQuiet.framesDecoded === beforeQuiet.framesDecoded,
  `${beforeQuiet.framesDecoded} → ${afterQuiet.framesDecoded}`);
check("and the call is still up", await bothSee(s.page));

await s.page.locator('[data-testid="livekit-audio-only"]').click();
const videoBack = await waitFor(async () => (await inboundVideo(s.page)).framesDecoded > afterQuiet.framesDecoded, 40, 300);
check("turning it off brings the faces back", videoBack);

console.log("\nLeaving");

await s.page.locator('[data-testid="livekit-leave"]').click();
const gone = await waitFor(async () => (await rooms.listParticipants(open_[0].name)).length === 1, 40, 300);
check("the server sees the student leave", gone);
const teacherAlone = await waitFor(async () =>
  (await t.page.locator('[data-testid^="livekit-tile-"]').count()) === 1, 40, 300);
check("and so does the teacher's screen", teacherAlone);

await browser.close();
stop();
rmSync(work, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) { console.log("\nFailures:"); failures.forEach((f) => console.log("  - " + f)); }
process.exit(failed === 0 ? 0 : 1);
