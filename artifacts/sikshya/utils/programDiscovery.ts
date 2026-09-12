/**
 * What a student sees, as pure functions. The screens draw it; nothing here talks to a server.
 *
 * ## Why this is a file and not branches inside two screens
 *
 * Discover has three views a student can switch between (Programs, Single classes, Teachers), one
 * shared search prompt, a set of type filters that must map onto the server's authoritative codes,
 * and pagination that must not skip results. The program details page holds a snapshot with several
 * conditionally-shown blocks. Written inline that is a hundred conditions across two screens; here
 * it is a handful of named functions with tests beside them.
 *
 * ## The one rule this file exists to hold
 *
 * **Never invent a number, a promise, or a claim.** No price, no rating, no seat count, no
 * enrolment total, no "popular", no "verified" — the backlog's ninth rule and the running table in
 * `.agents/backlog/ui-upgrade-progress.md`. The public API deliberately does not carry any of those
 * fields (see `api-server/src/routes/learningPrograms.ts` header). Anything that would need one
 * belongs in a later phase where the commercial contract exists.
 */

import { PROGRAM_TYPE_CHOICES, programTypeLabel, type ProgramType, type ProgramTypeChoice } from "./learningProgramUi.ts";

/* ========================================================================== *
 * What the public API sends                                                   *
 * ========================================================================== */

/** One row in the public list, exactly as `/programs` returns it (see the API header for shape). */
export interface PublicProgramSummary {
  presentation?: "class";
  id: number;
  type: ProgramType | string;
  version: number;
  publishedAt: string;
  teacher: { id: number; name: string };
  title: string;
  summary: string;
  outcome: string;
  /**
   * Added in Phase 2B correction round 1. Optional in the type because a client built against an
   * older server may not receive it, and the screen must still render honestly — see
   * `cardFromSummary` for the fallback (no line, not a made-up sentence).
   */
  intendedLearner?: string | null;
  startingLevel: string;
  teachingLanguage: string;
  referenceName?: string | null;
  referenceSource?: string | null;
  moduleCount: number;
}

export interface PublicProgramModule {
  title: string;
  outcome: string;
  description?: string | null;
  practicePrompt?: string | null;
}

/** One published program in full, as `/programs/:id` returns it. */
export interface PublicProgramDetail {
  presentation?: "class";
  outline?: string;
  id: number;
  type: ProgramType | string;
  version: number;
  publishedAt: string;
  teacher: { id: number; name: string };
  title: string;
  summary: string;
  outcome: string;
  intendedLearner: string;
  startingLevel: string;
  teachingLanguage: string;
  prerequisites?: string | null;
  equipment?: string | null;
  referenceName?: string | null;
  referenceSource?: string | null;
  modules: PublicProgramModule[];
}

/* ========================================================================== *
 * Discover: the three views and the filters that belong to Programs           *
 * ========================================================================== */

export type DiscoverView = "programs" | "classes" | "teachers";

export interface DiscoverTab {
  view: DiscoverView;
  /** The word on the pill. Kept short so the row fits at 390 points. */
  label: string;
  /** Spoken in full by a screen reader. */
  accessibilityLabel: string;
  /** The heading and one-line explanation each view puts at the top of the page. */
  heading: string;
  subtitle: string;
}

/**
 * The three primary product views, in the order Discover shows them.
 *
 * Programs first — this phase makes them the featured learning surface. Then Single classes,
 * which are individual bookable sessions from `GET /sessions`, distinct from monthly and from a
 * teacher's own list. Then Teachers, which is the existing browse-by-person view, with the
 * "Following" list nested inside it as a sub-choice — Codex was clear that Following is not a
 * third product category and belongs where a teacher relationship lives.
 *
 * `label` is the word on the pill; `accessibilityLabel` is the full phrase a screen reader hears,
 * because "Classes" alone does not say which kind. The page title and the subtitle also come from
 * here, so a change to a view name changes both the pill and the heading — impossible for one to
 * drift.
 */
export const DISCOVER_TABS: readonly DiscoverTab[] = [
  {
    view: "programs", label: "Courses", accessibilityLabel: "Courses",
    heading: "Find a course", subtitle: "Learn toward a clear goal with a teacher and a planned path.",
  },
  {
    view: "classes", label: "Live classes", accessibilityLabel: "Live classes",
    heading: "Find a live class", subtitle: "Book one scheduled class at a time.",
  },
  {
    view: "teachers", label: "Teachers", accessibilityLabel: "Teachers",
    heading: "Find a teacher", subtitle: "Browse teachers across Nepal.",
  },
];

