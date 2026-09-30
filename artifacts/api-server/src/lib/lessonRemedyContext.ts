export interface RemedyContextEvent {
  id: number; caseId: number; actorId: number | null; actorRole: string; event: string; detail: unknown;
}
function safeNote(detail: unknown): string | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const note = (detail as Record<string, unknown>).note;
  return typeof note === "string" && note.trim() ? note.trim().slice(0, 1500) : null;
}
/** Only participant-authored context is shared. Operator decision notes never enter this projection. */
export function lessonRemedyParticipantContext(c: { id: number; studentId: number; teacherId: number },
  actor: { userId: number; role: string }, events: RemedyContextEvent[]) {
  const authorized = actor.role === "admin" || actor.role === "student" && actor.userId === c.studentId ||
    actor.role === "teacher" && actor.userId === c.teacherId;
  if (!authorized) return { requestNote: null, teacherDecisionReason: null };
  const own = events.filter(event => event.caseId === c.id).sort((a, b) => a.id - b.id);
  const request = own.filter(event => event.event === "request" && event.actorRole === "student" && event.actorId === c.studentId).at(-1);
  const rejection = own.filter(event => event.event === "reject" && event.actorRole === "teacher" && event.actorId === c.teacherId &&
    (!request || event.id > request.id)).at(-1);
  return { requestNote: safeNote(request?.detail), teacherDecisionReason: safeNote(rejection?.detail) };
}
