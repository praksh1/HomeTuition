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
  id: number;
  type: ProgramType | string;
  version: number;
  publishedAt: string;
  teacher: { id: number; name: string };
  title: string;
  summary: string;
  outcome: string;
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
  label: string;
}

/**
 * The three views, in the order Discover shows them.
 *
 * Programs first, because this phase makes Programs the featured learning surface. `classes` and
 * `teachers` are the existing Discover implementations, deliberately kept — this screen navigates
 * between them rather than replacing them.
 */
export const DISCOVER_TABS: readonly DiscoverTab[] = [
  { view: "programs", label: "Programs" },
  { view: "classes", label: "Single classes" },
  { view: "teachers", label: "Teachers" },
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

/** For a summary row: the intended learner is not on the list, so the line has a graceful default. */
export function cardFromSummary(row: PublicProgramSummary): ProgramCardFields {
  return {
    id: row.id,
    title: row.title || "Untitled program",
    outcome: row.outcome,
    summary: row.summary,
    typeLabel: programTypeLabel(row.type),
    // The list does not carry `intendedLearner`; the card just omits the line rather than inventing.
    intendedLearnerLine: null,
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
    typeLabel: programTypeLabel(program.type),
    intendedLearnerLine: program.intendedLearner || null,
    teachingLanguage: program.teachingLanguage,
    teacherName: program.teacher.name,
  };
}

/* ========================================================================== *
 * The details page: which blocks appear                                       *
 * ========================================================================== */

/**
 * A published reference the student can read, plus the disclosure they need beside it.
 *
 * The API returns `referenceName` verbatim and `referenceSource` from an enum. This screen never
 * calls anything "official" of its own initiative — that would be the app endorsing a curriculum
 * it has not reviewed — so the source is used only to decide the *disclosure*: for any teacher-
 * supplied reference the page says so plainly, and for a program that is "official" today the page
 * still notes that Fadko does not endorse the curriculum, since no endorsement process exists.
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
      "The teacher supplied this citation. Fadko does not check or endorse the curriculum, exam board, or book.",
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
 * Re-exports the screens need                                                 *
 * ========================================================================== */

export { PROGRAM_TYPE_CHOICES, programTypeLabel, type ProgramType, type ProgramTypeChoice };