/**
 * Teachers has its own two sub-views: everyone, and the ones this student follows.
 *
 * Following was previously a third top-level product view. Codex asked for it to be nested here,
 * and the reason is right: a follow is a relationship with a teacher and belongs in the Teachers
 * view. Nothing about the follow list itself changes.
 */
export type TeachersView = "all" | "following";

export interface TeachersTab {
  view: TeachersView;
  label: string;
}

export const TEACHERS_TABS: readonly TeachersTab[] = [
  { view: "all", label: "All teachers" },
  { view: "following", label: "Following" },
];

/** The one search prompt the whole Discover screen shares. */
export const DISCOVER_SEARCH_PROMPT = "Search a subject, skill, exam or teacher";

/**
 * The chips a student uses to narrow the Programs list, in the order they appear.
 *
 * The `type` value is the server's authoritative code and the label is what the student reads. Both
 * come from `PROGRAM_TYPE_CHOICES`, so this can never fall out of step with the studio's own type
 * list; a new type shipped by the API and known to this build appears here automatically.
 */
export interface ProgramTypeFilter {
  type: ProgramType | "all";
  label: string;
}

export function programTypeFilters(): ProgramTypeFilter[] {
  return [
    { type: "all", label: "All" },
    /*
      `label` is `programTypeLabel(type)`, not `choice.name` from `PROGRAM_TYPE_CHOICES`. That other
      name is the slightly-different studio-facing wording ("Custom program" versus "Custom"), and
      only one of them belongs on a filter chip. Reading through the same function every screen
      uses is what stops "Practical skill" and "Practical skills" living in two lists that had to
      agree.
    */
    ...PROGRAM_TYPE_CHOICES.map((choice): ProgramTypeFilter => ({
      type: choice.type,
      label: programTypeLabel(choice.type),
    })),
  ];
}

/* ========================================================================== *
 * A card                                                                      *
 * ========================================================================== */

/**
 * What a program card shows and — crucially — what it does not.
 *
 * Every field here is one the public API returns. No commercial signal appears (no price, seats,
 * ratings, popularity, earnings, enrolment totals) because the API deliberately does not carry any
 * of those, and adding one to the card that the API cannot fill would be the fabrication this
 * project has already recorded a dozen times.
 */
export interface ProgramCardFields {
  id: number;
  title: string;
  outcome: string;
  summary: string;
  typeLabel: string;
  intendedLearnerLine: string | null;
  teachingLanguage: string;
  teacherName: string;
}

/** For a summary row from the list; the intended learner comes through when the API sends it. */
export function cardFromSummary(row: PublicProgramSummary): ProgramCardFields {
  return {
    id: row.id,
    title: row.title || "Untitled program",
    outcome: row.outcome,
    summary: row.summary,
    typeLabel: row.presentation === "class" ? "Class" : programTypeLabel(row.type),
    // Present when the server includes it. Never invented, never inferred from another field —
    // an older server that does not send it produces a card with no learner line rather than a
    // made-up one.
    intendedLearnerLine: (row.intendedLearner ?? "").trim().length > 0 ? row.intendedLearner!.trim() : null,
    teachingLanguage: row.teachingLanguage,
    teacherName: row.teacher.name,
  };
}

export function cardFromDetail(program: PublicProgramDetail): ProgramCardFields {
  return {
    id: program.id,
    title: program.title || "Untitled program",
    outcome: program.outcome,
    summary: program.summary,
    typeLabel: program.presentation === "class" ? "Class" : programTypeLabel(program.type),
    intendedLearnerLine: program.intendedLearner || null,
    teachingLanguage: program.teachingLanguage,
    teacherName: program.teacher.name,
  };
}

/* ========================================================================== *
 * The details page: which blocks appear                                       *
 * ========================================================================== */

/**
 * A published reference the student can read, plus the honest disclosure beside it.
 *
 * The API returns `referenceName` verbatim and `referenceSource` from an enum with three values
 * (`official`, `teacher_supplied`, `none`). The previous version of this function called every
 * citation "teacher supplied" even when the source was `official` — a false provenance claim
 * Codex rightly rejected. The corrected wording is neutral: the disclosure names what the block
 * *is* — the reference the program cited — and says only what Fadko can honestly say about it,
 * which is that Fadko has not verified or endorsed it. That is true of every value of
 * `referenceSource`, because no endorsement process exists at all.
 */
export interface ReferenceBlock {
  name: string;
  disclosure: string;
}

export function referenceBlock(program: PublicProgramDetail): ReferenceBlock | null {
  const name = (program.referenceName ?? "").trim();
  if (name.length === 0) return null;
  return {
    name,
    disclosure:
      "This is the curriculum or reference named in the program. Fadko has not independently verified or endorsed it.",
  };
}

