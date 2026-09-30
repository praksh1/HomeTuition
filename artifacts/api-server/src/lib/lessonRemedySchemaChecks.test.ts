import assert from "node:assert/strict";
import test from "node:test";
import { assertLessonRemedyStorage, REMEDY_STORAGE_COLUMNS, REMEDY_STORAGE_INDEXES, type RemedyStorageCatalog } from "./lessonRemedySchemaChecks.ts";

function valid(): RemedyStorageCatalog {
  return { cases: "lesson_remedy_cases", offers: "lesson_remedy_offers", events: "lesson_remedy_events",
    columns: Object.entries(REMEDY_STORAGE_COLUMNS).flatMap(([tableName, names]) => names.map(name => ({ tableName, name }))),
    indexes: REMEDY_STORAGE_INDEXES.map(index => ({ ...index, columns: [...index.columns],
      isUnique: true, isValid: true, isReady: true, isImmediate: true,
      predicate: index.predicate === "status='proposed'" ? "(status = 'proposed'::text)" :
        index.predicate === "accepted_atisnotnull" ? "(accepted_at IS NOT NULL)" : null })),
  };
}
test("storage absent everywhere is legacy; partial or unreadable storage never hides obligations", () => {
  assert.equal(assertLessonRemedyStorage({ cases: null, offers: null, events: null, columns: [], indexes: [] }), false);
  for (const missing of ["cases", "offers", "events"] as const) {
    const catalog = valid(); catalog[missing] = null;
    assert.throws(() => assertLessonRemedyStorage(catalog), /incomplete/);
  }
  assert.throws(() => assertLessonRemedyStorage(undefined), /could not be checked/);
  assert.equal(assertLessonRemedyStorage(valid()), true);
});
test("all runtime columns, including policy, identity, review clock and audit data, are mandatory", () => {
  for (const [tableName, names] of Object.entries(REMEDY_STORAGE_COLUMNS)) for (const name of names) {
    const catalog = valid(); catalog.columns = (catalog.columns as Array<{ tableName: string; name: string }>).filter(row => row.tableName !== tableName || row.name !== name);
    assert.throws(() => assertLessonRemedyStorage(catalog), /columns are incomplete/);
  }
});
test("missing, nonunique, invalid or differently keyed indexes cannot claim concurrency safety", () => {
  for (const expected of REMEDY_STORAGE_INDEXES) {
    const absent = valid(); absent.indexes = (absent.indexes as Array<{ name: string }>).filter(index => index.name !== expected.name);
    assert.throws(() => assertLessonRemedyStorage(absent), /uniqueness guards/);
    for (const changed of [ { isUnique: false }, { isValid: false }, { isReady: false }, { isImmediate: false },
      { columns: ["id"] }, { tableName: "unrelated" }, { predicate: "true" } ]) {
      const catalog = valid(); catalog.indexes = (catalog.indexes as Array<Record<string, unknown>>).map(index => index.name === expected.name ? { ...index, ...changed } : index);
      assert.throws(() => assertLessonRemedyStorage(catalog), /uniqueness guards/);
    }
  }
});
