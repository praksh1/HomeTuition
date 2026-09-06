# Teacher monthly-class UI upgrade

- Date: 2026-09-06
- Agent: Codex sub-agent (`monthly_ui_upgrade`)
- Branch: `codex/session-create-ui`
- Base commit: `17487c4`
- Status: complete, uncommitted for lead review

## Requested

- Upgrade only `artifacts/sikshya/app/(teacher)/monthly.tsx` and directly related presentation tests.
- Remove all raw hex colours and raw `fontSize` values through the established tokens without updating the ratchet baseline.
- Preserve monthly-class business rules, request payloads, navigation, payments, state contracts and backend code.
- Keep the daily recurring product unmistakably separate from pay-per-class, put price units in words, audit visible claims against server-owned rules, and provide honest loading/error/empty states.
- Keep controls usable on cheap Android phones: responsive reading width, at least 44 px touch targets, no heavy animation or package.

## Changed

### `artifacts/sikshya/app/(teacher)/monthly.tsx`

- Replaced all 4 raw hex colours and all 24 raw font sizes with `useColors()` and the responsive `useLayout()` type/spacing/radius tokens.
- Centered the reading surface at the existing `readingWidth` ceiling on larger screens while retaining responsive gutters and a single phone column.
- Raised the back control and all visible buttons/inputs to at least `HIT_SLOP_MIN`; added roles and purpose-specific labels to navigation, make-up, leave and retry controls.
- Made price units explicit: the teacher plan and student fee now say **per 30-day cycle** rather than the ambiguous calendar phrase “a month”. Money and count/time text uses tabular figures.
- Replaced hand-built translucent semantic colours with `warnSoft` / `destructiveSoft`, and removed unsafe saffron text use.
- Added a visible initial loading message, a fail-closed whole-plan error with retry, a missed-class/make-up-list error with retry, and loading/error/retry states for saved leave. A failed request no longer paints an apparent empty or purchasable plan.
- Kept stale successfully loaded plan data visible under a refresh-error banner instead of blanking a usable page.
- Rebuilt the class facts as a wrapping two-column phone grid / three-column wider grid so the full student-fee unit can wrap rather than squeeze three long facts into one row.
- Kept make-up scheduling at an arbitrary future date/time inside the current cycle. Copy uses the server-returned `makeupDeadlineHours` when available; if it is missing, the screen points to the per-class deadline rather than inventing 48 hours.
- Suspension duration copy uses the server-returned `suspensionDays` when present and otherwise says “temporarily”.
- Changed the destructive leave removal action to the required outlined rust treatment.
- After independent review, changed the in-editor “Schedule make-up” control to an outlined secondary action. When today's class button is present, it remains the running screen's only filled primary action.
- Added the shared field's visible label as each `TextInput`'s accessible name, so Subject, topic, time, duration, student fee and seat count are distinguishable to assistive technology.
- Narrowed cycle-start and make-up copy after review: the UI no longer claims that an automatically persisted pre-class anchor survives class creation, and it names the server checks that can refuse a proposed make-up without promising every future slot is allowed.

### `artifacts/sikshya/utils/monthlyTeacherUi.test.ts`

- Added eight browser-free source-contract checks: the UI's unavoidable delivery-floor mirror equals the server's `MIN_SESSIONS_PER_CYCLE`; a failed plan request cannot fall back to a fabricated plan price; all five existing write calls keep their exact endpoint and request-body field expressions; success-state transitions and navigation destinations remain pinned; both displayed prices state the 30-day unit; cycle/make-up copy stays narrow; only today's class remains a filled primary while make-up editing is open; and all shared class fields derive their accessible name from the visible label.

### `.agents/backlog/ui-upgrade-progress.md`

- Added the three fabricated/unsupported monthly-screen claims to the standing audit table so the findings survive cross-agent handoff.

## Decisions and assumptions

