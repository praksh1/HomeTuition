# Fadko Support Assistant — rollout and owner guide

## What this release does

- Teachers and students see a floating Help button on Profile. The Profile menu also has **Ask Fadko**.
- The assistant answers from the operator-reviewed Help Library. Drafts and archived copy cannot answer anyone. A short greeting is answered locally without an AI call.
- If no reviewed answer fits, it says it does not know. **Ask a person** creates one existing support request with the conversation attached; retries return the same request. The operator continues in the existing Tickets desk. There is no second queue.
- A user can see only their own assistant conversation. Assistant answers can be rated helpful/not helpful.
- The operator's Tickets screen links to the **Help Library**, where a draft is written, checked, published, edited or removed from assistant answers.
- A server-side limit of 12 messages per minute and 100 per day per account prevents transcript spam. AI has separate atomic global, per-user and per-IP daily request budgets.

## What it does not do

- It does not approve refunds, move money, change bookings, edit profiles or impersonate an operator.
- It does not send whole accounts, messages, rosters, attachments or ledgers to a model. The optional model receives only a bounded, redacted question and up to three reviewed help excerpts.
- It is not a promise of 24-hour human availability. No page says an agent is online.
- No AI provider is enabled by code deployment alone. With the flag off or key missing, reviewed answers and human handoff work without model spending.

## Free-first AI choice

The optional provider is **Cloudflare Workers AI**, called directly by the Railway API via Cloudflare's documented REST endpoint. The selected model is `@cf/zai-org/glm-4.7-flash`, a small multilingual text model. The website and phone bundle never receive the token.

As documented on 21 September 2026, Workers AI includes **10,000 free Neurons/day**. On a Workers Free account, requests beyond that allocation fail; on a Workers Paid account, excess usage can be billed. Free use cannot be promised indefinitely if traffic grows or Cloudflare changes terms. The application therefore defaults AI to off and uses request-count limits, but these are not a precise Neuron meter. Check the Cloudflare AI usage dashboard and account plan before activating it; never reuse the broad deployment token as the inference token.

Official references: [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [model details](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/), [REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/), [data use](https://developers.cloudflare.com/workers-ai/platform/data-usage/).

## Preview activation, in order

1. Deploy the API and website from the same support commit to staging; verify `/api/healthz`, Profile and the operator desk. Both must point to the staging database. The additive tables are created on server boot.
2. In the staging operator account, open **Tickets → Fadko help library**. Draft a few answers using the exact current product behavior. Review every claim; publish only those you are willing for users to read. The draft topics in `FADKO-SUPPORT-KB-REVIEW-DRAFT.md` are prompts, not facts.
3. As staging student and teacher, ask a matching question and confirm the answer is attributed to a reviewed help article. Ask an unknown question and confirm it admits uncertainty; use **Ask a person** and check the request appears in both My requests and the operator queue. Try two browsers/accounts and confirm one cannot see the other's conversation.
4. AI stays off for this pass. To pilot it later, inspect the Cloudflare Workers plan and create a scoped Workers AI inference token in the owner's signed-in account. Store the account ID and token **only** on the staging Railway API service. Set `SUPPORT_AI_PROVIDER=workers-ai`, low daily limits (for example 10 global / 2 per user), and `SUPPORT_AI_ENABLED=true` last. If the free allocation or application limit is exhausted, the user must get the human path.
5. Review the Cloudflare AI usage and Fadko support outcomes before considering the production flag. Disable instantly with `SUPPORT_AI_ENABLED=false`. No website rebuild is needed.

## Verification gates

- Shared libraries, API and app typechecks.
- `node --test --experimental-strip-types src/lib/supportAssistant.test.ts src/lib/supportAiProvider.test.ts`.
- `test:support-assistant` against a **disposable local CI database**, proving draft invisibility, operator-only publication, account isolation, helpful feedback, idempotent human handoff and rate limiting. Never run it against staging or production; it creates accounts and writes a ticket.
- `test:profile-ui` at 390px and 1440px, including open panel, reviewed answer and human handoff.
- `lint:design` and `git diff --check`.

## Operational caveats

- The first help library is intentionally empty. The operator must publish reviewed answers; the assistant must not invent content to make the launch feel full.
- The API currently searches reviewed English articles. Nepali copy requires a separately reviewed article; no machine translation is published automatically.
- AI is an optional fallback for non-financial, non-account, non-safety questions when a reviewed excerpt exists but does not itself answer. It cannot make a refund/payout decision and cannot call write tools.
- If the provider, database or network is unavailable, the user can still use the existing support form. A failed question must not be presented as sent.
