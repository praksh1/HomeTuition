import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const screen = readFileSync(
  path.resolve(here, "../app/(teacher)/monthly.tsx"),
  "utf8",
);
const serverRules = readFileSync(
  path.resolve(here, "../../api-server/src/lib/monthly.ts"),
  "utf8",
);
const compactScreen = screen.replace(/\s+/g, " ");

function controlBlock(testIdFragment: string): string {
  const start = screen.indexOf(testIdFragment);
  assert.notEqual(start, -1, `control ${testIdFragment} was not found`);
  const end = screen.indexOf("</TouchableOpacity>", start);
  assert.notEqual(end, -1, `control ${testIdFragment} has no closing tag`);
  return screen.slice(start, end);
}

test("the teacher delivery-floor copy stays pinned to the server rule", () => {
  const uiFloor = /const DELIVERY_FLOOR = (\d+);/.exec(screen)?.[1];
  const serverFloor = /export const MIN_SESSIONS_PER_CYCLE = (\d+);/.exec(
    serverRules,
  )?.[1];

  assert.ok(uiFloor, "teacher screen delivery floor was not found");
  assert.ok(serverFloor, "server delivery floor was not found");
  assert.equal(uiFloor, serverFloor);
});

test("a failed plan request cannot turn into a fabricated plan price", () => {
  assert.doesNotMatch(screen, /tierPrice\s*\?\?/);
  assert.doesNotMatch(screen, /tierPrice[^\n]*6500|6500[^\n]*tierPrice/);
  assert.match(screen, /view && !view\.plan/);
  assert.match(screen, /amount=\{view\.tierPrice\}/);
});

test("every monthly write keeps its exact endpoint and request-body field set", () => {
  assert.match(
    compactScreen,
    /await apiPost\("\/monthly\/plan", \{ paymentMethod: method \}\);/,
  );
  assert.match(
    compactScreen,
    /await apiPost\("\/monthly\/classes", \{ subject: subject\.trim\(\), topic: topic\.trim\(\), startMinute, durationMinutes: minutes, monthlyPrice: price, maxStudents, \}\);/,
  );
  assert.match(
    compactScreen,
    /await apiPost\(`\/monthly\/classes\/\$\{klass\.id\}\/makeups`, \{ missedDayId, localDate: gregorianDayKey\(date\), startMinute, \}\);/,
  );
  assert.match(
    compactScreen,
    /await apiPost<\{ note: string \}>\("\/monthly\/leave", \{ startsAt: from\.toISOString\(\), endsAt: to\.toISOString\(\), reason: reason\.trim\(\) \|\| undefined, \}\);/,
  );
  assert.match(
    compactScreen,
    /await apiDelete\(`\/monthly\/leave\/\$\{id\}`\);/,
  );
});

test("write success transitions and navigation destinations remain pinned", () => {
  assert.match(
    compactScreen,
    /await apiPost\("\/monthly\/plan", \{ paymentMethod: method \}\); setBuying\(false\); setLoading\(true\); await load\(\);/,
  );
  assert.match(
    compactScreen,
    /await apiPost\("\/monthly\/classes", \{[^}]+\}\); await onCreated\(\);/,
  );
  assert.match(
    compactScreen,
    /await apiPost\(`\/monthly\/classes\/\$\{klass\.id\}\/makeups`, \{[^}]+\}\); await onSaved\(\);/,
  );
  assert.match(
    compactScreen,
    /setNote\(res\.note\); setFrom\(null\); setTo\(null\); setReason\(""\); setOpen\(false\); await load\(\);/,
  );
  assert.match(
    compactScreen,
    /await apiDelete\(`\/monthly\/leave\/\$\{id\}`\); await load\(\);/,
  );
  assert.match(compactScreen, /onPress=\{\(\) => router\.back\(\)\}/);
  assert.match(
    compactScreen,
    /router\.push\(`\/session\/\$\{klass\.today!\.sessionId\}`\)/,
  );
  assert.match(
    compactScreen,
    /pathname: "\/monthly-chat", params: \{ id: String\(klass\.id\) \}/,
  );
  assert.match(
    compactScreen,
    /pathname: "\/monthly-homework", params: \{ id: String\(klass\.id\) \}/,
  );
});

test("teacher and student prices name the 30-day unit", () => {
  assert.match(screen, /per 30-day cycle, paid to Fadko/);
  assert.match(screen, /Student fee per 30-day cycle \(NPR\)/);
  assert.match(
    screen,
    /NPR \$\{klass\.monthlyPrice\.toLocaleString\("en-IN"\)\} per 30-day cycle/,
  );
});

test("cycle and make-up copy does not promise behavior the current server contradicts", () => {
  assert.doesNotMatch(
    compactScreen,
    /cycle normally starts|unused-plan clock|Any future day and time is allowed/,
  );
  assert.match(compactScreen, /Saving this form creates the daily schedule/);
  assert.match(compactScreen, /Fadko will check the available make-up allowance/);
  assert.match(compactScreen, /declared leave and overlaps with other classes/);
});

test("the running screen has one filled primary action when make-up editing is open", () => {
  const today = controlBlock("teacher-monthly-today-");
  const makeUpSave = controlBlock("monthly-makeup-save-");

  assert.match(today, /backgroundColor: colors\.primary/);
  assert.match(makeUpSave, /borderColor: colors\.primary/);
  assert.match(makeUpSave, /backgroundColor: colors\.card/);
  assert.doesNotMatch(makeUpSave, /backgroundColor: colors\.primary/);
});

test("every shared class field derives its accessible name from its visible label", () => {
  const fieldStart = screen.indexOf("function Field(");
  const fieldEnd = screen.indexOf("function RunningClass(", fieldStart);
  const field = screen.slice(fieldStart, fieldEnd);

  assert.match(field, /<Text[^>]*>\{label\}<\/Text>/);
  assert.match(field, /<TextInput[\s\S]*accessibilityLabel=\{label\}/);
});
