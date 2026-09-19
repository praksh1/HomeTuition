/**
 * The safe, provider-independent core of Fadko Support Assistant.
 *
 * This file deliberately has no database, network or model import. It is the part we can ship
 * and test before choosing an AI vendor. The production path should be:
 *
 *   normalise -> classify -> search reviewed articles -> answer or hand off
 *
 * A model may improve wording later, but it must not decide permissions, refunds, payouts or
 * identity. Those remain ordinary authenticated API operations, outside this module.
 */

export const SUPPORT_QUERY_MAX_CHARS = 1_200;
export const SUPPORT_ARTICLE_RESULT_LIMIT = 3;

export const SUPPORT_INTENTS = [
  "billing",
  "class_access",
  "messaging",
  "homework",
  "account",
  "safety",
  "general",
] as const;

export type SupportIntent = (typeof SUPPORT_INTENTS)[number];
export type SupportConfidence = "high" | "medium" | "low";

export interface SupportArticle {
  id: string;
  title: string;
  intent: SupportIntent;
  /** Search terms are editorial data, not arbitrary SQL or model instructions. */
  keywords: readonly string[];
  answer: string;
  status: "draft" | "published";
  /** Keep unfinished copy out of the public assistant even if it exists in the catalogue. */
  reviewedBy?: string | null;
}

export interface RankedSupportArticle extends SupportArticle {
  score: number;
}

export interface SupportClassification {
  intent: SupportIntent;
  confidence: SupportConfidence;
  /** Safe to store in analytics; never the user's original message. */
  queryLength: number;
}

export type SupportResolution =
  | {
      mode: "faq";
      classification: SupportClassification;
      articles: RankedSupportArticle[];
      suggestedActions: readonly SupportAction[];
    }
  | {
      mode: "clarify" | "handoff";
      classification: SupportClassification;
      articles: RankedSupportArticle[];
      suggestedActions: readonly SupportAction[];
    };

export type SupportAction =
  | "open_request"
  | "view_my_requests"
  | "open_class"
  | "open_messages"
  | "open_homework"
  | "open_profile";

/** Read-only, account-scoped tools that a future assistant may request. */
export const SUPPORT_READ_TOOLS = [
  "get_my_profile",
  "list_my_requests",
  "get_my_request",
  "list_my_classes",
  "get_my_class_access",
] as const;

export type SupportReadTool = (typeof SUPPORT_READ_TOOLS)[number];

/**
 * Tool names that are never exposed to an assistant.
 *
 * Keeping this deny-list next to the allow-list makes a future provider adapter reviewable: a
 * model response can never turn into an arbitrary route, SQL statement, role change or money
 * movement. Refunds and payouts remain operator/system workflows with their own evidence gates.
 */
export const SUPPORT_BLOCKED_TOOLS = [
  "run_sql",
  "lookup_other_user",
  "change_role",
  "change_email",
  "change_phone",
  "delete_account",
  "issue_refund",
  "approve_refund",
  "release_payout",
  "change_enrollment",
] as const;

const INTENT_TERMS: Record<SupportIntent, readonly string[]> = {
  billing: ["payment", "pay", "paid", "price", "fee", "refund", "receipt", "charge", "payout", "money"],
  class_access: ["join", "class", "lesson", "session", "room", "video", "call", "schedule", "enrol", "enroll"],
  messaging: ["message", "messages", "chat", "conversation", "notification", "notifications", "inbox", "reply", "send"],
  homework: ["homework", "assignment", "submission", "feedback", "question sheet", "marked copy"],
  account: ["login", "log in", "sign in", "password", "profile", "phone", "email", "province", "district", "account"],
  safety: ["unsafe", "harass", "harassment", "abuse", "threat", "inappropriate", "report"],
  general: [],
};

const ACTIONS_BY_INTENT: Record<SupportIntent, readonly SupportAction[]> = {
  billing: ["view_my_requests", "open_request"],
  class_access: ["open_class", "view_my_requests", "open_request"],
  messaging: ["open_messages", "open_request"],
  homework: ["open_homework", "open_request"],
  account: ["open_profile", "open_request"],
  safety: ["open_request", "view_my_requests"],
  general: ["open_request", "view_my_requests"],
};

const LOCAL_GREETINGS = new Set([
  "hello",
  "hi",
  "hey",
  "thanks",
  "thank you",
  "bye",
  "goodbye",
]);

function tokens(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

/** Normalize only for matching. The original text must not be logged by the assistant layer. */
export function normaliseSupportQuery(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SUPPORT_QUERY_MAX_CHARS);
}

/**
 * Return a privacy-safe summary for metrics. This intentionally contains no message text,
 * email, phone number, account id or extracted entities.
 */
export function supportQueryMetric(value: unknown): { queryLength: number; hasText: boolean } {
  const query = normaliseSupportQuery(value);
  return { queryLength: query.length, hasText: query.length > 0 };
}

