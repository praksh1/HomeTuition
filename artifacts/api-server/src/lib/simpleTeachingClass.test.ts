import assert from "node:assert/strict";
import test from "node:test";
import { readClassDescription } from "./simpleTeachingClass.ts";
import { readSnapshot, simpleClassSnapshot } from "./learningProgramState.ts";
const description = {
  title: "SEE Maths evening tuition",
  summary: "We solve school exercises together and leave time for questions.",
  teachingLanguage: "Nepali and English",
  outline: "",
};
test("an ordinary class needs no invented outcome, level or learning path", () => {
  assert.equal(readClassDescription(description).ok, true);
  const snapshot = simpleClassSnapshot(description, 1);
  assert.deepEqual(readSnapshot(snapshot), snapshot);
  assert.equal(snapshot.outcome, "");
  assert.deepEqual(snapshot.modules, []);
});
test("outline is optional, trimmed and bounded", () => {
  const { outline, ...minimal } = description;
  assert.deepEqual(readClassDescription(minimal), {
    ok: true,
    value: description,
  });
  assert.equal(
    readClassDescription({ ...description, outline: "x".repeat(2001) }).ok,
    false,
  );
  assert.equal(readClassDescription({ ...description, outline: 5 }).ok, false);
});
test("short and malformed descriptions still fail instead of publishing empty listings", () => {
  for (const bad of [
    null,
    [],
    {},
    { ...description, title: "a" },
    { ...description, summary: "Maths" },
    { ...description, teachingLanguage: 6 },
  ])
    assert.equal(readClassDescription(bad).ok, false);
});
test("lightweight mode cannot relax the old formal snapshot contract", () => {
  const simple = simpleClassSnapshot(description, 1);
  const { presentation, ...old } = simple;
  assert.equal(readSnapshot(old), null);
  assert.equal(readSnapshot({ ...simple, presentation: "unknown" }), null);
  for (const version of [0, -1, 1.5, "1", Infinity])
    assert.equal(readSnapshot({ ...simple, version }), null);
});
test("class snapshots cannot invent endorsement or learning outcomes", () => {
  const simple = simpleClassSnapshot(description, 1);
  for (const patch of [
    { referenceSource: "official" },
    { modules: [{}] },
    { outcome: "Guaranteed success" },
    { type: "exam_preparation" },
  ])
    assert.equal(readSnapshot({ ...simple, ...patch }), null);
});
test("exam guarantees are refused", () => {
  assert.equal(
    readClassDescription({
      ...description,
      summary: "You will pass your exams with our lessons.",
    }).ok,
    false,
  );
});
