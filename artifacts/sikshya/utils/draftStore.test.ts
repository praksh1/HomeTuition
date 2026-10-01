import assert from "node:assert/strict";
import test from "node:test";
import { createDraftStore } from "./draftStore.ts";

test("simultaneous drafts in separate conversations cannot erase one another", async () => {
  let value: string | null = null;
  const store = createDraftStore({ getItem: async () => value, setItem: async (_key, next) => { value = next; } }, "drafts");
  await Promise.all([store.saveDraft(11, "Math question"), store.saveDraft("class:12", "Homework question")]);
  assert.deepEqual(await store.loadDrafts(), { "11": "Math question", "class:12": "Homework question" });
});
test("a delayed older save cannot resurrect text cleared by Send", async () => {
  let value: string | null = null;
  let release!: () => void;
  let started!: () => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  let writes = 0;
  const store = createDraftStore({ getItem: async () => value, setItem: async (_key, next) => {
    if (++writes === 1) await new Promise<void>(resolve => { release = resolve; started(); });
    value = next;
  } }, "drafts");
  const saving = store.saveDraft(11, "Sent words");
  await writing;
  const clearing = store.clearDraft(11);
  release();
  await Promise.all([saving, clearing]);
  assert.equal(await store.getDraft(11), "");
});
test("a new message written after Send survives clearing the previous message", async () => {
  let value: string | null = null;
  const store = createDraftStore({ getItem: async () => value, setItem: async (_key, next) => { value = next; } }, "drafts");
  await Promise.all([store.saveDraft(11, "First message"), store.clearDraft(11), store.saveDraft(11, "Next message")]);
  assert.equal(await store.getDraft(11), "Next message");
});
test("invalid stored content and unavailable storage fail quietly", async () => {
  for (const value of ["broken json", "[]", "null", '{"11":42}']) {
    const store = createDraftStore({ getItem: async () => value, setItem: async () => { throw new Error("quota"); } }, "drafts");
    assert.deepEqual(await store.loadDrafts(), {});
    await store.saveDraft(11, "Unsent message");
  }
  const store = createDraftStore({ getItem: async () => { throw new Error("unavailable"); }, setItem: async () => { throw new Error("unavailable"); } }, "drafts");
  assert.equal(await store.getDraft(11), "");
  await store.clearDraft(11);
});
