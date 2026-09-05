import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOCK_TOLERANCE_MS,
  MAX_SAMPLES_PER_REQUEST,
  sanitiseQualitySamples,
} from "./telemetryBounds.ts";

const START = Date.UTC(2026, 8, 5, 10, 0, 0);
const END = START + 60 * 60 * 1000;
const WINDOW = { fromMs: START, toMs: END };

test("only the four known words survive; anything else becomes unknown", () => {
  const { accepted } = sanitiseQualitySamples([
    { quality: "good", observedAt: START },
    { quality: "warning", observedAt: START },
    { quality: "bad", observedAt: START },
    { quality: "unknown", observedAt: START },
    { quality: "catastrophic", observedAt: START },
    { quality: 5, observedAt: START },
    { quality: { nested: true }, observedAt: START },
    { observedAt: START },
  ], WINDOW);

  assert.deepEqual(accepted.map((s) => s.quality), [
    "good", "warning", "bad", "unknown", "unknown", "unknown", "unknown", "unknown",
  ]);
});

test("reconnect is only true when it is exactly true", () => {
  const { accepted } = sanitiseQualitySamples([
    { quality: "good", reconnect: true, observedAt: START },
    { quality: "good", reconnect: "true", observedAt: START },
    { quality: "good", reconnect: 1, observedAt: START },
    { quality: "good", observedAt: START },
  ], WINDOW);
  assert.deepEqual(accepted.map((s) => s.reconnect), [true, false, false, false]);
});

test("a sample from outside the class is refused", () => {
  const { accepted, rejected } = sanitiseQualitySamples([
    { quality: "bad", observedAt: START - 7 * 24 * 60 * 60 * 1000 },
    { quality: "bad", observedAt: END + 7 * 24 * 60 * 60 * 1000 },
    { quality: "good", observedAt: START + 60_000 },
  ], WINDOW);
  assert.equal(accepted.length, 1);
  assert.equal(rejected.outside_window, 2);
});

test("a modest clock skew is tolerated, because a wrong clock is common and not evidence", () => {
  const { accepted } = sanitiseQualitySamples([
    { quality: "good", observedAt: START - CLOCK_TOLERANCE_MS + 1000 },
    { quality: "good", observedAt: END + CLOCK_TOLERANCE_MS - 1000 },
  ], WINDOW);
  assert.equal(accepted.length, 2);
});

test("an unparseable timestamp is counted, not thrown", () => {
  const { accepted, rejected } = sanitiseQualitySamples([
    { quality: "good", observedAt: "yesterday" },
    { quality: "good" },
    { quality: "good", observedAt: null },
    { quality: "good", observedAt: START },
  ], WINDOW);
  assert.equal(accepted.length, 1);
  assert.equal(rejected.bad_timestamp, 3);
});

test("one bad sample does not discard the whole report", () => {
  // A caller that gets a 400 for one skewed sample retries the same body forever.
  const { accepted, rejected } = sanitiseQualitySamples([
    "not an object",
    null,
    [],
    { quality: "bad", observedAt: START + 1000 },
  ], WINDOW);
  assert.equal(accepted.length, 1);
  assert.equal(rejected.not_an_object, 3);
});

test("an oversized batch is truncated rather than refused", () => {
  const many = Array.from({ length: MAX_SAMPLES_PER_REQUEST + 40 }, () => ({ quality: "good", observedAt: START }));
  const { accepted, truncated } = sanitiseQualitySamples(many, WINDOW);
  assert.equal(accepted.length, MAX_SAMPLES_PER_REQUEST);
  assert.equal(truncated, true);
});

test("a body that is not a list yields nothing and does not throw", () => {
  for (const body of [null, undefined, {}, "samples", 42]) {
    const r = sanitiseQualitySamples(body, WINDOW);
    assert.deepEqual(r.accepted, []);
    assert.equal(r.truncated, false);
  }
});

test("nothing a client sends beyond the three known fields is kept", () => {
  // The privacy bound: no addresses, device ids, or raw WebRTC statistics.
  const { accepted } = sanitiseQualitySamples([{
    quality: "bad",
    observedAt: START,
    reconnect: false,
    ip: "203.0.113.9",
    deviceId: "abc-123",
    stats: { jitter: 44, packetsLost: 900, candidates: ["host"] },
    audioLevel: 0.4,
  }], WINDOW);
  assert.deepEqual(Object.keys(accepted[0]!).sort(), ["observedAtMs", "quality", "reconnect"]);
});

test("timestamps arrive in seconds or milliseconds and land in the same place", () => {
  const { accepted } = sanitiseQualitySamples([
    { quality: "good", observedAt: Math.floor((START + 1000) / 1000) },
    { quality: "good", observedAt: START + 1000 },
    { quality: "good", observedAt: new Date(START + 1000).toISOString() },
  ], WINDOW);
  assert.deepEqual(accepted.map((s) => s.observedAtMs), [START + 1000, START + 1000, START + 1000]);
});
