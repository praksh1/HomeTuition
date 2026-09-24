# Fadko support: free-first, evidence-led implementation

## Owner's goal and authority

One human agent initially. Let the assistant resolve safe technical questions, collect missing information once, and prepare decision-ready payment and safety cases. No AI-issued refunds, payouts, bans, role changes or enrollment changes. No purchases or automatic paid fallback. Automated assistance must not pretend to be a human. Classroom production approval does not authorize releasing the paused support feature to production.

## Implemented in this development slice

- Account-owned conversation history informs the next investigation question. Failed/repeated guidance advances to a bounded investigation, not another copy of the fallback. Device/browser information already supplied is not requested again. A request for a person is always honored.
- A searchable, height-bounded list of up to 50 own lessons can be selected before a conversation. Teacher ownership or the requesting user's enrollment is enforced by the API, independently of the dropdown.
- A collapsible records card displays selected lesson status, schedule, the user's own enrollment state, and the shared classroom access-rule result. Test enrollment is explicitly not proof of payment. It does not expose rosters, credentials, payment references or private messages.
- The selected lesson survives reopening a conversation through an additive `support_case_links` table. No existing account/session columns changed.
- Human handoff compiles user reports, checked records, guidance already given, evidence gaps and next review actions. It links the existing ticket to the lesson so the operator's existing evidence timeline/attendance narrative becomes available. This compilation is deterministic, not an AI verdict. No second ticket queue.
- Submitted conversations cannot silently change after handoff. User can start another question or use My requests. Frontend request-generation guards prevent a late answer from appearing in a new topic or another signed-in account.
- Bounded Cloudflare → Groq fallback adapter, with separate durable per-provider daily attempt reservations, existing per-user/IP/global budgets, a cooldown after provider errors/rate limits, at most two attempts, and an 8-second overall inference deadline. Unavailable providers return to local guidance/human support. No repeated account/key rotation.
- Groq is OFF unless a server-only key, free-account verification, privacy review and explicit fallback flag are all present. No new provider account or credential has been created by this slice. No private lesson diagnostics, image or recording is sent to either provider. Groq receives no earlier conversation transcript.

## What is NOT complete

This is not yet the complete autonomous support product. There is no claim that it can diagnose every issue or resolve most tickets; that must be measured in a pilot.

1. **Reviewed content:** the Help Library still needs real, reviewed product answers. Context-aware conversation does not repair an empty knowledge base. Existing local navigation guides remain; unknown policy is not invented.
2. **Live provider activation:** verify the actual free plans, model availability, data controls, allowed end-user ages/regions, notice/consent requirements and account limits. Store keys only in staging Railway. Keep inference disabled until this review and sample-answer tests pass. Do not paste keys into chat.
3. **Evidence attachments / vision:** the existing support form securely accepts evidence; the assistant does not yet inspect images or recordings. Build an explicit evidence selector, ownership checks, consent, retention/deletion and a reviewed vision/transcription adapter before doing that. Never download arbitrary user-supplied URLs (SSRF), treat screenshot instructions as data, and preserve original evidence separately from extracted text and uncertain interpretations.
4. **Safety review:** human-only review queue, restricted evidence access, policy citations, uncertainty and conflicting evidence. No inferred guilt from missing attendance. No automatic recording or silent collection of classes/DMs. Obtain appropriate permission for submitted recordings; do not change the existing no-automatic-recording decision.
5. **Payment-specific evidence:** reconcile immutable purchase/refund/provider records, distinguish test ledger from settled real money, and expose only the user's records. Current lesson enrollment state is explicitly not reconciliation. Any approved refund uses the original payment method; changes go to the human agent.
6. **Deeper diagnostics:** add allowlisted current-device tests and session quality evidence with clear provenance. Read-only checks first. No arbitrary SQL, shell execution, model-selected internal endpoints or unreviewed remediation actions.
7. **Operator workspace:** compact case tabs for overview, facts, claims, timeline and evidence; clear missing-info checklist; actions remain existing audited human controls. Persistent source links, not a polished unsourced paragraph.
8. **Pilot and rollout:** adversarial multi-account tests, English/Nepali quality cases, provider outage/quota tests, phone keyboard/focus and large-queue usability. Staging acceptance before a separate support production release.

## Free-provider research — checked 24 September 2026

| Candidate | Practical role | Boundary |
|---|---|---|
| Cloudflare Workers AI | Existing primary adapter; 10,000 free Neurons/day | Workers Free refuses beyond its allowance; Workers Paid can bill overages. Request caps are not a Neuron meter. Check actual account plan. |
| Groq Cloud | Candidate second free API; adapter built, not activated | Organization/model-specific token and request limits. Enable Zero Data Retention and verify terms before customer use. Account review still pending. |
| Cerebras | Possible later candidate | Free tier documented; exact active model/quota and applicable privacy terms must be reviewed before adding an adapter. Not implemented or activated. |
| OpenRouter free models | Possible low-volume public-help experiment | Free account allowance is limited; model/provider data policies differ. Never use an unrestricted auto-router for private student evidence. Not implemented or activated. |
| Gemini API | Excluded for this student-facing app | Current terms prohibit API clients likely to be accessed by under-18s; unpaid services also prohibit sensitive/personal submissions and permit improvement/human review. |
| Consumer ChatGPT/Copilot/Gemini accounts | Not an integration strategy | A consumer subscription/session is not an API allowance. No shared logins, scraping chat sessions, or cycling accounts to defeat quotas. |

Sources:
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://console.groq.com/docs/rate-limits
- https://console.groq.com/docs/your-data
- https://ai.google.dev/gemini-api/terms
- https://inference-docs.cerebras.ai/support/rate-limits
- https://inference-docs.cerebras.ai/support/pricing
- https://openrouter.ai/pricing

## Cost commitment

Target **$0 additional AI inference spend**, not a promise of unlimited free capacity or zero hosting/storage/video costs. No billing upgrades, credit purchases or paid-model fallback. Provider account settings are the billing boundary; application counters add defense in depth. When every free allowance is unavailable, retain the conversation, continue deterministic diagnostics and offer one human handoff. Do not repeatedly hammer an exhausted API.

Provider activation variables are documented in `.env.example`. Defaults remain zero/off. The free-account/privacy flags are reviewed operational assertions, not a magical block on a vendor charging a paid account. Reset daily attempt counters by UTC date only; never reset them to bypass exhaustion.

## Review metrics (next slice; not implemented dashboards)

Track helpful/not-helpful, repeated question rate, user-confirmed resolution, escalation rate, operator time per ticket, wrong/misleading answers, latency, budget refusals and provider usage. Do not label a closed chat as successfully resolved. Do not record raw prompts, screenshots or payment details in metrics. Small audited samples should drive provider/model choices, not unsupported claims about accuracy.