- The API does not currently publish `MIN_SESSIONS_PER_CYCLE` in the teacher plan response. The existing UI already mirrored 25. Changing the response was outside this UI-only slice, so the mirror was named `DELIVERY_FLOOR`, documented, and pinned to the server source by a focused test rather than silently retaining an unexplained literal.
- `GET /monthly/plan` always returns the real `tierPrice` when it succeeds. On failure, the old screen substituted NPR 6,500 and still opened the purchase UI. The replacement fails closed and never constructs a price from a fallback.
- Cycle-start copy is deliberately narrow. A read can auto-start and persist an unused plan's anchor, but the current class-creation POST later overwrites `cycleAnchor` with class-creation time. The UI states only that saving creates the daily schedule and that the returned active cycle will then be shown; it does not promise which earlier timestamp survives.
- No new eligibility fetch was added. The server still makes the authoritative `mayBuyTeacherPlan()` decision when purchase is attempted; adding another request or response field would violate this slice's data-fetching boundary.

## Verification

- Lead acceptance rerun after all independent-review corrections: app typecheck passed, full app tests passed **238/238**, design lint passed, `git diff --check` passed, and the design ratchet was lowered from **183 hex / 373 raw font sizes** to **179 / 349**.

- Source scan: `rg -n "#[0-9A-Fa-f]{3,8}|fontSize\\s*:" artifacts/sikshya/app/(teacher)/monthly.tsx` returned no matches.
- `pnpm.cmd --filter @workspace/sikshya run typecheck` passed after one corrected attempt.
- `pnpm.cmd --filter @workspace/sikshya run test` passed before independent review: **234 tests, 234 passed, 0 failed**, including the first four monthly teacher UI contracts. Final post-review results are recorded below.
- Final post-review focused `monthlyTeacherUi.test.ts`: **8 passed, 0 failed**.
- Final post-review `pnpm.cmd --filter @workspace/sikshya run typecheck`: passed.
- Final post-review full app suite: **238 tests, 238 passed, 0 failed**.
- Final post-review `lint:design`: passed at **179 current hex / 349 current sizes** against the unchanged **183 / 373** baseline; monthly remains **4→0 / 24→0**.
- Final post-review `git diff --check`: passed with only the existing Windows LF→CRLF warning.
- Final lead-review correction pinned leave deletion and its subsequent `await load()` refresh as one ordered source contract, so the focused suite fails if deletion stops refreshing the saved-leave list. No product code changed for this correction.
- Final lead-review rerun: focused monthly contract **8 passed, 0 failed**; full Sikshya suite **238 passed, 0 failed**; `lint:design` passed at **179 hex / 349 sizes** against the unchanged **183 / 373** baseline; `git diff --check` passed with only Windows LF→CRLF warnings. The app typecheck was attempted but is currently blocked outside this slice by unresolved existing social-login dependencies in `components/SocialSignIn.tsx` (`expo-apple-authentication` and the Facebook/Google provider exports from `expo-auth-session`). This correction changed only the focused test and this worklog; it did not touch that component, package metadata, or installed dependencies.
- `pnpm.cmd --filter @workspace/sikshya run lint:design` passed with no new leaks and reports this screen at **4→0 hex / 24→0 raw sizes**; repository current total is **179 hex / 349 sizes** against the committed **183 / 373** baseline.
- Mutation/navigation comparison against `HEAD` found the same five writes and the same three destinations: plan purchase, class creation, make-up creation, leave creation/deletion, back, today's session, class chat and homework.
- `git diff --check` passed after formatting (Windows printed only its LF→CRLF working-copy warning).

## Problems and surprises

