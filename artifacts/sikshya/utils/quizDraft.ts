export interface QuizQuestion {
  id: string; prompt: string; kind: "choice" | "short"; options: string[]; answer: string; points: number; confirmed: boolean;
}
export const QUIZ_EXAMPLE = "1. What is 2 + 2?\nA) 3\nB) 4\nC) 5\nAnswer: B\n\n2. What is the capital of Nepal?\nAnswer: Kathmandu";

/** Conservative, deterministic document conversion. No model, code execution or guessed keys. */
export function parseQuizText(text: string): QuizQuestion[] {
  if (!text.trim() || text.length > 60_000) throw new Error("Use a text document of up to 60,000 characters.");
  const blocks = text.replace(/\r/g, "").split(/(?=^\s*\d+[.)]\s+\S)/m).filter(part => /^\s*\d+[.)]\s+\S/.test(part));
  if (!blocks.length) throw new Error("Number each question like 1. or 2. Put each choice on its own line (A), B), C)) and add Answer: B. You can also write questions yourself.");
  if (blocks.length > 50) throw new Error("Split this document into quizzes of at most 50 questions.");
  return blocks.map((block, index) => {
    const lines = block.trim().replace(/^\d+[.)]\s*/, "").split("\n");
    const prompt: string[] = [], options: string[] = [], labels: string[] = [];
    let key = "", inAnswers = false;
    for (const raw of lines) {
      const line = raw.trim();
      const answer = line.match(/^(?:answer|correct answer)\s*:\s*(.*)$/i);
      const option = line.match(/^([A-F])[.)]\s+(.+)$/i);
      if (answer) { key = answer[1].trim(); inAnswers = true; }
      else if (option) { labels.push(option[1].toUpperCase()); options.push(option[2]); inAnswers = true; }
      else if (!inAnswers && line) prompt.push(line);
      else if (line) throw new Error(`Question ${index + 1} has an unrecognized line after its choices. Put each choice and answer on one line, then try again.`);
    }
    if (!prompt.length || prompt.join(" ").length > 2000 || options.length > 6 || options.some(o => o.length > 500) || key.length > 1000) throw new Error(`Question ${index + 1} is too long or incomplete. Shorten it before importing.`);
    const choiceIndex = labels.indexOf(key.replace(/[.)]$/, "").toUpperCase());
    const answer = options.length ? (choiceIndex >= 0 ? options[choiceIndex] : options.includes(key) ? key : "") : key;
    return { id: `q${index + 1}`, prompt: prompt.join(" "), kind: options.length ? "choice" : "short", options, answer, points: 1, confirmed: false };
  });
}
