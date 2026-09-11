/** A lightweight listing, distinct from the older required learning-path contract. */
export interface ClassDescription {
  title: string;
  summary: string;
  teachingLanguage: string;
  outline: string;
}
export function readClassDescription(
  raw: unknown,
): { ok: true; value: ClassDescription } | { ok: false; issues: string[] } {
  const r =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const issues: string[] = [];
  const text = (key: string, label: string, min: number, max: number) => {
    const value = r[key] === undefined && min === 0 ? "" : r[key];
    if (typeof value !== "string") {
      issues.push(`${label} must be text.`);
      return "";
    }
    const clean = value.trim();
    if (clean.length < min) issues.push(`${label} needs a little more detail.`);
    if (clean.length > max) issues.push(`${label} is too long.`);
    return clean;
  };
  const value = {
    title: text("title", "Class name", 8, 90),
    summary: text("summary", "Class description", 24, 240),
    teachingLanguage: text("teachingLanguage", "Teaching language", 2, 100),
    outline: text("outline", "Optional teaching plan", 0, 2000),
  };
  if (
    /\b(guaranteed?\s+(pass|result)|100\s*%\s*(pass|success)|will\s+pass)\b/i.test(
      `${value.title} ${value.summary} ${value.outline}`,
    )
  )
    issues.push("Describe your teaching without guaranteeing an exam result.");
  return issues.length ? { ok: false, issues } : { ok: true, value };
}