- The first typecheck found that responsive typography tokens had accidentally been included in two `TouchableOpacity` view-style arrays. They belong only on the nested text. Both were removed; the rerun passed.
- The first `git diff --check` found whitespace introduced by the patch. The repository's existing Prettier formatter removed it; the rerun passed.
- The existing screen silently discarded failure of the missed-class endpoint. That detail is actionable—the failure removes the only visible route to schedule a make-up—so it now fails visibly while leaving the rest of the monthly page usable.
- No browser was installed or downloaded for this slice, so the responsive layout was not rendered. Automated checks do not prove wrapping, scrolling or touch behaviour on a real cheap Android phone.
- Independent review rejected the first handoff for five reasons: cycle-start copy endorsed two contradictory server paths; make-up copy promised every future time was allowed; request-contract tests checked endpoints but not exact field sets or transitions; today's filled action could coexist with a second filled make-up action; and shared class inputs lacked input-specific accessible names. All five were corrected without changing handlers or backend code, and the tests were strengthened to keep them corrected.
- The first focused run of the strengthened tests failed because a copy assertion read the raw formatted source and did not tolerate Prettier's line wrap. The product copy itself was correct; the assertion was moved to the already whitespace-normalized source and the focused suite then passed 8/8. This was a test-harness correction only.
- Final lead review found that leave deletion's endpoint was pinned but its post-delete refresh was not. The existing success-transition test now requires the exact delete call to precede `await load()`; this closes the regression gap without altering runtime code.
- The first focused command for the final correction used `pnpm exec tsx`, but this workspace does not expose a `tsx` executable. It made no changes. Rerunning with the package's actual test runner (`node --test --experimental-strip-types`) passed 8/8.

## Fabrications found

- **Fabricated plan price on request failure:** `view?.tierPrice ?? 6500` made an unavailable server answer look like a real price and left purchase available. The failure now shows retry only; the payment sheet is not mounted without a successful plan response.
- **Unsupported “nothing is owed back” verdict:** meeting the global 25-class floor does not prove that no individual student is owed under the separate five-sixths delivery rule. The completion card now says only that the cycle-level floor was met and that student-level checks are assessed separately.
- **Incomplete and then over-broad cycle-start claim:** the original sentence omitted unused-plan auto-start; the first revision then implied that auto-start and class creation formed one consistent clock. They currently do not. The final copy avoids asserting an anchor and the backend inconsistency is recorded below.
- **Hardcoded make-up deadline and suspension duration:** the screen repeated 48 hours and 30 days even though the server already returns both values. It now uses the returned values and honest generic fallbacks.

## Deliberately not changed

- No API route, request body, response contract, query, database schema/data, monthly arithmetic, recurrence generation, make-up validation, delivery/refund rule, payment mode, membership rule or teacher-plan eligibility rule.
- No navigation destination, WebSocket, Daily, classroom, shared auth state, package, lockfile, generated native project or design baseline.
- No commit, push, deployment, external account/data access, `db:push`, purchase or installation.
- Pay-per-class tiers were not redesigned or merged with this product. This remains the separate one-recurring-class monthly product implemented by the server today.

## Remaining risks / next pickup point

- Lead review should independently inspect all mutation payloads, rerun typecheck/test/lint/diff checks, then update the design baseline only if accepting the slice.
- Manual preview checks remain required at phone and laptop widths for long subject/topic text, the six class facts, make-up deadlines, date pickers, leave rows, error/retry states and the payment sheet's 30-day label.
- The plan endpoint does not expose eligibility before purchase, so an unapproved teacher can still open the payment sheet and receive the server refusal only on submission. Solving that without client-side re-derivation needs an existing authoritative eligibility response integrated into this screen, which changes data fetching and was deliberately left for a separately approved slice.
- **Backend cycle-anchor inconsistency:** `GET /monthly/plan` calls `cycleOf()`, which may auto-start and persist an unused plan after `PLAN_AUTOSTART_DAYS`. `POST /monthly/classes` then unconditionally writes `cycleAnchor = startedAt` and generates cycle zero from that newer class-creation time. This can move a cycle that already started. Fixing it affects billing/recurrence behavior and is explicitly outside this UI-only task; it needs a separate product/backend decision and regression tests.
- The owner has discussed replacing current teacher products with a simpler two-product prepaid/postpaid model. That decision is not implemented anywhere in this UI-only pass; the current backend product remains authoritative.
