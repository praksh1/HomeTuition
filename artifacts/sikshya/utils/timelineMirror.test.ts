import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  DOORS_OPEN_MINUTES,
  OVERTIME_CUTOFF_MINUTES,
  STUDENT_GRACE_MINUTES,
  WRAP_UP_WARNING_MINUTES,
} from "./sessionWindow.ts";

/**
 * The app's copy of the timeline must match the server's.
 *
 * The two packages deliberately do not share code, so the app carries a mirror of
 * api-server/src/lib/sessionStart.ts. A mirror that drifts is the worst kind of bug here: the
 * screen offers a class the server refuses, or greys out one the server would allow, and both
 * halves look correct in isolation. Nothing else would notice — every test on each side keeps
 * passing.
 *
 * So this reads the server's file and compares the numbers, rather than trusting a comment
 * that says they match.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const serverFile = path.resolve(here, "..", "..", "api-server", "src", "lib", "sessionStart.ts");

function serverConstant(name: string): number {
  const source = readFileSync(serverFile, "utf8");
  const match = source.match(new RegExp("export const " + name + " = (\\d+);"));
  assert.ok(match, `${name} is not declared in ${serverFile} — did it get renamed?`);
  return Number(match[1]);
}

test("the doors open at the same moment on both sides", () => {
  assert.equal(DOORS_OPEN_MINUTES, serverConstant("DOORS_OPEN_MINUTES"));
});

test("the student's door shuts at the same moment on both sides", () => {
  assert.equal(STUDENT_GRACE_MINUTES, serverConstant("STUDENT_GRACE_MINUTES"));
});

test("the call stops at the same moment on both sides", () => {
  assert.equal(OVERTIME_CUTOFF_MINUTES, serverConstant("OVERTIME_CUTOFF_MINUTES"));
});

test("the wrap-up warning fires at the same moment on both sides", () => {
  assert.equal(WRAP_UP_WARNING_MINUTES, serverConstant("WRAP_UP_WARNING_MINUTES"));
});
