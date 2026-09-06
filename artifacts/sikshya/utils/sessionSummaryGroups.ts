/**
 * Sorting the operator case summary into three things a person can scan.
 *
 * ## Why this exists
 *
 * The server writes seventeen or so plain-language facts about one class, in a deliberate order.
 * Rendered as one undifferentiated bullet list they are readable and very hard to *scan* — an
 * agent looking for "did the teacher turn up" reads a paragraph about a schedule change first.
 * Grouping them costs nothing at the source and turns the page into something you can skim to the
 * part you need.
 *
 * ## It reads the code, never the sentence
 *
 * Categorising on the English text would break the first time somebody rewords a line, and would
 * quietly move a fact into the wrong group rather than failing — which on an evidence page is the
 * worst kind of bug, because the sentence still looks right where it lands. So this matches on the
 * stable `code` the server already attaches, and nothing else.
 *
 * ## An unknown code is shown, never hidden
 *
 * A future server can add a fact this app has never heard of. Dropping it would silently remove
 * evidence from the one screen where evidence is being weighed, so anything unrecognised lands in
 * "Other recorded facts" and stays visible. The app being older than the API must cost a heading,
 * not a fact.
 *
 * Ordering inside a group is the server's, untouched. Nothing here rewrites, merges, filters or
 * summarises a line.
 */

export type SummaryGroupId = "booking" | "classroom" | "sources" | "other";

export interface SummaryGroupDefinition {
  id: SummaryGroupId;
  heading: string;
  /** Exact codes belonging to this group. */
  codes: readonly string[];
  /** Codes the server numbers per item, e.g. `provider_meeting_1`, `provider_meeting_2`. */
  prefixes: readonly string[];
}

/**
 * The three groups, in reading order, plus the honest catch-all.
 *
 * Order matters: an agent wants the arrangement first, then what happened, then how much of it
 * the platform can actually stand behind.
 */
export const SUMMARY_GROUPS: readonly SummaryGroupDefinition[] = [
  {
    id: "booking",
    heading: "Booking and schedule",
    codes: [
      "created",
      "session_created",
      "schedule_changed",
      "schedule_unchanged",
      "reporter_booking",
      "reporter_booking_missing",
      "student_enrolled",
      "booked_students",
    ],
    prefixes: [],
  },
  {
    id: "classroom",
    heading: "What happened in the classroom",
    codes: [
      "class_started",
      "class_not_started",
      "class_ended",
      "class_end_unavailable",
      "attendance_unavailable",
      "teacher_attendance",
      "teacher_not_in_ledger",
      "participant_first_seen",
      "teacher_classroom_activity",
      "teacher_message_before_class",
      "no_teacher_message_before_class",
      "class_message_sent",
    ],
    prefixes: [],
  },
  {
    id: "sources",
    heading: "What the evidence sources recorded",
    codes: ["evidence_sources", "provider_meeting_count", "provider_meetings_none"],
    // Numbered per meeting, per person and per device, so they are matched by prefix.
    prefixes: ["provider_meeting_", "participant_source_account_", "device_quality_"],
  },
] as const;

export const OTHER_GROUP_HEADING = "Other recorded facts";

/** Which group a summary line belongs to, decided by its code alone. */
export function summaryGroupFor(code: string): SummaryGroupId {
  for (const group of SUMMARY_GROUPS) {
    if (group.codes.includes(code)) return group.id;
    if (group.prefixes.some((prefix) => code.startsWith(prefix))) return group.id;
  }
  return "other";
}

export interface SummaryLine {
  code: string;
  detail: string;
}

export interface SummaryGroup {
  id: SummaryGroupId;
  heading: string;
  lines: SummaryLine[];
}

/**
 * Group the summary without losing, reordering or repeating a single line.
 *
 * An empty group is dropped rather than shown as a heading over nothing — a class with no provider
 * evidence should not display "What the evidence sources recorded" and then say nothing, which
 * reads as a rendering fault rather than as an absence. The *facts* about absence are lines of
 * their own and travel with whichever group they belong to.
 */
export function groupSessionSummary(lines: readonly SummaryLine[]): SummaryGroup[] {
  const byId = new Map<SummaryGroupId, SummaryLine[]>();
  for (const line of lines) {
    const id = summaryGroupFor(line.code);
    const existing = byId.get(id);
    if (existing) existing.push(line);
    else byId.set(id, [line]);
  }

  const grouped: SummaryGroup[] = [];
  for (const group of SUMMARY_GROUPS) {
    const own = byId.get(group.id);
    if (own && own.length > 0) grouped.push({ id: group.id, heading: group.heading, lines: own });
  }
  const other = byId.get("other");
  if (other && other.length > 0) grouped.push({ id: "other", heading: OTHER_GROUP_HEADING, lines: other });
  return grouped;
}
