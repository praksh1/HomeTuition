import { createHmac } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  activityLogTable, db, disputesTable, moderationFlagsTable, supportAiUsageTable, supportArticlesTable,
  supportConversationsTable, supportMessagesTable, supportCaseLinksTable,
} from "@workspace/db";
import { requireAdmin, requireAuth } from "../middlewares/requireAuth";
import {
  localSupportGuide, localSupportReply, normaliseSupportQuery, resolveSupport, searchSupportArticles, supportFollowUp, supportToneResponse,
  type SupportArticle, type SupportIntent,
} from "../lib/supportAssistant";
import { readSupportAIConfig, redactSupportQuestion, supportAIProviderFromEnv } from "../lib/supportAiProvider";
import { flagContent, flaggedTerms } from "../lib/moderation";
import { allowanceFor, nameOf, recordOpened } from "../lib/ticketStore";
import { ticketRef } from "../lib/tickets";
import { buildSupportReviewBrief, conversationTopic, investigationChoices, supportInvestigation } from "../lib/supportInvestigation";
import { listSupportLessons, readSupportLesson } from "../lib/supportCaseContext";

const router: IRouter = Router();
const FALLBACK = "I don't have a confirmed answer yet. You can ask in another way or send this to Fadko Support. Your question will travel with the request.";
const MAX_ARTICLES = 200;
const MAX_MESSAGE_LENGTH = 1_200;
const MAX_ARTICLE_ANSWER = 3_000;

router.get("/support/assistant/lessons", requireAuth, async (req, res): Promise<void> => {
  try { res.json({ lessons: await listSupportLessons(req.user!.userId) }); }
  catch { res.status(503).json({ error: "Your classes could not be loaded. You can still describe the issue." }); }
});

async function linkedLesson(conversationId: number, userId: number) {
  const [link] = await db.select().from(supportCaseLinksTable).where(eq(supportCaseLinksTable.conversationId, conversationId));
  return link ? readSupportLesson(userId, link.sessionId) : null;
}

let articleCache: { until: number; articles: SupportArticle[] } | null = null;
async function publishedArticles(): Promise<SupportArticle[]> {
  if (articleCache && articleCache.until > Date.now()) return articleCache.articles;
  const rows = await db.select().from(supportArticlesTable)
    .where(and(eq(supportArticlesTable.status, "published"), eq(supportArticlesTable.locale, "en")))
    .orderBy(desc(supportArticlesTable.updatedAt)).limit(MAX_ARTICLES);
  const articles: SupportArticle[] = rows.filter((row) => row.reviewedBy !== null).map((row) => ({
    id: String(row.id), title: row.title, intent: row.intent as SupportIntent,
    keywords: row.keywords, answer: row.answer, status: "published", reviewedBy: String(row.reviewedBy),
  }));
  articleCache = { until: Date.now() + 30_000, articles };
  return articles;
}

function idFrom(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function ownedConversation(conversationId: number, userId: number) {
  const [row] = await db.select().from(supportConversationsTable).where(and(
    eq(supportConversationsTable.id, conversationId), eq(supportConversationsTable.userId, userId),
  ));
  return row ?? null;
}

class BudgetExhausted extends Error {}

async function reserveProviderAttempt(provider: "workers-ai" | "groq"): Promise<boolean> {
  const raw = Number(process.env[provider === "groq" ? "SUPPORT_GROQ_DAILY_LIMIT" : "SUPPORT_WORKERS_AI_DAILY_LIMIT"] ?? 0);
  if (!Number.isSafeInteger(raw) || raw < 1 || raw > 1_000) return false;
  const day = new Date().toISOString().slice(0, 10);
  const subject = `provider:${provider}`;
  const result = await db.execute(sql`
    INSERT INTO support_ai_usage (day, subject, used) VALUES (${day}, ${subject}, 1)
    ON CONFLICT (day, subject) DO UPDATE SET used = support_ai_usage.used + 1
    WHERE support_ai_usage.used < ${raw} RETURNING used
  `);
  return result.rows.length === 1;
}

/** Daily and minute counters are reserved atomically, across API instances and restarts. */
async function reserveMessageBudget(userId: number): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    await db.transaction(async (tx) => {
      for (const [window, limit] of [[`day:${now.slice(0, 10)}`, 100], [`minute:${now.slice(0, 16)}`, 12]] as const) {
        const result = await tx.execute(sql`
          INSERT INTO support_message_usage ("window", user_id, used) VALUES (${window}, ${userId}, 1)
          ON CONFLICT ("window", user_id) DO UPDATE SET used = support_message_usage.used + 1
          WHERE support_message_usage.used < ${limit}
          RETURNING used
        `);
        if (result.rows.length !== 1) throw new BudgetExhausted();
      }
    });
    return true;
  } catch (error) {
    if (error instanceof BudgetExhausted) return false;
    throw error;
  }
}

