import assert from "node:assert/strict";
import test from "node:test";
import { teachingClassDeletionIssue } from "./teachingClassDeletion.ts";

const emptyDraft = {
  batchStatus: "draft", batchPublishedAt: null, batchPublishedSnapshot: null,
  hasTestContract: false, hasTestBooking: false, isInitialBatch: true,
  hasSibling: false, hasProgramEnrollment: false,
  programStatus: "draft", programPublishedAt: null, programPublishedSnapshot: null,
};

test("a never-published, unbooked initial draft can be deleted", () => {
  assert.equal(teachingClassDeletionIssue(emptyDraft), null);
});

test("a renewal draft can be deleted without erasing its published parent class", () => {
  assert.equal(teachingClassDeletionIssue({ ...emptyDraft, isInitialBatch: false,
    hasSibling: true, programStatus: "published", programPublishedAt: new Date(),
    programPublishedSnapshot: { title: "Earlier class" } }), null);
});

test("published and once-published batches cannot be deleted", () => {
  for (const change of [
    { batchStatus: "published" },
    { batchStatus: "closed" },
    { batchPublishedAt: new Date() },
    { batchPublishedSnapshot: { lessons: [] } },
  ]) assert.match(teachingClassDeletionIssue({ ...emptyDraft, ...change })!, /unpublished/);
});

test("a draft with enrollment evidence or another dated offer cannot be deleted", () => {
  for (const change of [
    { hasTestBooking: true },
    { hasTestContract: true },
    { hasProgramEnrollment: true },
    { hasSibling: true },
  ]) assert.notEqual(teachingClassDeletionIssue({ ...emptyDraft, ...change }), null);
});
