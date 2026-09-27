/** Staging-only real Cloud revocation proof. No application records, camera, mic or real class. */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { getChromium } from "../../sikshya/scripts/board-tests/harness.mjs";
import { revokeCloudParticipant } from "../src/lib/video/revokeAccess.ts";
import { roomNameForSession } from "../src/lib/video/roomName.ts";
const env = process.env;
if (
  env.RAILWAY_SERVICE_ID !== "cc10a94f-b24b-47bc-ae5c-ec2a9307cfa0" ||
  env.PUBLIC_APP_URL !==
    "https://hometuition-preview.praksh-dhakal.workers.dev" ||
  !env.LIVEKIT_API_KEY ||
  !env.LIVEKIT_API_SECRET ||
  !env.LIVEKIT_URL ||
  env.IDENTITY_COLLECTION_ENABLED === "true"
)
  throw Error("Verified staging configuration required.");
const url = new URL(env.LIVEKIT_URL);
if (
  url.protocol !== "wss:" ||
  !url.hostname.endsWith(".livekit.cloud") ||
  url.username ||
  url.password
)
  throw Error("Expected LiveKit Cloud.");
const namespace = `audit-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
const room = roomNameForSession(1, namespace);
const client = new RoomServiceClient(
  url.href.replace(/^wss:/, "https:"),
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET,
  { requestTimeout: 8, failover: false },
);
let browser,
  server,
  created = false;
try {
  const appRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../sikshya",
  );
  const bundled = await build({
    stdin: {
      contents: `import {Room,RoomEvent} from 'livekit-client';
    window.connectSynthetic=async(url,token)=>{const room=new Room();window.syntheticRoom=room;
      room.on(RoomEvent.Disconnected,()=>window.wasDisconnected=true);
      try{await room.connect(url,token,{autoSubscribe:false,maxRetries:0});return true;}catch{return false;}};`,
      resolveDir: appRoot,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    logLevel: "silent",
  });
  server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(`<html><script>${bundled.outputFiles[0].text}</script></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await client.createRoom({
    name: room,
    emptyTimeout: 60,
    departureTimeout: 60,
    maxParticipants: 1,
  });
  created = true;
  const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: "999999999",
    ttl: 120,
    name: "Synthetic closure test",
  });
  token.addGrant({
    roomJoin: true,
    room,
    canSubscribe: false,
    canPublish: false,
    canPublishData: false,
  });
  const signed = await token.toJwt();
  browser = await (await getChromium()).launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const connected = await page.evaluate(
    ({ url, token }) => window.connectSynthetic(url, token),
    { url: env.LIVEKIT_URL, token: signed },
  );
  if (!connected) throw Error("Synthetic connection failed");
  console.log(
    "PASS synthetic participant joined isolated Cloud room without media",
  );
  const result = await revokeCloudParticipant(
    { sessionId: 1, userId: 999999999, url: env.LIVEKIT_URL, namespace },
    client,
  );
  if (!result.revoked) throw Error("Revocation failed");
  await page.waitForFunction(() => window.wasDisconnected === true);
  console.log("PASS provider removal disconnected the real Cloud participant");
  const rejoined = await page.evaluate(
    ({ url, token }) => window.connectSynthetic(url, token),
    { url: env.LIVEKIT_URL, token: signed },
  );
  if (rejoined) throw Error("Revoked token rejoined");
  console.log("PASS the original token cannot rejoin the isolated Cloud room");
  const absent = await revokeCloudParticipant(
    { sessionId: 1, userId: 999999999, url: env.LIVEKIT_URL, namespace },
    client,
  );
  if (!absent.revoked) throw Error("Absent participant retry failed");
  console.log("PASS already-absent participant revocation retry succeeds");
  await client.deleteRoom(room);
  created = false;
  console.log("Removed only the synthetic Cloud test room.");
  const removed = await revokeCloudParticipant(
    { sessionId: 1, userId: 999999999, url: env.LIVEKIT_URL, namespace },
    client,
  );
  if (!removed.revoked) throw Error("Removed room revocation retry failed");
  console.log("PASS already-removed room revocation retry succeeds");
} catch {
  console.error(
    "Cloud revocation proof failed; no success inferred and no private provider details printed.",
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (created) {
    try {
      await client.deleteRoom(room);
      console.log("Removed only the synthetic Cloud test room.");
    } catch {
      console.error(`Cleanup required for synthetic room ${room}`);
      process.exitCode = 1;
    }
  }
}
