# Fadko Support Assistant — architecture and handoff

Status: design + deterministic safety core prepared on `codex/unified-messages-inbox`.

This document is the handoff for the next implementation pass. It is intentionally honest about
what is already in Fadko and what is not. No AI provider, new support table, payment operation or
production deployment was added by this pass.

## Product goal

Fadko Support should feel like a calm, modern assistant rather than a long form. A user should be
able to tap a floating Support button, choose a quick topic or type a question in plain language,
see a short answer when Fadko has a reviewed answer, and reach a human without repeating the story.

The assistant is a routing and explanation layer. It is not an operator, a refund engine, a
teacher, or an account administrator.

## What the repository already has

The existing support path is stronger than the pasted generic Supabase brief assumes:

- `artifacts/sikshya/app/support.tsx` is the authenticated issue form. It can attach a recent
  class, collect evidence, upload a file, and create a dispute.
- `artifacts/sikshya/app/requests.tsx` and `app/request/[id].tsx` show a user's own requests and
  the durable lifecycle/history.
- `artifacts/sikshya/app/(admin)/index.tsx` and `ticket/[id].tsx` are the operator desk. The
  server, not the client, enforces operator access and lifecycle transitions.
- `artifacts/api-server/src/routes/disputes.ts` provides `/support/sessions`, `/disputes`,
  `/disputes/mine`, `/disputes/:id` and cancellation. A class-linked report is checked against
  actual membership and can use attendance/session evidence.
- `artifacts/api-server/src/routes/admin.ts` provides the operator queue, evidence view,
  assignment, notes, and status transitions. Operator actions are audited.
- `lib/db/src/schema/disputes.ts` already contains `disputes` and `ticket_events`.
- `lib/db/src/schema/messages.ts` and the notification event tables already provide durable
  communication primitives that can be reused for a human handoff notification.
- Authentication is the existing `requireAuth` / `requireAdmin` middleware. The support assistant
  must use the authenticated request user; it must never trust a user id supplied by a model or
  browser.

The web app is deployed as Cloudflare static assets (`wrangler.jsonc`). The API is an Express
service with Drizzle/Postgres (`artifacts/api-server`). There is currently no Workers AI binding
in `wrangler.jsonc`, no Vectorize binding, and no second AI service. Do not add one silently.

## Work completed in this pass

`artifacts/api-server/src/lib/supportAssistant.ts` is a dependency-free deterministic core:

1. Bounds and normalises a user query (maximum 1,200 characters, controls removed).
2. Classifies common Fadko intents: billing, class access, messaging, homework, account, safety,
   and general.
3. Searches only reviewed/published articles supplied by the caller, with a small deterministic
   ranker. Draft articles cannot answer a user.
4. Returns `faq`, `clarify`, or `handoff`; low-confidence text never receives a made-up answer.
5. Suggests safe navigation actions only.
6. Exposes an allow-list of account-scoped read tools and refuses cross-user reads and every write,
   money, role, SQL, or deletion operation.
7. Provides privacy-safe query metrics (length/presence only), not raw text logging.

The accompanying `supportAssistant.test.ts` proves query bounds, intent routing, draft exclusion,
prompt-injection-shaped text going to clarification/handoff, and account-scoped tool refusal.

`artifacts/api-server/src/lib/supportAiProvider.ts` is the equally dependency-free provider
boundary. It currently returns a safe disabled result through `NullSupportAIProvider`; it does not
pretend that Workers AI is configured. Its parser recognises these future server-side variables:

```text
SUPPORT_AI_ENABLED=false
SUPPORT_AI_PROVIDER=none             # later: workers-ai or external
SUPPORT_AI_DAILY_LIMIT=0
SUPPORT_AI_USER_DAILY_LIMIT=0
SUPPORT_AI_MAX_INPUT_CHARS=1200
SUPPORT_AI_MAX_OUTPUT_TOKENS=300
SUPPORT_AI_TIMEOUT_MS=6000
SUPPORT_AI_MAX_RETRIES=1
```

The values are bounded and malformed values cannot enable AI. Keep secrets (provider keys,
bindings and tokens) out of the repository and out of the browser bundle.

### Premium shell now implemented

`artifacts/sikshya/components/support/SupportAssistantLauncher.tsx` is now mounted in both the
teacher and student tab shells. It provides a floating, safe-area-aware support entry point that
becomes a right-side panel on laptop widths and a compact bottom sheet on phones. It includes a
calm transcript, topic shortcuts, a bounded composer, and direct links to the existing human
request queue. While AI is disabled, typed text is kept in the panel and the reply is deliberately
honest: it routes the person to a request instead of pretending a model answered.

The `/support` and `/requests` screens now carry the same product language: a branded support
hero, quick topic cards, a clear status surface, and an inbox-style request summary. This is a
presentation layer only; it does not change entitlement, payments, or operator authority.

## Recommended implementation order

### Phase 1 — reviewed FAQ search (low risk, no AI cost)

- Keep the implemented shell and quick topics deterministic. Do not connect the composer to an
  unreviewed model yet.
- Add an additive `support_articles` table or reuse a versioned seed file only after deciding who
  reviews/publishes copy. Minimum fields: `slug`, `title`, `intent`, `keywords`, `body`, `status`,
  `locale`, `reviewed_by`, `published_at`, `updated_at`.
