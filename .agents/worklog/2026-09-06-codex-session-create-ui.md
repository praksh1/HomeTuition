# Teacher session-create allowance and design-system pass

- Date: 2026-09-06
- Agent: Codex (`session_create_upgrade` implementation sub-agent)
- Branch: `main`
- Base commit: `446feb7`
- Status: complete

## Requested

Upgrade only `artifacts/sikshya/app/(teacher)/session-create.tsx` and directly relevant focused
tests/docs. Remove all raw hex colours and raw `fontSize` values, use the existing design tokens,
and replace the tier-limit 402 alert with an accessible in-screen locked/paywall state. The screen
must use the existing `GET /teachers/me/allowance` response and existing navigation, spell out the
billing unit, invent no numbers, and leave server logic, requests, database behavior, payments,
state semantics, and session-creation atomicity unchanged. Do not update the design baseline,
commit, push, deploy, buy anything, run `db:push`, or touch any database.

## Changed

- `artifacts/sikshya/app/(teacher)/session-create.tsx`
  - Added a read-only fetch of `GET /teachers/me/allowance` and distinct loading, loaded, and
    unavailable presentations. An unavailable response is not converted to zero.
  - Shows the server-provided tier name, remaining/limit count, and server-provided price as
    `NPR … per 30 days`. Operator-granted test access is explicitly labelled as temporary and
    not purchased.
  - A full busiest window says that a different date may still fit. It does not pre-disable the
    form, because the authoritative rolling-window rule is candidate-date-specific.
  - A server 402 now replaces the create controls with an in-screen warning. It keeps the
    server's message, shows the server's earliest fitting date when supplied, and routes either
    to teaching-plan options (when an upgrade can help) or scheduled classes. Choosing another
    date clears only this UI refusal; the next submission still goes through the same server
    endpoint and rule.
  - Kept one filled royal-blue primary action. “Create & Go Live Now” is now an outlined blue
    action rather than a green success-coloured action. No handler or request changed.
  - Added responsive type, gutter, spacing, radius, elevation, reading-width and touch-target
    tokens. Phone date/time controls now stack instead of being squeezed into two columns.
  - Added accessibility roles/states to choices and actions, a live region for allowance/refusal
    updates, and 44-point minimum interactive targets.
  - Removed all eight raw colour literals and all fourteen raw font sizes.
  - Replaced the unsupported footer claims with the narrow truth that students can book after
    publication and that the plan allowance is checked at creation.
- `artifacts/sikshya/utils/sessionCreateAllowance.ts`
  - Added import-free presentation helpers for server-owned allowance data and defensive extraction
    of the useful fields attached to a 402 response.
- `artifacts/sikshya/utils/sessionCreateAllowance.test.ts`
  - Added four focused tests for the 30-day billing unit, real remaining count, date-specific full
    wording, honest test-access wording, and malformed 402 detail handling.
- `artifacts/sikshya/scripts/session-create-tests/run.mjs`
  - Added a database-free browser harness that checks the allowance and 402 states at 390×844 and
    1440×900, plus the exact scheduled-create and create-then-go-live request contracts.
  - After independent review found that the first draft matched only the development API host, the
    harness was corrected to own every browser request. It now intercepts `/api/` on any origin,
    blocks WebSockets, service workers, every non-local origin, and any non-read request to the local
    static server. Every permitted API method/path has an explicit fixture; anything else receives
    a failing 599 response and fails the run. A stale web build therefore cannot contact staging or
    production or mutate any data.
  - Scheduled creation now asserts the complete POST body, including the canonical serialized date,
    45-minute duration, NPR 725 price, 15-student capacity and both invited IDs. Go-live asserts its
    complete POST body and current ISO timestamp, then the ordered PATCH `/sessions/502` body
    `{ status: "live" }`. Both successful cases receive explicit in-memory responses.

## Decisions and assumptions

- `remaining === 0` from the summary means the teacher's *busiest* 30-day period is full. It does
  not prove that every future date is blocked. Therefore the summary warns but does not disable
  session creation; only the existing `POST /sessions` 402 creates the locked state.
- No tier name, tier price, next-tier price, or allowance count is copied into the screen. The
  screen uses only fields returned by the two existing endpoints, so it cannot drift from the
  server's price table.
- A failed allowance-summary read leaves the form usable and says the exact allowance will be
  checked at creation. This preserves the old server-authoritative behavior and avoids turning a
  dropped read request into a false zero or a new client-side refusal.
- The existing initial form choices (60 minutes, 20 students, NPR 500) were left unchanged because
  altering defaults changes form state semantics and was expressly outside this UI-only slice.

## Verification

- Focused helper test:
  `pnpm.cmd --filter @workspace/sikshya exec node --test --experimental-strip-types utils/sessionCreateAllowance.test.ts`
  — **4 passed, 0 failed**.
- Browser-harness static syntax check:
  `node --check artifacts/sikshya/scripts/session-create-tests/run.mjs` — **passed**.
- Corrected browser harness:
  `node artifacts/sikshya/scripts/session-create-tests/run.mjs` — **not run past startup** because
  Playwright is not installed. It stopped in `getChromium()` before a browser, page, socket, or API
  request existed. No package was installed to work around this.
- App typecheck:
  `pnpm.cmd --filter @workspace/sikshya run typecheck` — **passed**.
- Full app unit suite:
  `pnpm.cmd --filter @workspace/sikshya run test` — **228 passed, 0 failed**.
