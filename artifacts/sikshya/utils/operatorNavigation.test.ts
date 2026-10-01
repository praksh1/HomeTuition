import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { operatorAccessRejected, operatorDestination } from "./operatorNavigation.ts";

const appRoot = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);

test("only an operator with a private password reaches the desk", () => {
  for (const first of ["(admin)", "notifications", "password", "missing"]) {
    assert.equal(operatorDestination(null, false, first), "/login");
    assert.equal(operatorDestination("teacher", false, first), "/login");
    assert.equal(operatorDestination("student", false, first), "/login");
  }
  assert.equal(operatorDestination(null, false, "index"), "/login");
  assert.equal(operatorDestination(null, false, "login"), null);
  assert.equal(operatorDestination("admin", true, "(admin)"), "/password");
  assert.equal(operatorDestination("admin", true, "notifications"), "/password");
  assert.equal(operatorDestination("admin", true, "password"), null);
  assert.equal(operatorDestination("admin", false, "index"), "/(admin)");
  assert.equal(operatorDestination("admin", false, "login"), "/(admin)");
  assert.equal(operatorDestination("admin", false, "password"), "/(admin)");
  assert.equal(operatorDestination("admin", false, "(admin)"), null);
});

test("temporary network and server failures never invalidate an operator session", () => {
  for (const status of [0, 408, 429, 500, 502, 503, 504]) assert.equal(operatorAccessRejected({ status }), false);
  assert.equal(operatorAccessRejected(new Error("offline")), false);
  assert.equal(operatorAccessRejected(null), false);
  assert.equal(operatorAccessRejected({ status: 401 }), true);
  assert.equal(operatorAccessRejected({ status: 403 }), true);
});

test("separate config leaves ordinary participant/native builds untouched", () => {
  const configFactory = require("../app.config.js");
  const previous = process.env.OPERATOR_BUILD;
  const base = { name: "Fadko", plugins: ["expo-router"], extra: { existing: true }, web: { output: "single" }, ios: { bundleIdentifier: "com.fadko.app" } };
  try {
    delete process.env.OPERATOR_BUILD;
    assert.equal(configFactory({ config: base }), base);
    process.env.OPERATOR_BUILD = "1";
    const operator = configFactory({ config: base });
    assert.equal(operator.name, "Fadko Desk");
    assert.equal(operator.extra.router.root, "./app-operator");
    assert.equal(operator.extra.existing, true);
    assert.equal(operator.ios.bundleIdentifier, "com.fadko.app");
    assert.deepEqual(operator.plugins[0], ["expo-router", { root: "./app-operator" }]);
    const tuple = configFactory({ config: { ...base, plugins: [["expo-router", { existing: "kept" }]] } });
    assert.equal(tuple.plugins[0][1].existing, "kept");
    assert.equal(tuple.plugins[0][1].root, "./app-operator");
  } finally {
    if (previous === undefined) delete process.env.OPERATOR_BUILD;
    else process.env.OPERATOR_BUILD = previous;
  }
});

test("desk route wrappers reference existing screens including original-payment make-up review", () => {
  const routes = path.join(appRoot, "app-operator", "(admin)");
  const wrappers = [...readdirSync(routes).filter(file => file.endsWith(".tsx")).map(file => path.join(routes, file)),
    path.join(routes, "person", "[id].tsx"), path.join(routes, "ticket", "[id].tsx")];
  for (const file of wrappers) {
    const source = readFileSync(file, "utf8");
    const relative = source.match(/from "(\.[^"]+)"/)?.[1];
    assert.ok(relative, `No re-export target in ${file}`);
    assert.ok(existsSync(path.resolve(path.dirname(file), relative + ".tsx")), `Missing re-export ${relative}`);
  }
  assert.ok(existsSync(path.join(routes, "operator-makeups.tsx")));
  assert.ok(!existsSync(path.join(appRoot, "app-operator", "(auth)")), "Participant sign-in is not part of this route tree");
});

test("login restoration and guard failures remain recoverable without a hard refresh", () => {
  const login = readFileSync(path.join(appRoot, "app-operator", "login.tsx"), "utf8");
  const guard = readFileSync(path.join(appRoot, "app-operator", "_layout.tsx"), "utf8");
  assert.match(login, /\/operator\/login/);
  assert.match(login, /await retryStartup\(\)/);
  assert.doesNotMatch(login, /clearToken/);
  assert.match(guard, /operatorAccessRejected\(error\)/);
  assert.match(guard, /setProblem\(true\)/);
  assert.match(guard, /Retry the operator connection/);
  assert.doesNotMatch(guard, /if \(isLoading \|\| !checked\) return/);
});
