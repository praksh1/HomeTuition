import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

// Execute the actual Daily adapter with an isolated environment and recording HTTP boundary.
// No API credentials, real rooms or network calls are used by this suite.
const compilation = build({
  stdin: { contents: 'export * from "../daily"; export * from "../dailyRoom"; export { sessionIdFromRoomName } from "../sessionProof/providerEvents";',
    resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "ts" },
  bundle: true, write: false, platform: "node", format: "cjs",
  plugins: [{ name: "quiet-logger", setup(builder) {
    builder.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: "logger", namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export const logger={info(){},warn(){},error(){}};" }));
  } }],
});

type Daily = {
  sanitizeRoomName(id: string): string;
  sessionIdFromRoomName(room: string): number | null;
  ensureDailyRoom(id: number): Promise<string>;
  createMeetingToken(id: number, options: { isOwner: boolean; userName: string; userId: number }): Promise<string | null>;
  ROOM_PROPERTIES: Record<string, boolean>;
};
type Call = { url: string; init: RequestInit };
async function adapter(env: Record<string, string>, answer: (call: Call) => Response = () => { throw new Error("Unexpected HTTP call"); }) {
  const calls: Call[] = [];
  const module = { exports: {} };
  runInNewContext((await compilation).outputFiles![0].text, { module, exports: module.exports,
    process: { env }, fetch: async (url: string, init: RequestInit) => { const call = { url, init }; calls.push(call); return answer(call); } });
  return { daily: module.exports as Daily, calls };
}
const options = { isOwner: false, userName: "Synthetic student", userId: 2 };
const isolated = { VIDEO_ROOM_NAMESPACE: "fadko-preview", DAILY_API_KEY: "synthetic-not-a-key" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("default Daily names and missing-key compatibility stay unchanged", async () => {
  const { daily, calls } = await adapter({});
  assert.equal(daily.sanitizeRoomName("42"), "sikshya42");
  assert.equal(daily.sessionIdFromRoomName("sikshya42"), 42);
  assert.equal(daily.sessionIdFromRoomName("fadko-preview-sikshya42"), null);
  assert.equal(await daily.ensureDailyRoom(42), "https://sikshya.daily.co/sikshya42");
  assert.equal(await daily.createMeetingToken(42, options), null);
  assert.equal(calls.length, 0);
});

test("preview refuses missing keys and malformed namespaces without any HTTP call", async () => {
  for (const env of [{ VIDEO_ROOM_NAMESPACE: "fadko-preview" }, { VIDEO_ROOM_NAMESPACE: "../bad" }]) {
    const { daily, calls } = await adapter(env);
    await assert.rejects(daily.ensureDailyRoom(42));
    await assert.rejects(daily.createMeetingToken(42, options));
    assert.equal(calls.length, 0);
  }
});

test("preview creates private isolated rooms and binds tokens/evidence to the same room", async () => {
  const { daily, calls } = await adapter(isolated, ({ url, init }) => {
    if (url.endsWith("/meeting-tokens")) return json({ token: "synthetic-token" });
    if (init.method === "POST") return json({ url: "https://example.daily.co/fadko-preview-sikshya42" });
    return json({}, 404);
  });
  await daily.ensureDailyRoom(42);
  assert.equal(await daily.createMeetingToken(42, options), "synthetic-token");
  assert.equal(await daily.createMeetingToken(42, { ...options, isOwner: true, userId: 1 }), "synthetic-token");
  const room = JSON.parse(String(calls[1].init.body));
  assert.equal(room.name, "fadko-preview-sikshya42");
  assert.equal(room.privacy, "private");
  assert.equal(room.properties.enable_knocking, false);
  assert.equal(room.properties.enable_chat, false);
  assert.equal(room.properties.enable_pip_ui, false);
  assert.equal(room.properties.enable_recording, undefined);
  for (const [index, owner] of [[2, false], [3, true]] as const) {
    const token = JSON.parse(String(calls[index].init.body)).properties;
    assert.equal(token.room_name, room.name);
    assert.equal(token.is_owner, owner);
    assert.ok(token.exp > Date.now() / 1000);
  }
  assert.equal(daily.sessionIdFromRoomName(room.name), 42);
  assert.equal(daily.sessionIdFromRoomName("sikshya42"), null);
  assert.equal(daily.sessionIdFromRoomName("other-preview-sikshya42"), null);
});

test("preview refuses existing public rooms, failed repairs and creation races", async () => {
  const publicRoom = await adapter(isolated, () => json({ url: "https://example.daily.co/fadko-preview-sikshya42", privacy: "public" }));
  await assert.rejects(publicRoom.daily.ensureDailyRoom(42), /not private/);
  assert.equal(publicRoom.calls.length, 1);
  const badRepair = await adapter(isolated, ({ init }) => init.method === "POST" ? json({}, 503) : json({ url: "https://example.daily.co/fadko-preview-sikshya42", privacy: "private", config: {} }));
  await assert.rejects(badRepair.daily.ensureDailyRoom(42), /could not be confirmed/);
  const race = await adapter(isolated, ({ init }) => init.method === "POST" ? new Response("already exists", { status: 400 }) : json({}, 404));
  await assert.rejects(race.daily.ensureDailyRoom(42), /try again/);
});

test("preview token errors never fall back to anonymous access or leak upstream text", async () => {
  for (const response of [json({ secret: "must-not-leak" }, 403), json({})]) {
    const { daily } = await adapter(isolated, () => response);
    await assert.rejects(daily.createMeetingToken(42, options), (error: unknown) => error instanceof Error
      ? /Preview video token could not be issued/.test(error.message) && !error.message.includes("must-not-leak")
      : /Preview video token could not be issued/.test(String(error)));
  }
});
