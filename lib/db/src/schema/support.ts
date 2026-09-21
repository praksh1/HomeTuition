import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { disputesTable } from "./disputes";

/** Editorial content is never public until an operator explicitly reviews and publishes it. */
export const supportArticlesTable = pgTable("support_articles", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  locale: text("locale").notNull().default("en"),
  title: text("title").notNull(),
  intent: text("intent").notNull(),
  keywords: text("keywords").array().notNull().default([]),
  answer: text("answer").notNull(),
  status: text("status").notNull().default("draft"),
  reviewedBy: integer("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("support_articles_slug_locale_idx").on(table.slug, table.locale),
  index("support_articles_public_idx").on(table.status, table.locale, table.intent),
]);

export const supportConversationsTable = pgTable("support_conversations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  ticketId: integer("ticket_id").references(() => disputesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("support_conversations_user_idx").on(table.userId, table.updatedAt)]);

export const supportMessagesTable = pgTable("support_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => supportConversationsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  body: text("body").notNull(),
  source: text("source").notNull(),
  articleId: integer("article_id").references(() => supportArticlesTable.id, { onDelete: "set null" }),
  helpful: text("helpful"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("support_messages_conversation_idx").on(table.conversationId, table.id)]);

/** Daily counters are reserved atomically before inference, not after a billable request. */
export const supportAiUsageTable = pgTable("support_ai_usage", {
  id: serial("id").primaryKey(),
  day: text("day").notNull(),
  subject: text("subject").notNull(),
  used: integer("used").notNull().default(0),
}, (table) => [uniqueIndex("support_ai_usage_day_subject_idx").on(table.day, table.subject)]);

/** Durable limits stop one signed-in account filling the support transcript store. */
export const supportMessageUsageTable = pgTable("support_message_usage", {
  id: serial("id").primaryKey(),
  window: text("window").notNull(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  used: integer("used").notNull().default(0),
}, (table) => [uniqueIndex("support_message_usage_window_user_idx").on(table.window, table.userId)]);