/** One database transaction reserves all three budgets before any billable AI call. */
async function reserveAiBudget(userId: number, ip: string): Promise<boolean> {
  const config = readSupportAIConfig(process.env);
  if (!config.enabled || config.dailyLimit < 1 || config.userDailyLimit < 1) return false;
  const day = new Date().toISOString().slice(0, 10);
  const ipHash = createHmac("sha256", process.env.SESSION_SECRET ?? "support-ip")
    .update(ip).digest("hex").slice(0, 24);
  const limits: Array<[string, number]> = [
    ["global", config.dailyLimit], [`user:${userId}`, config.userDailyLimit],
    [`ip:${ipHash}`, Math.min(config.dailyLimit, Math.max(config.userDailyLimit * 10, 20))],
  ];
  try {
    await db.transaction(async (tx) => {
      for (const [subject, limit] of limits) {
        const result = await tx.execute(sql`
          INSERT INTO support_ai_usage (day, subject, used) VALUES (${day}, ${subject}, 1)
          ON CONFLICT (day, subject) DO UPDATE SET used = support_ai_usage.used + 1
          WHERE support_ai_usage.used < ${limit}
          RETURNING used
        `);
        if (result.rows.length !== 1) throw new BudgetExhausted();
      }
    });
    return true;
  } catch (error) {
    if (error instanceof BudgetExhausted) return false;
    throw error;
  }
}

router.get("/support/assistant/articles", requireAuth, async (req, res): Promise<void> => {
  try {
    const query = normaliseSupportQuery(req.query.q);
    const articles = await publishedArticles();
    const matches = query ? searchSupportArticles(articles, query) : [];
    res.json({ articles: matches.map(({ id, title, answer, score }) => ({ id, title, answer, score })) });
  } catch {
    res.status(503).json({ error: "Help is temporarily unavailable. You can still open a support request." });
  }
});

router.get("/support/assistant/conversations", requireAuth, async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(supportConversationsTable)
      .where(eq(supportConversationsTable.userId, req.user!.userId))
      .orderBy(desc(supportConversationsTable.updatedAt)).limit(20);
    res.json({ conversations: rows });
  } catch {
    res.status(503).json({ error: "Could not load your support history right now." });
  }
});

router.get("/support/assistant/conversations/:id", requireAuth, async (req, res): Promise<void> => {
  const id = idFrom(req.params.id);
  if (!id) { res.status(404).json({ error: "Conversation not found." }); return; }
  try {
    const conversation = await ownedConversation(id, req.user!.userId);
    if (!conversation) { res.status(404).json({ error: "Conversation not found." }); return; }
    const messages = await db.select().from(supportMessagesTable)
      .where(eq(supportMessagesTable.conversationId, id))
      .orderBy(asc(supportMessagesTable.id)).limit(100);
    const lastReply = messages.at(-1);
    const lastQuestion = messages.at(-2);
    const followUp = lastReply?.role === "assistant" && ["handoff", "local"].includes(lastReply.source) && lastQuestion?.role === "user"
      ? supportFollowUp(lastQuestion.body, resolveSupport(lastQuestion.body).classification.intent) : null;
    const caseContext = await linkedLesson(id, req.user!.userId);
    res.json({ conversation, messages, caseContext,
      suggestedReplies: followUp && followUp.prompt === lastReply?.body ? followUp.choices : investigationChoices(lastReply?.body ?? "") });
  } catch {
    res.status(503).json({ error: "Could not load this conversation right now." });
  }
});