- Add `GET /support/articles/search?q=` using bound parameters and the same published gate as the
  pure helper. Never use arbitrary SQL from a user query.
- On no match, show two buttons: “Open a support request” and “View my requests”. Preserve the
  original text when opening the existing form so the user does not repeat it.

### Phase 2 — durable assistant conversation and human handoff

- Add additive `support_conversations` and `support_messages` tables, or a single support thread
  model if the existing messages contract is extended. Keep support threads distinct from teacher
  and class conversations.
- Store only the user-visible transcript and the minimal account id needed for ownership. Do not
  store hidden prompts, full model context, access tokens, or raw tool payloads.
- Create a ticket only when the user chooses human help or the deterministic resolver cannot answer.
  Reuse `disputes`/`ticket_events`; do not create a second operator queue.
- Notify the user through the existing durable notification inbox when an agent replies. Reading
  the support thread should mark that notification read account-wide, like the message fixes.

### Phase 3 — optional AI escalation behind a kill switch

- Define a provider interface with a `NullProvider` default and an explicit `WorkersAiProvider`
  adapter later. The adapter must be called only after the deterministic search returns no safe
  article, never for every keystroke.
- The current API runs on Railway. A Workers AI binding belongs in a separate Cloudflare Worker or
  an explicitly planned API deployment; adding an AI binding to the static asset Worker would not
  make the Railway API able to call it. Decide this deployment boundary before coding the adapter.
- Add per-user and global budgets, request timeouts, maximum input/output sizes, and a circuit
  breaker. If the provider is absent, slow, over budget, or errors, the user gets the human
  handoff path immediately.
- Send the model only the normalised question plus a small reviewed article excerpt and a minimal
  role/locale context. Never send a whole account, class roster, payment ledger, private message,
  or support attachment by default.

### Phase 4 — controlled read tools (after the first AI pilot)

Only these account-scoped read operations should be considered initially:

- current user's profile completeness;
- current user's own support requests and a specific request's public history;
- current user's enrolled classes and access state;
- current user's payment/receipt status, in a redacted display form.

The route derives the user id from `req.user`. The model may request a tool name and a bounded
purpose; the server selects the record and validates ownership. The model cannot provide an
arbitrary id, update a role, edit contact information, issue a refund, release a payout, alter an
enrollment, run SQL, or delete an account. Refunds and payouts remain the existing system/operator
workflows with evidence and audit history.

## Cost plan

1. Deterministic FAQ and navigation handle the majority of questions at no model cost.
2. Keep AI disabled by default in local, preview, and production until the owner explicitly enables
   it with a server-side configuration value.
3. Prefer a small/low-cost Workers AI text model only for unanswered questions, with hard request
   and daily budgets. Do not add embeddings or Vectorize until FAQ search data proves insufficient.
4. Cache identical normalised questions for a short period only if the answer contains no
   account-specific data. Never cache account or payment answers across users.
5. Track counts and latency, not transcript content: deterministic hit rate, handoff rate, AI
   calls, errors, and budget refusals.

Exact model names, limits and pricing must be checked against current Cloudflare documentation at
implementation time. No price is assumed in this document.

## Safety and privacy contract

- A user message is data, not instructions. “Ignore previous instructions” or a request to reveal
  prompts/keys must become clarification or handoff.
- The assistant must say when it does not know. It must not invent payment, refund, class, tax,
  teacher-approval, or payout facts.
- Safety/harassment reports go directly to the existing human request flow, with evidence options.
- Payment/refund answers are explanatory only. The assistant cannot approve, deny, or mark a refund.
- Contact details and other sensitive fields are never printed in analytics. Original payment
  method and changed-phone warnings remain the existing support copy.
- Rate-limit the assistant separately from ticket creation so a model loop cannot fill the support
  queue or consume a budget.

## Acceptance gates before enabling AI

- Unit tests for all intent and article ranking boundaries, including empty, long, multilingual,
  and injection-shaped input.
- Route tests proving unpublished/draft articles are invisible and a user cannot read another
  user's support thread or request.
- Tool tests proving every write/money/role/SQL/delete request is refused.
- Browser tests at mobile and laptop widths for floating button, bottom sheet/right panel, keyboard
  navigation, focus return, reduced motion, and human handoff.
- Failure tests for missing provider, timeout, budget exhaustion, malformed model output, and
  database outage. All must fall back to the existing human support form.
- Preview-only rollout with AI disabled, then an explicit staging flag, then a small production
  percentage. No real payments or refunds are part of this feature.

## Next action for the higher-end model

1. Review this document and the two new `supportAssistant` files.
2. Decide whether the first article catalogue is a versioned seed file or an additive Postgres
   table; do not create both.
3. Implement Phase 1 UI + search route using the existing support form and ticket queue.
4. Add route/browser tests before any AI provider work.
5. Only after those gates, implement a provider interface and a disabled-by-default Workers AI
   adapter with measured budgets.

The current branch also contains the separate premium navigation/message work described in
`docs/FADKO-OVERNIGHT-HANDOFF.md`. Keep that work and this support work in separate commits so a
support rollback cannot remove navigation polish.
