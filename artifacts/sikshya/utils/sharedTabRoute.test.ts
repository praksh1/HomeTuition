import assert from "node:assert/strict";
import test from "node:test";
import { sharedTabRoute } from "./sharedTabRoute.ts";

test("ambiguous web paths keep the chosen tab for both restored roles", () => {
  for (const role of ["teacher", "student"]) {
    const other = role === "teacher" ? "student" : "teacher";
    for (const tab of ["messages", "sessions", "profile"]) {
      assert.equal(sharedTabRoute(role, [`(${other})`, tab]), `/(${role})/${tab}`);
      assert.equal(sharedTabRoute(role, [`(${role})`, tab]), null);
    }
  }
});

test("no role bypass, arbitrary URL redirect or remapping of private screens", () => {
  for (const segments of [[], ["(student)"], ["(student)", "payments"], ["(student)", "teacher", "1"], ["conversation", "1"], ["(student)", "messages", "extra"], ["https://evil.example", "messages"]]) {
    assert.equal(sharedTabRoute("teacher", segments), null);
  }
  assert.equal(sharedTabRoute("admin", ["(student)", "messages"]), null);
  assert.equal(sharedTabRoute("guest", ["(teacher)", "messages"]), null);
});
