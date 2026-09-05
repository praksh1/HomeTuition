import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evidenceCoverage,
  type PresenceEvidence,
  type SessionEvidenceSources,
} from "./evidenceCoverage.ts";

function present(over: Partial<PresenceEvidence> = {}): PresenceEvidence {
  return { availability: "available", teacherPresentMs: 60 * 60_000, teacherJoinCount: 1, ...over };
}

function sources(over: Partial<SessionEvidenceSources> = {}): SessionEvidenceSources {
  return { classroomSocket: present(), mediaProvider: present(), ...over };
}

test("two independent available sources are sufficient for a person to review", () => {
  assert.deepEqual(evidenceCoverage(sources()), {
    reviewability: "sufficient_for_human_review",
    gaps: [],
    contradictions: [],
  });
});

test("an unreadable provider is incomplete, never equivalent to seeing nobody", () => {
  const result = evidenceCoverage(sources({
    mediaProvider: present({ availability: "unavailable", teacherPresentMs: 0, teacherJoinCount: 0 }),
  }));
  assert.equal(result.reviewability, "incomplete");
  assert.deepEqual(result.gaps, ["media_provider_unavailable"]);
  assert.deepEqual(result.contradictions, []);
});

test("an unreadable socket ledger is incomplete", () => {
  const result = evidenceCoverage(sources({
    classroomSocket: present({ availability: "unavailable", teacherPresentMs: 0, teacherJoinCount: 0 }),
  }));
  assert.equal(result.reviewability, "incomplete");
  assert.deepEqual(result.gaps, ["classroom_socket_unavailable"]);
});

test("a partial source remains incomplete even when it contains presence", () => {
  const result = evidenceCoverage(sources({ mediaProvider: present({ availability: "partial" }) }));
  assert.equal(result.reviewability, "incomplete");
  assert.deepEqual(result.gaps, ["media_provider_partial"]);
});

test("two available sources that both saw no teacher agree on the fact", () => {
  const absent = present({ teacherPresentMs: 0, teacherJoinCount: 0 });
  const result = evidenceCoverage(sources({ classroomSocket: absent, mediaProvider: absent }));
  assert.equal(result.reviewability, "sufficient_for_human_review");
  assert.deepEqual(result.contradictions, []);
});

test("provider presence without classroom-socket presence is contradictory", () => {
  const result = evidenceCoverage(sources({
    classroomSocket: present({ teacherPresentMs: 0, teacherJoinCount: 0 }),
  }));
  assert.equal(result.reviewability, "contradictory");
  assert.deepEqual(result.contradictions, ["teacher_presence_disagrees"]);
});

test("classroom-socket presence without provider presence is contradictory", () => {
  const result = evidenceCoverage(sources({
    mediaProvider: present({ teacherPresentMs: 0, teacherJoinCount: 0 }),
  }));
  assert.equal(result.reviewability, "contradictory");
});

test("a join event counts as presence even before duration has accrued", () => {
  const justJoined = present({ teacherPresentMs: 0, teacherJoinCount: 1 });
  assert.equal(evidenceCoverage(sources({ mediaProvider: justJoined })).reviewability,
    "sufficient_for_human_review");
});

test("bad numeric input cannot manufacture presence", () => {
  const malformed = present({ teacherPresentMs: Number.NaN, teacherJoinCount: -4 });
  const result = evidenceCoverage(sources({ mediaProvider: malformed }));
  assert.equal(result.reviewability, "contradictory");
});

test("missing optional network evidence does not pretend media evidence is incomplete", () => {
  assert.equal(evidenceCoverage(sources()).reviewability, "sufficient_for_human_review");
});

test("known-unavailable network evidence is disclosed but remains supporting evidence", () => {
  const result = evidenceCoverage(sources({
    networkQuality: { availability: "unavailable", eventCount: 0 },
  }));
  assert.equal(result.reviewability, "sufficient_for_human_review");
  assert.deepEqual(result.gaps, ["network_quality_unavailable"]);
});

test("board and chat counts cannot substitute for independent presence", () => {
  const result = evidenceCoverage(sources({
    mediaProvider: present({ availability: "unavailable", teacherPresentMs: 0, teacherJoinCount: 0 }),
    boardActivity: { availability: "available", eventCount: 500 },
    chatActivity: { availability: "available", eventCount: 30 },
  }));
  assert.equal(result.reviewability, "incomplete");
});
