const questions = [
  { id: "q1", prompt: "2 + 2?", kind: "choice", options: ["3", "4", "5"], answer: "4", points: 2, confirmed: true },
  { id: "q2", prompt: "Capital of Nepal?", kind: "short", options: [], answer: "Kathmandu", points: 1, confirmed: true },
];
const teacher = !location.search.includes("student");
let saved = { id: 9, title: "Maths practice", questions, revision: 1, status: "published", dueAt: null, closed: false };
let attempt = null;
async function waitForTestRelease() {
  if (globalThis.holdQuizRequest) {
    await new Promise(resolve => { globalThis.releaseQuizRequest = resolve; });
    globalThis.holdQuizRequest = false;
  }
}
export async function apiGet(path) {
  if (path.includes("results")) return { items: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, studentName: `Student ${i + 1}`, score: 3, possible: 3, answers: { q1: "4", q2: "Kathmandu" } })), nextCursor: null };
  if (/quizzes\/\d+$/.test(path)) return { isTeacher: teacher, quiz: { ...saved, questions: saved.questions.map(q => teacher || saved.closed ? q : (({ answer, confirmed, ...rest }) => rest)(q)) }, attempt };
  return { title: "Maths class", isTeacher: teacher, items: [{ ...saved, questionCount: saved.questions.length }], nextCursor: null };
}
export async function apiPost(path, body) {
  await waitForTestRelease();
  if (path.endsWith("/publish")) { saved.status = "published"; globalThis.quizPublished = true; return { quiz: saved }; }
  if (path.endsWith("/submit")) { attempt = { score: 3, possible: 3, answers: body.answers }; return { attempt }; }
  if (path.endsWith("/close")) { saved.closed = true; saved.status = "closed"; return {}; }
  saved = { ...structuredClone(body), id: 11 }; globalThis.savedQuiz = saved; return { quiz: saved };
}
export async function apiPut(path, body) { await waitForTestRelease(); saved = { ...structuredClone(body), revision: body.revision + 1 }; globalThis.savedQuiz = saved; return { quiz: saved }; }
export async function apiDelete() { return {}; }