router.post("/support/assistant/messages", requireAuth, async (req, res): Promise<void> => {
  const raw = req.body?.message;
  if (typeof raw !== "string" || !raw.trim() || raw.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: "Write a question of up to 1,200 characters." }); return;
  }
  // Do not store obvious credentials or payment numbers in either the assistant transcript or
  // the human ticket copied from it. Account identity comes from the JWT, not typed contact data.
  const message = redactSupportQuestion(normaliseSupportQuery(raw));
  const requestedId = req.body?.conversationId == null ? null : idFrom(req.body.conversationId);
  if (req.body?.conversationId != null && !requestedId) {
    res.status(400).json({ error: "Invalid conversation." }); return;
  }
  const userId = req.user!.userId;
  try {
    const conversation = requestedId ? await ownedConversation(requestedId, userId) : null;
    if (requestedId && !conversation) {
      res.status(404).json({ error: "Conversation not found." }); return;
    }
    if (conversation?.ticketId) {
      res.status(409).json({ error: "This conversation has been sent to support. Open My requests or start a new question." }); return;
    }
    const selectedId = req.body?.sessionId == null ? null : idFrom(req.body.sessionId);
    if (req.body?.sessionId != null && !selectedId) { res.status(400).json({ error: "Choose a valid lesson." }); return; }
    const caseContext = selectedId ? await readSupportLesson(userId, selectedId) : requestedId ? await linkedLesson(requestedId, userId) : null;
    if (selectedId && !caseContext) { res.status(404).json({ error: "This lesson is not available for your account." }); return; }
    const history = requestedId ? (await db.select({ role: supportMessagesTable.role, body: supportMessagesTable.body })
      .from(supportMessagesTable).where(eq(supportMessagesTable.conversationId, requestedId))
      .orderBy(desc(supportMessagesTable.id)).limit(48)).reverse() : [];
    if (!(await reserveMessageBudget(userId))) {
      res.status(429).json({ error: "That is a lot of questions at once. Please wait a little, or open a support request." }); return;
    }
    const articles = await publishedArticles();
    const resolved = resolveSupport(message, articles);
    const topic = conversationTopic(resolved.classification.intent,
      history.filter((turn) => turn.role === "user").map((turn) => resolveSupport(turn.body).classification.intent));
    const top = resolved.articles[0];
    const localReply = localSupportReply(message);
    const toneReply = supportToneResponse(message, flaggedTerms(message));
    const guideReply = localSupportGuide(message);
    let answer = toneReply?.message ?? localReply ?? (resolved.mode === "faq" && top ? top.answer : guideReply ?? FALLBACK);
    let source: "local" | "faq" | "ai" | "handoff" = toneReply || localReply || (guideReply && resolved.mode !== "faq")
      ? "local" : resolved.mode === "faq" && top ? "faq" : "handoff";
    const config = readSupportAIConfig(process.env);
    // Linked account diagnostics stay on Fadko, never in an external inference request.
    const aiAllowedIntent = !caseContext && !["billing", "account", "safety"].includes(topic);
    if (!toneReply && source === "handoff" && config.enabled && aiAllowedIntent && resolved.articles.length > 0) {
      if (await reserveAiBudget(userId, req.ip ?? "unknown")) {
        const result = await supportAIProviderFromEnv(process.env, fetch, reserveProviderAttempt).generateResponse({
          question: message,
          knowledge: resolved.articles.map((article) => `${article.title}: ${article.answer}`),
          role: req.user!.role === "teacher" || req.user!.role === "student" ? req.user!.role : "unknown",
          locale: "en",
          history: history.filter((turn) => turn.role === "user" || turn.role === "assistant")
            .slice(-6).map((turn) => ({ role: turn.role as "user" | "assistant", body: turn.body })),
        });
        if (result.kind === "answer") { answer = result.text; source = "ai"; }
      }
    }
    const followUp = history.length === 0 && !toneReply && !guideReply && (source === "handoff" || source === "local")
      ? supportFollowUp(message, resolved.classification.intent) : null;
    if (followUp) answer = followUp.prompt;
    const investigation = !toneReply && !localReply && !followUp
      ? supportInvestigation({ topic, history, question: message, candidate: answer, candidateSource: source }) : null;
    if (investigation) { answer = investigation.answer; source = "local"; }
    const saved = await db.transaction(async (tx) => {
      let conversationId = requestedId;
      if (!conversationId) {
        const [created] = await tx.insert(supportConversationsTable).values({
          userId, title: message.slice(0, 64),
        }).returning({ id: supportConversationsTable.id });
        conversationId = created!.id;
      }
      if (caseContext) await tx.insert(supportCaseLinksTable).values({ conversationId, sessionId: caseContext.sessionId })
        .onConflictDoUpdate({ target: supportCaseLinksTable.conversationId, set: { sessionId: caseContext.sessionId } });
      const [question] = await tx.insert(supportMessagesTable).values({
        conversationId, role: "user", body: message, source: "user",
      }).returning();
      const [reply] = await tx.insert(supportMessagesTable).values({
        conversationId, role: "assistant", body: answer, source,
        articleId: source === "faq" && top ? Number(top.id) : null,
      }).returning();
      await tx.update(supportConversationsTable).set({ updatedAt: new Date() })
        .where(eq(supportConversationsTable.id, conversationId));
      return { conversationId, question, reply };
    });
    if (toneReply) {
      const recorded = await flagContent({ userId, surface: toneReply.kind === "report" ? "support_safety_report" : "support_chat_abuse",
        subjectId: saved.question.id, text: message });
      // A bullying report need not quote profanity to warrant a human review case.
      if (!recorded && toneReply.kind === "report") {
        try { await db.insert(moderationFlagsTable).values({ userId, surface: "support_safety_report",
          subjectId: saved.question.id, excerpt: message.slice(0, 500), matchedTerms: ["safety report"], status: "open" }); }
        catch { /* The user can still open a support request. */ }
      }
    }
    res.status(201).json({ ...saved, source, caseContext, suggestedActions: resolved.suggestedActions,
      suggestedReplies: investigation?.choices ?? followUp?.choices ?? [],
      article: source === "faq" && top ? { id: top.id, title: top.title } : null });
  } catch (error) {
    req.log.error({ err: error, userId }, "support assistant reply failed");
    res.status(503).json({ error: "I couldn't answer right now. Your existing support request form is still available." });
  }
});

