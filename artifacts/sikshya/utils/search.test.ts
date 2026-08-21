import assert from "node:assert/strict";
import { test } from "node:test";
import { matches, normalise, score } from "./search.ts";

const TEACHER = "Ram Prasad Sharma";

test("the reported spellings all find Ram Prasad", () => {
  // Typed by the owner, verbatim, as the cases that were failing.
  for (const query of ["RamPrasad", "ram p rasa d", "ram pra sad", "r ampr asad"]) {
    assert.equal(matches(TEACHER, query), true, `"${query}" should find ${TEACHER}`);
  }
});

test("the ordinary spellings still work", () => {
  for (const query of ["Ram", "ram prasad", "RAM PRASAD SHARMA", "sharma", " ram  "]) {
    assert.equal(matches(TEACHER, query), true, `"${query}" should find ${TEACHER}`);
  }
});

test("words can be given in any order", () => {
  assert.equal(matches(TEACHER, "prasad ram"), true);
  assert.equal(matches(TEACHER, "sharma ram"), true);
});

test("someone else's name is not a match", () => {
  assert.equal(matches(TEACHER, "sunita"), false);
  assert.equal(matches(TEACHER, "ram bahadur thapa"), false, "a different person sharing one name");
});

test("an empty search shows everyone", () => {
  assert.equal(matches(TEACHER, ""), true);
  assert.equal(matches(TEACHER, "   "), true);
});

test("punctuation and accents do not get in the way", () => {
  assert.equal(matches("Rám-Prasád (Sharma)", "ram prasad"), true);
  assert.equal(matches(TEACHER, "ram.prasad"), true);
});

test("normalising keeps only letters and digits", () => {
  assert.equal(normalise("  Ram P. Sharma-2 "), "rampsharma2");
  assert.equal(normalise("गणित"), "");
});

test("a closer match scores higher", () => {
  const name = [{ value: TEACHER, weight: 3 }];
  assert.ok(score(name, "Ram Prasad Sharma") > score(name, "Ram"), "exact beats prefix");
  assert.ok(score(name, "Ram") > score(name, "Sharma"), "prefix beats contains");
  assert.equal(score(name, "sunita"), 0, "no match scores nothing");
});

test("a name match outranks a match buried in a bio", () => {
  const fields = [
    { value: TEACHER, weight: 3 },
    { value: "I studied under Ram Prasad for six years", weight: 1 },
  ];
  const other = [
    { value: "Sunita Thapa", weight: 3 },
    { value: "I studied under Ram Prasad for six years", weight: 1 },
  ];
  assert.ok(score(fields, "ram prasad") > score(other, "ram prasad"));
});

test("ignoring spaces can match across two words, and that is the trade", () => {
  // Squashing the spaces is what makes "r ampr asad" work, and the same squashing lets a
  // query straddle a word boundary. Written down rather than glossed over: "aram" finds
  // "Sita Ram" because the letters run together once the space is gone. When the job is
  // finding a half-remembered name, this is the right side to err on.
  assert.equal(matches("Sita Ram", "aram"), true);
  // An unrelated name is still not a match, which is the part that matters.
  assert.equal(matches("Sunita Thapa", "ram"), false);
  assert.equal(matches("Bikash Gurung", "prasad"), false);
});
