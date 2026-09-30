import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

const source = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");

test("operator and participant make-ups have distinct reload-safe public paths", () => {
  assert.equal(existsSync(new URL("../app/(admin)/makeups.tsx", import.meta.url)), false);
  assert.match(source("../app/(admin)/operator-makeups.tsx"), /<MakeupsWorkspace operator\s*\/>/);
  assert.match(source("../app/makeups.tsx"), /export \{ default \} from "@\/components\/classes\/MakeupsWorkspace"/);
});

test("operator dashboard and hidden tab select the unique operator route", () => {
  assert.match(source("../app/(admin)/_layout.tsx"), /name="operator-makeups"/);
  assert.doesNotMatch(source("../app/(admin)/_layout.tsx"), /name="makeups"/);
  assert.match(source("../app/(admin)/index.tsx"), /router\.push\("\/\(admin\)\/operator-makeups"\)/);
  assert.doesNotMatch(source("../app/(admin)/index.tsx"), /"\/\(admin\)\/makeups"/);
});

test("removing a lesson filter preserves operator mode without changing participant links", () => {
  assert.match(source("../components/classes/MakeupsWorkspace.tsx"), /pathname: operator \? "\/\(admin\)\/operator-makeups" : "\/makeups"/);
  assert.doesNotMatch(source("../components/classes/MakeupsWorkspace.tsx"), /"\/\(admin\)\/makeups"/);
});