router.post("/support/assistant/messages/:id/feedback", requireAuth, async (req, res): Promise<void> => {
  const messageId = idFrom(req.params.id);
  if (!messageId || typeof req.body?.helpful !== "boolean") {
    res.status(400).json({ error: "Choose helpful or not helpful." }); return;
  }
  try {
    const [message] = await db.select({ id: supportMessagesTable.id, role: supportMessagesTable.role,
      conversationId: supportMessagesTable.conversationId })
      .from(supportMessagesTable).where(eq(supportMessagesTable.id, messageId));
    if (!message || message.role !== "assistant" || !(await ownedConversation(message.conversationId, req.user!.userId))) {
      res.status(404).json({ error: "Answer not found." }); return;
    }
    await db.update(supportMessagesTable).set({ helpful: req.body.helpful ? "yes" : "no" })
      .where(eq(supportMessagesTable.id, messageId));
    res.json({ ok: true });
  } catch { res.status(503).json({ error: "Could not save feedback right now." }); }
});

router.post("/support/assistant/conversations/:id/request", requireAuth, async (req, res): Promise<void> => {
  const id = idFrom(req.params.id);
  if (!id) { res.status(404).json({ error: "Conversation not found." }); return; }
  const userId = req.user!.userId;
  try {
    const conversation = await ownedConversation(id, userId);
    if (!conversation) { res.status(404).json({ error: "Conversation not found." }); return; }
    if (conversation.ticketId) {
      res.json({ ticketId: conversation.ticketId, ref: ticketRef(conversation.ticketId) }); return;
    }
    const allowance = await allowanceFor(userId);
    if (!allowance.ok) { res.status(429).json({ error: allowance.reason, nextAllowedAt: allowance.nextAllowedAt }); return; }
    const messages = await db.select({ role: supportMessagesTable.role, body: supportMessagesTable.body })
      .from(supportMessagesTable).where(eq(supportMessagesTable.conversationId, id))
      .orderBy(desc(supportMessagesTable.id)).limit(48);
    messages.reverse();
    const caseContext = await linkedLesson(id, userId);
    const description = buildSupportReviewBrief(messages, caseContext?.facts);
    const topic = conversationTopic("general", messages.filter((item) => item.role === "user")
      .map((item) => resolveSupport(item.body).classification.intent));
    const safety = messages.some((item) => item.role === "user" && (resolveSupport(item.body).classification.intent === "safety" || supportToneResponse(item.body, flaggedTerms(item.body))?.kind === "report"));
    const reason = safety ? "Inappropriate Behavior" : topic === "billing" ? "Payment Issue" : ["class_access", "messaging", "homework"].includes(topic) ? "Technical Failure" : "Other";
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(supportConversationsTable)
        .where(and(eq(supportConversationsTable.id, id), eq(supportConversationsTable.userId, userId))).for("update");
      if (!locked) return null;
      if (locked.ticketId) return { id: locked.ticketId };
      const [created] = await tx.insert(disputesTable).values({
        userId, reason, description, evidenceUrl: null, sessionId: caseContext?.sessionId ?? null,
      }).returning({ id: disputesTable.id });
      await recordOpened(created!.id, userId, req.user!.role, await nameOf(userId), tx);
      await tx.insert(activityLogTable).values({
        userId, action: "dispute.create", subjectType: "dispute", subjectId: created!.id,
        detail: { from: "support_assistant" },
      });
      await tx.update(supportConversationsTable).set({ ticketId: created!.id })
        .where(eq(supportConversationsTable.id, id));
      return created!;
    });
    if (!result) { res.status(404).json({ error: "Conversation not found." }); return; }
    res.status(201).json({ ticketId: result.id, ref: ticketRef(result.id) });
  } catch (error) {
    req.log.error({ err: error, userId }, "support handoff failed");
    res.status(503).json({ error: "Could not send this to support right now. Please use the support form." });
  }
});

