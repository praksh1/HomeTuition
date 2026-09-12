export type TeacherAffiliation = "affiliated" | "independent" | "not_specified";

export interface PublicTeacher {
  id: string;
  userId: number;
  name: string;
  subject: string;
  subjects: string[];
  bio: string;
  approvalStatus: "approved";
  rating: number;
  reviewCount: number;
  /** Legacy booking count is intentionally absent from the new directory. */
  totalStudents?: number;
  avatarUrl?: string;
  location?: string;
  district?: string;
  province?: string;
  localLevel?: string;
  institutionName?: string;
  affiliationStatus?: TeacherAffiliation;
  experienceYears?: number;
  languages?: string[];
  /** Legacy one-class profiles may carry this. The new directory does not fabricate one. */
  pricePerSession?: number;
}

export interface TeacherPage {
  teachers: PublicTeacher[];
  total: number;
  page: number;
  limit: number;
}

export interface TeacherSearch {
  query: string;
  subject: string;
  province: string;
  district: string;
  localLevel: string;
  institution: string;
  affiliation: TeacherAffiliation | "all";
}

export const EMPTY_TEACHER_SEARCH: TeacherSearch = {
  query: "",
  subject: "All",
  province: "",
  district: "",
  localLevel: "",
  institution: "",
  affiliation: "all",
};

/**
 * One bounded server request. Discover must never download the whole teacher directory and then
 * filter it on a student's phone: at 5,000 teachers that wastes data, memory and time before the
 * first useful result can appear.
 */
export function teacherSearchPath(search: TeacherSearch, page = 1, limit = 12): string {
  const params = new URLSearchParams({ page: String(page), limit: String(limit), sort: "name" });
  const values: Array<[string, string]> = [
    ["search", search.query],
    ["subject", search.subject === "All" ? "" : search.subject],
    ["province", search.province],
    ["district", search.district],
    ["localLevel", search.localLevel],
    ["institution", search.institution],
    ["affiliation", search.affiliation === "all" ? "" : search.affiliation],
  ];
  for (const [key, value] of values) {
    const clean = value.trim();
    if (clean) params.set(key, clean);
  }
  return `/teachers?${params.toString()}`;
}

export function appendTeacherPage(current: PublicTeacher[], next: PublicTeacher[]): PublicTeacher[] {
  const seen = new Set(current.map((teacher) => teacher.userId));
  return [...current, ...next.filter((teacher) => !seen.has(teacher.userId))];
}

export function activeTeacherFilterCount(search: TeacherSearch): number {
  return [
    search.subject !== "All",
    search.province.trim() !== "",
    search.district.trim() !== "",
    search.localLevel.trim() !== "",
    search.institution.trim() !== "",
    search.affiliation !== "all",
  ].filter(Boolean).length;
}