/**
 * A summary of what is missing from an ideal snapshot, so the page can note omissions honestly.
 *
 * Never invents content — an empty field is empty, not filled from another. This is what the "who
 * it is for" or "starting level" block reads when the teacher chose to leave it blank.
 */
export function missingOptional(program: PublicProgramDetail): string[] {
  const out: string[] = [];
  if (!(program.intendedLearner ?? "").trim()) out.push("who it is for");
  if (!(program.startingLevel ?? "").trim()) out.push("the starting level");
  if (!(program.prerequisites ?? "").trim()) out.push("prerequisites");
  if (!(program.equipment ?? "").trim()) out.push("what to bring");
  return out;
}

/* ========================================================================== *
 * Search: local filtering when we already have the page                       *
 * ========================================================================== */

/**
 * The words used to match a row locally, once a page is in hand.
 *
 * The server does the primary search — this only decides whether an already-loaded row would still
 * be shown after a chip change. It reads only fields the server also searches, so a client-side
 * filter cannot show a program the server would not have returned.
 *
 * Empty query matches every row. This is deliberate: a shared search box across three views should
 * reveal everything again the moment the words go away, not empty the list.
 */
export function localMatches(row: PublicProgramSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const hay = [
    row.title,
    row.summary,
    row.outcome,
    row.startingLevel,
    row.teachingLanguage,
    row.referenceName ?? "",
    row.teacher.name,
    programTypeLabel(row.type),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/**
 * Whether a set of chosen filters keeps this row.
 *
 * `"all"` in the set (or an empty set) keeps everything. Any other set keeps a row whose `type` is
 * in it — a code, matched by code, so a student who picked "Language learning" cannot see programs
 * of a different kind because the label happens to share a word.
 */
export function localTypeMatches(
  row: PublicProgramSummary,
  chosen: ReadonlySet<ProgramType | "all">,
): boolean {
  if (chosen.size === 0 || chosen.has("all")) return true;
  return chosen.has(row.type as ProgramType);
}

/* ========================================================================== *
 * Pagination                                                                  *
 * ========================================================================== */

/**
 * One page loaded from the server, merged with previous pages without duplicates.
 *
 * The API returns a `nextCursor` string or `null`. The merge is by `id`, so a program republished
 * during scrolling — pushing it to the top of the next page — appears only once.
 */
export interface ProgramList {
  rows: PublicProgramSummary[];
  nextCursor: string | null;
}

export function appendPage(current: ProgramList, next: ProgramList): ProgramList {
  const seen = new Set(current.rows.map((r) => r.id));
  const additions = next.rows.filter((r) => !seen.has(r.id));
  return { rows: [...current.rows, ...additions], nextCursor: next.nextCursor };
}

/* ========================================================================== *
 * Program-list state                                                          *
 * ========================================================================== */

/**
 * What the Programs list is showing right now, decided from what happened rather than what is
 * currently loading.
 *
 * The distinction the previous round got wrong: a first load that returned zero rows was drawn as
 * "no programs yet" whether the request had a query and a filter or not. That is honest for the
 * global empty state (there are no published programs on Fadko) and false for a search that
 * matched nothing (there are programs, just none for those words). Getting the two mixed up
 * teaches a student that the site is empty because their spelling was wrong.
 *
 * `paginationError` is separate from `error`: a next-page failure keeps the successful rows on
 * screen with a small retry beside "Show more", and never replaces the whole list with a failure
 * card. Codex's fourth correction.
 */
export type ProgramListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "noMatch"; query: string; filterActive: boolean }
  | { kind: "ready"; rows: PublicProgramSummary[]; hasMore: boolean; paginationError: string | null };

export interface ProgramListInput {
  initialLoad: boolean;
  loadedRows: PublicProgramSummary[];
  hasMore: boolean;
  initialError: string | null;
  paginationError: string | null;
  query: string;
  chosenType: ProgramType | "all";
}

export function programListState(input: ProgramListInput): ProgramListState {
  if (input.initialLoad) return { kind: "loading" };
  if (input.initialError !== null && input.loadedRows.length === 0) {
    return { kind: "error", message: input.initialError };
  }
  if (input.loadedRows.length === 0) {
    const filterActive = input.chosenType !== "all";
    if (input.query.trim().length > 0 || filterActive) {
      return { kind: "noMatch", query: input.query.trim(), filterActive };
    }
    return { kind: "empty" };
  }
  return {
    kind: "ready",
    rows: input.loadedRows,
    hasMore: input.hasMore,
    paginationError: input.paginationError,
  };
}

/* ========================================================================== *
 * Re-exports the screens need                                                 *
 * ========================================================================== */

export { PROGRAM_TYPE_CHOICES, programTypeLabel, type ProgramType, type ProgramTypeChoice };