const INTENTS = new Set(["billing", "class_access", "messaging", "homework", "account", "safety", "general"]);
function articleInput(value: unknown): { slug: string; title: string; intent: string; keywords: string[]; answer: string; locale: string } | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const slug = typeof input.slug === "string" ? input.slug.trim().toLowerCase() : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const answer = typeof input.answer === "string" ? input.answer.trim() : "";
  const intent = typeof input.intent === "string" ? input.intent : "";
  const locale = input.locale === "ne" ? "ne" : "en";
  const keywords = Array.isArray(input.keywords) ? input.keywords.filter((item): item is string =>
    typeof item === "string" && item.trim().length > 0 && item.length <= 80).map((item) => item.trim()).slice(0, 20) : [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80 || !title || title.length > 140 ||
      !answer || answer.length > MAX_ARTICLE_ANSWER || !INTENTS.has(intent)) return null;
  return { slug, title, answer, intent, keywords, locale };
}

router.get("/admin/support/articles", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  try {
    const rows = await db.select().from(supportArticlesTable).orderBy(desc(supportArticlesTable.updatedAt)).limit(300);
    res.json({ articles: rows });
  } catch { res.status(503).json({ error: "Could not load help articles." }); }
});

router.post("/admin/support/articles", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const input = articleInput(req.body);
  if (!input) { res.status(400).json({ error: "Check the article title, slug, category and answer." }); return; }
  try {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(supportArticlesTable).values(input).returning();
      await tx.insert(activityLogTable).values({ userId: req.user!.userId, action: "support.article.created",
        subjectType: "support_article", subjectId: row!.id, detail: { slug: row!.slug, locale: row!.locale } });
      return row!;
    });
    articleCache = null;
    res.status(201).json({ article: created });
  } catch { res.status(409).json({ error: "Could not create this article. Its slug may already be in use." }); }
});

router.put("/admin/support/articles/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = idFrom(req.params.id);
  const input = articleInput(req.body);
  const status = req.body?.status;
  if (!id || !input || !["draft", "published", "archived"].includes(status)) {
    res.status(400).json({ error: "Check the article details and publication state." }); return;
  }
  try {
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(supportArticlesTable).set({ ...input, status,
        reviewedBy: status === "published" ? req.user!.userId : null,
        publishedAt: status === "published" ? new Date() : null,
        updatedAt: new Date(),
      }).where(eq(supportArticlesTable.id, id)).returning();
      if (row) await tx.insert(activityLogTable).values({ userId: req.user!.userId,
        action: `support.article.${status}`, subjectType: "support_article", subjectId: row.id,
        detail: { slug: row.slug, locale: row.locale } });
      return row;
    });
    if (!updated) { res.status(404).json({ error: "Article not found." }); return; }
    articleCache = null;
    res.json({ article: updated });
  } catch { res.status(409).json({ error: "Could not save this article. Its slug may already be in use." }); }
});

export default router;