- Design ratchet:
  `pnpm.cmd --filter @workspace/sikshya run lint:design` — **no new leaks**; repository total
  **196 hex / 404 font sizes**, and `session-create.tsx` improved **8→0 hex / 14→0 sizes**.
  The baseline was deliberately not updated.
- `git diff --check` — **passed** (only line-ending warnings on existing/edited Windows files).
- A clean-cache static web export completed successfully in **217.4 seconds**, verified as Sikshya
  and deliberately pointed at `http://127.0.0.1:8080`. `web-build` is ignored output and must be
  rebuilt with the correct API address before any deployment.

## Problems and surprises

- Independent review found a real safety flaw in the first browser-harness draft: its route pattern
  named only `http://127.0.0.1:8080/api/**`, so a stale build containing a staging or production API
  origin would have escaped interception. Its permissive fallback also returned `{}` for unknown
  routes, which could hide contract drift. The harness had never launched because Playwright is not
  installed, so this flaw caused no request or data change. The corrected universal, fail-closed
  route and blocked WebSocket/service-worker behavior are described above. No application behavior
  was changed during this correction.

- The first sandboxed typecheck reported three already-declared Expo auth packages as missing.
  `pnpm.cmd install --frozen-lockfile` confirmed the lockfile and install were already current and
  changed nothing. Rerunning outside the sandbox, where TypeScript could follow pnpm's workspace
  junctions, passed with no error.
- The corrected browser harness still could not launch because Playwright is not installed on this
  Windows host. It failed before opening a browser or making any request. No package was installed
  and no paid or external service was used. Its exact UI/request assertions therefore remain
  authored and syntax-checked, but not executed; it is ready for a host/CI image with Playwright.
- The Expo build emitted its pre-existing warning that local resources referenced by Excalidraw's
  CSS are not supported. The export still completed and passed its built-address/name checks.

## Fabrications found

- The footer said “Sikshya records all sessions.” That can be read as video recording, which is not
  built. Only evidence/activity is recorded. Removed rather than weakened into another ambiguous
  promise.
- The footer asserted “Copyrights belong to the platform.” No ownership agreement or product rule
  in the repository supports that claim. Removed.
- The footer said student payments are processed securely through eSewa/Khalti even though the
  current handover says those provider branches are not implemented and configuring them would
  decline bookings. Removed.
- “Duration (max 60 min)” and “Max Students (max 20)” describe what this form offers, not server
  enforcement: the server accepts any positive whole-number duration and capacity. They were left
  as labels of this screen's real controls; they must not be promoted elsewhere as product-level
  guarantees without a server rule.

## Deliberately not changed

- No server route, query, schema, database, allowance rule, tier price, payment code, booking code,
  notification behavior, or session creation/start request.
- No membership, WebSocket, Daily, monthly-class, refund, authentication, or navigation structure.
- No `db:push`, migration, fixture, account, class, booking, payment, purchase, commit, push, or
  deployment.
- No design-baseline update; the lead should run `lint:design:update` only after review accepts the
  file.
- The pre-existing dirty edit in
  `.agents/worklog/2026-09-05-codex-session-proof-integration.md` belongs to the lead and was not
  modified by this task.

## Remaining risks / next pickup point

- Lead review should inspect the uncommitted diff, then run the browser harness on a machine/CI
  image with Playwright. No visual screenshot was produced on this host, so wrapping, paint and
  touch behavior remain unverified despite the build and structural checks.
- After visual acceptance, rerun the focused test, typecheck, full app test, `lint:design`, and
  `git diff --check`; then run `lint:design:update` to lock the file's 0/0 baseline. Commit/push or
  deploy only under the lead/owner's release instructions.

## Lead review, commit, and preview — later 2026-09-06

Codex independently inspected the exact application diff and commissioned a separate read-only
review. That review found no application/business-logic regression, but found the two test-harness
weaknesses recorded above. The implementation agent corrected only the harness and this worklog.
Codex then reran the decisive gates: Sikshya typecheck passed, all **228** app unit tests passed,
`git diff --check` passed, and design lint passed.

The accepted design reduction was locked with `lint:design:update`: the repository baseline moved
from **204 hex / 418 raw font sizes** to **196 / 404**, and the target file is now **0 / 0**.

Two commits were pushed on `codex/session-create-ui`:

- `a44a587` — production-release documentation only;
- `dd25593` — reviewed teacher session-creation/paywall UI, fail-closed browser harness, helper
  tests, and lowered design baseline.

The first attempt to use GitHub's manual preview workflow stopped safely before checkout because
the repository has `CLOUDFLARE_API_TOKEN` but no `CLOUDFLARE_ACCOUNT_ID` secret (run
`34019410440`). Nothing was built or deployed by that failed run. Codex did not weaken the guard or
create/change credentials.

Using the already-authenticated local Wrangler path, Codex rebuilt the bundle with only
`https://hometuition-api-staging-production.up.railway.app`, confirmed the production API hostname
appeared in **0** built files, completed a Wrangler dry-run over 242 assets, and deployed only the
separate `hometuition-preview` Worker. Cloudflare version:
**`a7f2d108-5df7-420e-bb8e-c79523c9b7aa`**.

Post-deploy verification matched the served HTML and all three initial JavaScript bundles exactly
to the local staging build. Preview URL:
`https://hometuition-preview.praksh-dhakal.workers.dev`.

Production was not changed by this UI slice. No API, database, account, session, payment, Daily,
email, R2, credential, or purchase action occurred. The remaining owner check is visual: sign into
the preview as an approved/test-enabled teacher, open New Session, confirm the plan card/form at
phone and laptop widths, and—using staging only—confirm a real 402 refusal becomes the in-screen
locked state rather than an alert.
