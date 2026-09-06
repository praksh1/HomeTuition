import assert from "node:assert/strict";
import test from "node:test";
import {
  OTHER_GROUP_HEADING,
  SUMMARY_GROUPS,
  groupSessionSummary,
  summaryGroupFor,
} from "./sessionSummaryGroups.ts";

const line = (code: string) => ({ code, detail: `detail for ${code}` });

test("each fact lands in the group an operator would look for it in", () => {
  assert.equal(summaryGroupFor("created"), "booking");
  assert.equal(summaryGroupFor("schedule_changed"), "booking");
  assert.equal(summaryGroupFor("reporter_booking"), "booking");
  assert.equal(summaryGroupFor("booked_students"), "booking");

  assert.equal(summaryGroupFor("class_started"), "classroom");
  assert.equal(summaryGroupFor("teacher_attendance"), "classroom");
  assert.equal(summaryGroupFor("participant_first_seen"), "classroom");
  assert.equal(summaryGroupFor("teacher_classroom_activity"), "classroom");
  assert.equal(summaryGroupFor("class_message_sent"), "classroom");

  assert.equal(summaryGroupFor("evidence_sources"), "sources");
  assert.equal(summaryGroupFor("provider_meeting_count"), "sources");
  assert.equal(summaryGroupFor("provider_meetings_none"), "sources");
});

test("codes the server numbers per item are matched by prefix", () => {
  // A class can hold any number of meetings, people and devices, so these arrive as
  // provider_meeting_1, provider_meeting_2 and so on. Matching the exact strings would put the
  // third meeting in "Other recorded facts".
  assert.equal(summaryGroupFor("provider_meeting_1"), "sources");
  assert.equal(summaryGroupFor("provider_meeting_9"), "sources");
  assert.equal(summaryGroupFor("participant_source_account_2"), "sources");
  assert.equal(summaryGroupFor("device_quality_3"), "sources");
  assert.equal(summaryGroupFor("device_quality_unavailable_4"), "sources");
});

test("a code this app has never heard of is shown, not hidden", () => {
  /*
    The failure this prevents. A newer API adds a fact, an older web build does not recognise it,
    and the fact silently disappears from the one screen where evidence is being weighed. Being
    out of date must cost a heading, never a fact.
  */
  assert.equal(summaryGroupFor("some_future_fact_nobody_wrote_yet"), "other");

  const grouped = groupSessionSummary([line("created"), line("brand_new_code")]);
  const other = grouped.find((g) => g.id === "other");
  assert.ok(other, "the unknown code must produce a group of its own");
  assert.equal(other.heading, OTHER_GROUP_HEADING);
  assert.deepEqual(other.lines.map((l) => l.code), ["brand_new_code"]);
});

test("every line survives grouping exactly once", () => {
  const codes = [
    "created", "schedule_changed", "reporter_booking", "booked_students",
    "class_started", "teacher_attendance", "teacher_classroom_activity", "class_ended",
    "evidence_sources", "provider_meeting_count", "provider_meeting_1", "provider_meeting_2",
    "participant_source_account_1", "device_quality_1", "device_quality_unavailable_2",
    "something_unrecognised",
  ];
  const grouped = groupSessionSummary(codes.map(line));
  const rendered = grouped.flatMap((g) => g.lines.map((l) => l.code));
  assert.deepEqual([...rendered].sort(), [...codes].sort(), "no line may be dropped or duplicated");
  assert.equal(rendered.length, codes.length);
});

test("the server's order inside a group is left alone", () => {
  // The narrative is written to be read in the order it was built. Grouping may separate the
  // lines; it must never reshuffle them.
  const grouped = groupSessionSummary([
    line("class_ended"), line("class_started"), line("teacher_attendance"),
  ]);
  const classroom = grouped.find((g) => g.id === "classroom");
  assert.deepEqual(classroom?.lines.map((l) => l.code), ["class_ended", "class_started", "teacher_attendance"]);
});

test("groups appear in reading order: the arrangement, then the class, then the sources", () => {
  const grouped = groupSessionSummary([
    line("device_quality_1"), line("class_started"), line("created"), line("unknown_thing"),
  ]);
  assert.deepEqual(grouped.map((g) => g.id), ["booking", "classroom", "sources", "other"]);
});

test("an empty group is not rendered as a heading over nothing", () => {
  const grouped = groupSessionSummary([line("created")]);
  assert.deepEqual(grouped.map((g) => g.id), ["booking"]);
});

test("nothing to group produces nothing rather than four empty headings", () => {
  assert.deepEqual(groupSessionSummary([]), []);
});

test("no code belongs to two groups", () => {
  // Overlap would make the "exactly once" guarantee depend on which group is checked first.
  const seen = new Set<string>();
  for (const group of SUMMARY_GROUPS) {
    for (const code of group.codes) {
      assert.ok(!seen.has(code), `${code} appears in more than one group`);
      seen.add(code);
    }
  }
});
