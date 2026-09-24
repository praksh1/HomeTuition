import type { QuizQuestion } from "@workspace/db";

export function validateQuiz(input: unknown): { title: string; questions: QuizQuestion[]; dueAt: Date | null } {
  if (!input || typeof input !== "object") throw new Error("Enter a quiz title and at least one question.");
  const body = input as Record<string, unknown>;
  if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 160) throw new Error("Enter a title of 1–160 characters.");
  if (!Array.isArray(body.questions) || !body.questions.length || body.questions.length > 50) throw new Error("Include 1–50 questions.");
  const ids = new Set<string>();
  const questions = body.questions.map((value, index): QuizQuestion => {
    const q = value as Partial<QuizQuestion> | null;
    const prefix = `Question ${index + 1}: `;
    if (!q || typeof q.id !== "string" || !/^q[a-zA-Z0-9_-]{0,59}$/.test(q.id) || ids.has(q.id)) throw new Error(prefix + "use a unique question id.");
    ids.add(q.id);
    if (typeof q.prompt !== "string" || !q.prompt.trim() || q.prompt.length > 2000) throw new Error(prefix + "write a question of 1–2,000 characters.");
    if (q.kind !== "choice" && q.kind !== "short") throw new Error(prefix + "choose multiple choice or short answer.");
    if (!Array.isArray(q.options) || q.options.some(o => typeof o !== "string" || !o.trim() || o.length > 500)) throw new Error(prefix + "check the answer choices.");
    if (q.kind === "choice" && (q.options.length < 2 || q.options.length > 6 || new Set(q.options.map(o => normalizeAnswer(o))).size !== q.options.length)) throw new Error(prefix + "include 2–6 distinct choices.");
    if (q.kind === "short" && q.options.length) throw new Error(prefix + "short answers do not have choices.");
    if (typeof q.answer !== "string" || q.answer.length > 1000) throw new Error(prefix + "check the correct answer.");
    // An unfinished draft may have no key yet; confirmation/publication may not.
    if (q.answer && q.kind === "choice" && !q.options.includes(q.answer)) throw new Error(prefix + "select a correct answer from the choices.");
    if (!Number.isInteger(q.points) || q.points! < 1 || q.points! > 100) throw new Error(prefix + "points must be a whole number from 1 to 100.");
    if (q.confirmed && !q.answer.trim()) throw new Error(prefix + "set the correct answer before confirming.");
    return { id: q.id, prompt: q.prompt.trim(), kind: q.kind, options: q.options.map(o => o.trim()), answer: q.answer.trim(), points: q.points!, confirmed: q.confirmed === true };
  });
  let dueAt: Date | null = null;
  if (body.dueAt != null && body.dueAt !== "") {
    if (typeof body.dueAt !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(body.dueAt)) throw new Error("Choose a complete deadline date and time.");
    dueAt = new Date(body.dueAt);
    if (!Number.isFinite(dueAt.getTime())) throw new Error("Choose a valid deadline.");
  }
  return { title: body.title.trim(), questions, dueAt };
}

export function normalizeAnswer(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

export function gradeQuiz(questions: QuizQuestion[], input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Answer each question before submitting.");
  const source = input as Record<string, unknown>;
  if (Object.keys(source).some(id => !questions.some(q => q.id === id))) throw new Error("The answers do not match this quiz.");
  const answers: Record<string, string> = {};
  let score = 0, possible = 0;
  for (const q of questions) {
    const answer = source[q.id];
    if (typeof answer !== "string" || !answer.trim() || answer.length > 1000) throw new Error("Answer each question before submitting.");
    if (q.kind === "choice" && !q.options.includes(answer)) throw new Error("Choose one of the listed answers.");
    answers[q.id] = answer.trim();
    possible += q.points;
    if (q.kind === "choice" ? answer === q.answer : normalizeAnswer(answer) === normalizeAnswer(q.answer)) score += q.points;
  }
  return { answers, score, possible };
}

export function studentQuestions(questions: QuizQuestion[], reveal = false) {
  return questions.map(q => ({ id: q.id, prompt: q.prompt, kind: q.kind, options: q.options, points: q.points, ...(reveal ? { answer: q.answer } : {}) }));
}
