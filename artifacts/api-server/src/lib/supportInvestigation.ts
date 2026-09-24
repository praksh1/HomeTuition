/** Bounded conversation memory and human review brief. No model, database or account actions. */
export interface SupportTurn { role: string; body: string }
export type InvestigationTopic = "billing" | "class_access" | "messaging" | "homework" | "account" | "safety" | "general";
export interface InvestigationStep { key: string; prompt: string; choices: { label: string; question: string }[] }
const step = (key: string, prompt: string, labels: string[] = []): InvestigationStep => ({
  key, prompt, choices: labels.map((label) => ({ label, question: label })),
});
const STEPS: Record<InvestigationTopic, InvestigationStep[]> = {
  billing: [
    step("payment_record", "Let's collect the details for a proper payment review. Which class or lesson is this about, and what does Payments & receipts show? Please leave out account numbers, passwords and verification codes."),
    step("payment_time", "When did this happen, what amount was shown, and which payment method did you use? An approximate time is fine; please include your time zone."),
    step("payment_outcome", "What would you like Fadko Support to review: access to the class, a charge, or a refund request? I cannot approve or send a refund. Any approved refund follows the original payment method; contact support if that method has changed.", ["Class access", "A charge", "Refund request"]),
  ],
  class_access: [
    step("class_symptom", "Let's narrow it down. What is failing in the lesson?", ["Cannot join", "Camera or microphone", "Whiteboard or PDF", "Connection keeps dropping"]),
    step("device", "Which device and browser are you using, and what exactly appears on screen? You do not need to send private message content or passwords."),
    step("class_when", "Which class or lesson was affected, and about what time did it happen? Tell me what you have already tried so I do not ask you to repeat it."),
  ],
  messaging: [
    step("message_scope", "Is this a direct message, a class conversation, or a notification?", ["Direct message", "Class conversation", "Notification"]),
    step("device", "Which device and browser are you using, and what exactly appears on screen? You do not need to send private message content or passwords."),
    step("message_when", "About when did this happen, and what have you already tried? If a message is stuck sending, keep its draft rather than sending it repeatedly."),
  ],
  homework: [
    step("homework_scope", "Which class and assignment is affected? Is the problem uploading work, opening a file, or seeing feedback?"),
    step("device", "Which device and browser are you using, and what exactly appears on screen? You do not need to send private message content or passwords."),
    step("homework_when", "When did it happen, and what have you already tried? Please keep your original work while we investigate."),
  ],
  account: [
    step("account_scope", "Which account step is failing? Please do not share your password or any verification code.", ["Signing in", "Saving profile details", "Changing contact details"]),
    step("device", "Which device and browser are you using, and what exactly appears on screen? You do not need to send private message content or passwords."),
  ],
  safety: [
    step("safety_where", "I'm sorry this happened. Are you safe right now, and which class or conversation was involved? You can ask a person immediately; you do not need to confront anyone or keep participating."),
    step("safety_evidence", "What happened and approximately when? Keep any evidence you already have. Use the support form to attach it securely; I have not viewed any screenshots or recordings here. A person will review the report and decide any account action."),
  ],
  general: [step("general_detail", "Tell me what you were trying to do and what happened instead. I will keep these details together for you.")],
};

const REPORTED_FAILURE = /\b(still|same problem|did(?:n't| not) (?:work|help)|not (?:working|helpful)|already tried|does(?:n't| not) work|no luck|not fixed)\b/i;
const HUMAN_REQUEST = /\b(human|real person|agent|customer service|send (?:this|it) to support)\b/i;

export function supportInvestigation(input: {
  topic: InvestigationTopic; history: readonly SupportTurn[]; question: string;
  candidate: string; candidateSource: string;
}): { answer: string; choices: InvestigationStep["choices"]; readyForHuman: boolean } | null {
  const history = input.history.slice(-48);
  const replies = history.filter((turn) => turn.role === "assistant");
  if (/^(?:yes[,! ]+)?(?:it(?:'s| is)? )?(?:works? now|fixed|solved|resolved)[.! ]*$/i.test(input.question.trim())) return {
    answer: "Glad that is working now. This conversation stays in your history; use New question for anything else. No support ticket was created by this reply.",
    choices: [], readyForHuman: false,
  };
  if (HUMAN_REQUEST.test(input.question)) return {
    answer: "Of course. Tap Ask a person below and I will send this conversation with a review brief, so you do not have to start again. You can attach evidence through the support form too.", choices: [], readyForHuman: true,
  };
  const steps = STEPS[input.topic];
  const alreadyInvestigating = steps.some((item) => replies.some((turn) => turn.body === item.prompt));
  const repeat = replies.some((turn) => turn.body === input.candidate);
  if (!alreadyInvestigating && !repeat && !REPORTED_FAILURE.test(input.question) && input.candidateSource !== "handoff" && input.topic !== "safety") return null;
  const reported = [...history.filter((turn) => turn.role === "user").map((turn) => turn.body), input.question].join(" ");
  const supplied = (key: string) => key === "device" && /\b(iphone|ipad|android|laptop|windows|macbook)\b/i.test(reported) && /\b(safari|chrome|firefox|edge)\b/i.test(reported);
  const next = steps.find((item) => !supplied(item.key) && !replies.some((turn) => turn.body === item.prompt));
  if (next) return { answer: next.prompt, choices: next.choices, readyForHuman: input.topic === "safety" };
  return {
    answer: "We have reached the point where a person should review this; I will not keep asking you to repeat the same steps. Tap Ask a person to send the details together. You can also add any missing detail before sending.",
    choices: [], readyForHuman: true,
  };
}

/** Recover exactly the choices for a stored question, not a fresh classifier guess. */
export function investigationChoices(answer: string): InvestigationStep["choices"] {
  return Object.values(STEPS).flat().find((item) => item.prompt === answer)?.choices ?? [];
}

export function conversationTopic(latest: InvestigationTopic, previous: readonly InvestigationTopic[]): InvestigationTopic {
  // Explicit safety remains safety. A short answer such as “Safari” inherits the current case.
  if (latest === "safety" || previous.includes("safety")) return "safety";
  return previous.find((topic) => topic !== "general") ?? latest;
}

/** This is a sourced compilation, not an AI verdict or a substitute for the original transcript. */
export function buildSupportReviewBrief(turns: readonly SupportTurn[], facts: readonly string[] = []): string {
  const bounded = turns.slice(-48);
  const reports = bounded.filter((turn) => turn.role === "user");
  const questions = bounded.filter((turn) => turn.role === "assistant");
  const lines = [
    "SUPPORT REVIEW BRIEF — human decision required",
    "User reports (not independently verified):",
    ...reports.slice(0, 8).map((turn, i) => `${i + 1}. ${turn.body.slice(0, 240)}`),
    ...(reports.length > 8 ? ["Additional reports remain in the support conversation."] : []),
    "Fadko records checked:",
    ...(facts.length ? facts.slice(0, 8) : ["No class/payment record has been linked and verified in this conversation."]),
    "Questions / guidance already given:",
    ...questions.slice(-3).map((turn) => `- ${turn.body.slice(0, 160)}`),
    "Unverified: payment-provider settlement, cause of technical failure, image/recording contents and any allegation of misconduct. Missing records are not proof an event did not happen.",
    "Next: check the linked session evidence and original payment records; compare with the user's account; request only missing evidence. Human alone decides refund or moderation action. No money moved and no account was restricted by this assistant.",
  ];
  return lines.join("\n").slice(0, 4_000);
}
