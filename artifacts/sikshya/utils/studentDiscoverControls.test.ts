import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const discover = readFileSync(path.join(root, "app", "(student)", "index.tsx"), "utf8");

test("student Discover keeps sign-out beside the notification bell", () => {
  assert.match(discover, /testID="student-discover-logout"/);
  assert.match(discover, /accessibilityLabel="Sign out"/);
  assert.match(discover, /await logout\(\)/);
  assert.match(discover, /router\.replace\("\/welcome"\)/);
});
