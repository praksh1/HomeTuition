/** Additive-only boot guard: Railway deploys code before anyone runs db:push. */
export const SUPPORT_DDL = [
  `CREATE TABLE IF NOT EXISTS "support_articles" (
    "id" serial PRIMARY KEY, "slug" text NOT NULL, "locale" text NOT NULL DEFAULT 'en',
    "title" text NOT NULL, "intent" text NOT NULL, "keywords" text[] NOT NULL DEFAULT '{}',
    "answer" text NOT NULL, "status" text NOT NULL DEFAULT 'draft', "reviewed_by" integer,
    "published_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "support_articles_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "support_articles_slug_locale_idx" ON "support_articles" ("slug", "locale")`,
  `CREATE INDEX IF NOT EXISTS "support_articles_public_idx" ON "support_articles" ("status", "locale", "intent")`,
  `CREATE TABLE IF NOT EXISTS "support_conversations" (
    "id" serial PRIMARY KEY, "user_id" integer NOT NULL, "title" text NOT NULL, "ticket_id" integer,
    "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "support_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "support_conversations_ticket_id_disputes_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "disputes"("id") ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "support_conversations_user_idx" ON "support_conversations" ("user_id", "updated_at")`,
  `CREATE TABLE IF NOT EXISTS "support_messages" (
    "id" serial PRIMARY KEY, "conversation_id" integer NOT NULL, "role" text NOT NULL,
    "body" text NOT NULL, "source" text NOT NULL, "article_id" integer, "helpful" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "support_messages_conversation_id_support_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "support_conversations"("id") ON DELETE CASCADE,
    CONSTRAINT "support_messages_article_id_support_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "support_articles"("id") ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "support_messages_conversation_idx" ON "support_messages" ("conversation_id", "id")`,
  `CREATE TABLE IF NOT EXISTS "support_ai_usage" (
    "id" serial PRIMARY KEY, "day" text NOT NULL, "subject" text NOT NULL, "used" integer NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "support_ai_usage_day_subject_idx" ON "support_ai_usage" ("day", "subject")`,
  `CREATE TABLE IF NOT EXISTS "support_message_usage" (
    "id" serial PRIMARY KEY, "window" text NOT NULL, "user_id" integer NOT NULL,
    "used" integer NOT NULL DEFAULT 0,
    CONSTRAINT "support_message_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "support_message_usage_window_user_idx" ON "support_message_usage" ("window", "user_id")`,
] as const;
