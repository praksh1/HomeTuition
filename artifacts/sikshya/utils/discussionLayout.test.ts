import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOLD_MS,
  planDiscussionLayout,
  rememberSpeakers,
  tileCapacity,
  type LayoutPerson,
  type SpeakerMemory,
} from "./discussionLayout.ts";

/**
 * The rules that decide what a discussion costs.
 *
 * Every assertion here is about one of two things: a stream nobody is looking at being paid for,
 * or a grid that reshuffles under a teacher's thumb. Both are only reproducible with ten people in
 * a live class, which is why they are here instead.
 */

const NOW = 1_700_000_000_000;

const p = (id: string, over: Partial<LayoutPerson> = {}): LayoutPerson => ({
  id, isLocal: false, hasCamera: true, isSpeaking: false, ...over,
});

const plan = (people: LayoutPerson[], over: Partial<Parameters<typeof planDiscussionLayout>[0]> = {}) =>
  planDiscussionLayout({
    people, teacherId: "T", spotlightId: null, memory: {}, now: NOW, capacity: 4, ...over,
  });

/* --- capacity ------------------------------------------------------------- */

test("a phone carries four tiles, and a laptop more", () => {
  assert.equal(tileCapacity(390), 4);
  assert.equal(tileCapacity(412), 4);
  assert.equal(tileCapacity(768), 6);
  assert.equal(tileCapacity(1440), 9);
});

/* --- who is never dropped -------------------------------------------------- */

test("the teacher keeps a tile however many students are talking", () => {
  const people = [p("T"), p("me", { isLocal: true }), p("a"), p("b"), p("c"), p("d"), p("e")];
  const out = plan(people, { memory: { a: NOW, b: NOW, c: NOW, d: NOW, e: NOW } });
  assert.ok(out.visible.includes("T"), out.visible.join(","));
  assert.ok(out.visible.includes("me"), "and so does your own tile, which costs no download");
  assert.equal(out.visible.length, 4);
});

test("a featured student outranks anything automatic", () => {
  const people = [p("T"), p("a", { isSpeaking: true }), p("b", { isSpeaking: true }), p("z")];
  const out = plan(people, { spotlightId: "z", capacity: 3 });
  assert.ok(out.visible.includes("z"), out.visible.join(","));
  assert.equal(out.quality.z, "high", "the featured tile is the large one");
});

test("with nobody featured, the teacher gets the large tile", () => {
  const out = plan([p("T"), p("a"), p("b"), p("c")]);
  assert.equal(out.quality.T, "high");
  assert.equal(out.quality.a, "low", "a thumbnail asks for the layer already being sent");
});

/* --- the money ------------------------------------------------------------- */

test("a camera nobody has a tile for is not subscribed to", () => {
  const people = [p("T"), p("me", { isLocal: true }), p("a"), p("b"), p("c"), p("d")];
  const out = plan(people, { capacity: 4 });
  // T, a, b, c, d are the five remote cameras; the local one is never counted.
  assert.equal(out.subscribe.length + out.unsubscribe.length, 5);
  assert.ok(out.unsubscribe.length > 0, "somebody must be dropped at capacity 4");
  for (const id of out.unsubscribe) assert.equal(out.visible.includes(id), false);
});

test("ten people on a phone cost four streams, not nine", () => {
  const people = [p("T"), p("me", { isLocal: true }), ...["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => p(id))];
  const out = plan(people, { capacity: 4 });
  // Four tiles, one of which is this person's own camera and is never downloaded.
  assert.equal(out.subscribe.length, 3, out.subscribe.join(","));
  assert.equal(out.unsubscribe.length, 6, out.unsubscribe.join(","));
  assert.equal(out.overflow, 6);
});

test("somebody sending no camera takes a tile and no bandwidth", () => {
  const people = [p("T"), p("a", { hasCamera: false }), p("b")];
  const out = plan(people, { capacity: 4 });
  assert.ok(out.visible.includes("a"));
  assert.equal(out.subscribe.includes("a"), false, "there is nothing to subscribe to");
});

test("your own camera is never subscribed to — it is already in this browser", () => {
  const out = plan([p("T"), p("me", { isLocal: true })]);
  assert.equal(out.subscribe.includes("me"), false);
  assert.equal(out.unsubscribe.includes("me"), false);
});

/* --- the grid settling ----------------------------------------------------- */

test("who spoke most recently gets the spare tiles", () => {
  const people = [p("T"), p("quiet"), p("recent"), p("older")];
  const memory: SpeakerMemory = { recent: NOW - 500, older: NOW - 30_000 };
  const out = plan(people, { memory, capacity: 3 });
  assert.deepEqual(out.visible, ["T", "recent", "older"], out.visible.join(","));
  assert.equal(out.visible.includes("quiet"), false,
    "thirty seconds ago still beats never having spoken");
});

test("a tile is not taken from somebody who stopped talking a second ago", () => {
  const people = [p("T"), p("holding"), p("newcomer", { isSpeaking: true })];
  const memory: SpeakerMemory = { holding: NOW - 1000, newcomer: NOW };
  const out = plan(people, { memory, capacity: 2 });
  assert.deepEqual(out.visible, ["T", "holding"],
    `a grid that swapped here would move a tile under a teacher's thumb: ${out.visible.join(",")}`);
});

test("but it is taken once they have been quiet long enough", () => {
  const people = [p("T"), p("stale"), p("newcomer", { isSpeaking: true })];
  const memory: SpeakerMemory = { stale: NOW - HOLD_MS * 3, newcomer: NOW };
  const out = plan(people, { memory, capacity: 2 });
  assert.deepEqual(out.visible, ["T", "newcomer"], out.visible.join(","));
});

test("somebody who has never spoken sorts last, whatever their name", () => {
  const people = [p("T"), p("aaa"), p("zzz")];
  const out = plan(people, { memory: { zzz: NOW }, capacity: 2 });
  assert.deepEqual(out.visible, ["T", "zzz"]);
});

test("two people who have never spoken are ordered stably, not by arrival", () => {
  const first = plan([p("T"), p("b"), p("a")], { capacity: 3 });
  const second = plan([p("T"), p("a"), p("b")], { capacity: 3 });
  assert.deepEqual(first.visible, second.visible, "the same class must draw the same grid");
});

/* --- the memory ------------------------------------------------------------ */

test("speaking is written down, and silence leaves the last time alone", () => {
  const people = [p("a", { isSpeaking: true }), p("b")];
  const memory = rememberSpeakers({ b: NOW - 5000 }, people, NOW);
  assert.equal(memory.a, NOW);
  assert.equal(memory.b, NOW - 5000);
});

test("somebody who leaves stops competing for a tile", () => {
  const memory = rememberSpeakers({ gone: NOW, here: NOW - 1000 }, [p("here")], NOW);
  assert.equal("gone" in memory, false,
    "otherwise a student who dropped an hour ago outranks one who just arrived");
});

test("a frame where nothing changed returns the same object, so React does not re-render", () => {
  const memory: SpeakerMemory = { a: NOW };
  assert.equal(rememberSpeakers(memory, [p("a")], NOW), memory);
});