/** Greetings and thanks never need a database lookup or model call. */
export function localSupportReply(value: unknown): string | null {
  const query = normaliseSupportQuery(value).toLocaleLowerCase().replace(/[.!?,]+$/g, "");
  if (!LOCAL_GREETINGS.has(query)) return null;
  if (query === "thanks" || query === "thank you") return "You’re welcome — I’m here whenever you need Fadko Support.";
  if (query === "bye" || query === "goodbye") return "Take care. Fadko Support is here whenever you need us.";
  return "Hi — I’m Fadko Support. What can I help you with?";
}

export function classifySupportQuery(value: unknown): SupportClassification {
  const query = normaliseSupportQuery(value);
  const queryTokens = new Set(tokens(query));
  let best: SupportIntent = "general";
  let bestScore = 0;
  let secondScore = 0;
  const scores = new Map<SupportIntent, number>();

  for (const intent of SUPPORT_INTENTS) {
    const score = INTENT_TERMS[intent].reduce((total, term) => {
      const termTokens = tokens(term);
      if (termTokens.length === 0) return total;
      // Preserve phrase matches such as "question sheet" without storing the phrase.
      if (termTokens.length > 1 && query.toLocaleLowerCase().includes(term.toLocaleLowerCase())) return total + 2;
      return total + (termTokens.every((token) => queryTokens.has(token)) ? 1 : 0);
    }, 0);
    scores.set(intent, score);
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = intent;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  // A paid student who cannot enter a class needs the billing/access path first: it can confirm
  // the booking state before asking them to troubleshoot camera or browser permissions. Keep
  // ordinary "cannot join" questions on class access when no money term is present.
  const billingScore = scores.get("billing") ?? 0;
  const accessScore = scores.get("class_access") ?? 0;
  if (best === "class_access" && billingScore > 0 && accessScore > 0) {
    best = "billing";
    bestScore = billingScore;
    secondScore = accessScore;
  }

  const confidence: SupportConfidence =
    bestScore >= 3 && bestScore > secondScore ? "high" :
    bestScore >= 1 && bestScore > secondScore ? "medium" : "low";

  return { intent: best, confidence, queryLength: query.length };
}

/**
 * Search only reviewed/published articles. The caller may pass rows from Postgres, a fixture,
 * or an edge cache; this function never constructs SQL and never treats article text as code.
 */
export function searchSupportArticles(
  articles: readonly SupportArticle[],
  value: unknown,
  limit: number = SUPPORT_ARTICLE_RESULT_LIMIT,
): RankedSupportArticle[] {
  const query = normaliseSupportQuery(value);
  const queryTokens = new Set(tokens(query));
  if (!queryTokens.size) return [];

  return articles
    .filter((article) => article.status === "published" && !!article.reviewedBy)
    .map((article) => {
      const haystack = `${article.title} ${article.answer} ${article.keywords.join(" ")}`.toLocaleLowerCase();
      const score = article.keywords.reduce((total, keyword) => {
        const keywordTokens = tokens(keyword);
        if (keywordTokens.length > 1 && query.toLocaleLowerCase().includes(keyword.toLocaleLowerCase())) return total + 3;
        return total + (keywordTokens.every((token) => queryTokens.has(token)) ? 2 : 0);
      }, 0) + (haystack.includes(query.toLocaleLowerCase()) ? 1 : 0);
      return { ...article, score };
    })
    .filter((article) => article.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, Math.min(limit, SUPPORT_ARTICLE_RESULT_LIMIT)));
}

/**
 * Build the next safe step. A low-confidence or article-less query goes to a human, not a
 * confident-sounding invented answer. The AI adapter, when added, must preserve this boundary.
 */
export function resolveSupport(
  value: unknown,
  articles: readonly SupportArticle[] = [],
): SupportResolution {
  const classification = classifySupportQuery(value);
  const matches = searchSupportArticles(articles, value);
  const isFaq = classification.confidence !== "low" && matches.length > 0;
  return {
    mode: isFaq ? "faq" : classification.confidence === "low" ? "clarify" : "handoff",
    classification,
    articles: matches,
    suggestedActions: ACTIONS_BY_INTENT[classification.intent],
  } as SupportResolution;
}

/**
 * Authorize a tool request without ever trusting a model-supplied user id.
 * The route adapter must replace `targetUserId` with the authenticated request user id before
 * calling this function. An absent or mismatched id is refused, including for read operations.
 */
export function canUseSupportReadTool(input: {
  tool: string;
  authenticatedUserId: number | null | undefined;
  targetUserId: number | null | undefined;
}): boolean {
  return (
    SUPPORT_READ_TOOLS.includes(input.tool as SupportReadTool) &&
    Number.isInteger(input.authenticatedUserId) &&
    input.authenticatedUserId !== null &&
    input.authenticatedUserId !== undefined &&
    input.authenticatedUserId === input.targetUserId
  );
}
