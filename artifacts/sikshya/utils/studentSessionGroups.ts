import { studentDoorClosesAt, type SessionWindowInput } from "./sessionWindow.ts";

export type StudentSessionSection = "upcoming" | "live" | "history";

/** One lesson's place in My learning, without confusing "not open yet" with "finished". */
export function studentSessionSection(
  session: SessionWindowInput,
  now: number = Date.now(),
): StudentSessionSection {
  if (session.status === "completed" || session.status === "cancelled") return "history";
  const closesAt = studentDoorClosesAt(session);
  if (closesAt !== null && now > closesAt) return "history";
  return session.status === "live" ? "live" : "upcoming";
}

/**
 * A purchased class owns many lesson rows but occupies one section and one card.
 * Live wins over future; future wins over its own completed lessons; history begins only when
 * the whole class is over.
 */
export function studentClassSection(
  sessions: SessionWindowInput[],
  now: number = Date.now(),
): StudentSessionSection {
  const sections = sessions.map((session) => studentSessionSection(session, now));
  if (sections.includes("live")) return "live";
  if (sections.includes("upcoming")) return "upcoming";
  return "history";
}
