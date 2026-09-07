# Student monthly journey UI upgrade

- Date: 2026-09-06
- Agent: Codex delegated agent (`student_monthly_journey`)
- Branch: `codex/session-create-ui`
- Base commit: `2ef9d0b`
- Status: complete, awaiting lead review

## Requested

Upgrade the student monthly class list, shared monthly homework, and monthly class chat as one
UI-only slice. Remove raw colours and font sizes, make loading/failure/empty states honest,
remove unsupported values and claims, improve phone/laptop layout and accessibility, preserve
every server/state/transport contract, add focused tests, and leave the work uncommitted.

## Changed

- `artifacts/sikshya/app/(student)/monthly.tsx`
  - Replaced 3 raw hex colours and 14 raw font sizes with `useColors()` / `useLayout()` tokens.
  - Added a first-load failure state with retry instead of also rendering the empty storefront.
  - Removed both `quote?.amount ?? 0` fallbacks. A class without a server quote now says the
    price is unavailable and cannot open `PaymentSheet`.
  - Kept the server quote as the only charged/displayed join price and spells out that it covers
    the remaining classes in this monthly cycle.
  - Added 44px controls and accessible names/states to Join, today's lesson, chat, homework and
    retry actions.
- `artifacts/sikshya/app/monthly-homework.tsx`
  - Replaced 4 raw hex colours and 17 raw font sizes with semantic colour/type tokens.
  - Made first-load failure distinct from an honestly empty homework list and added retry for
    both the homework list and a failed submissions list.
  - Replaced optional submission-count zero fallbacks with “Submission totals unavailable”.
  - Added a reading-width cap on wide screens and >=44px labelled controls for back/new,
    file/open, show submissions, submit, mark and retry actions.
  - Replaced opacity-based busy controls with explicit muted disabled surfaces.
- `artifacts/sikshya/app/monthly-chat.tsx`
  - Replaced 5 raw hex colours and 13 raw font sizes with semantic tokens.
  - Added an explicit invalid-link/failed-first-load state. It does not render an empty writable
    conversation or composer when no conversation response exists.
  - Kept message polling, optimistic reactions, pinning, failed-send restoration and attachment
    behavior unchanged while adding accessible names and >=44px controls.
  - Added a readable wide-screen measure without narrowing phone chat.
- `artifacts/sikshya/utils/monthlyJourneyState.ts`
  - Added import-free state helpers used by the screens: the empty-chat polling path, duplicate-
    safe catch-up merge, submissions loading reducer, and context-sensitive monthly empty copy.
- `artifacts/sikshya/utils/studentMonthlyJourney.test.ts`
  - Added focused behavioral and source-contract tests covering server-quote-only pricing, exact route/payload
    contracts, homework MIME policy, load-vs-empty separation, polling cleanup, optimistic
    reconciliation, failed-send restoration, and the zero raw-design-literal requirement.
- `.agents/backlog/ui-upgrade-progress.md`
  - Recorded all three completed design conversions and the three fabrication/failure-state
    findings.

## Decisions and assumptions

- A refresh failure hides monthly purchase cards rather than allowing a possibly stale price to
  initiate payment. Existing loaded homework/chat content remains present when a later operation
  fails.
- Server-returned `0` submission counts are real. Only a missing optional count is described as
  unavailable.
- A price always says what it buys: remaining classes in this monthly cycle. No new refund,
  delivery, deadline, or read-status promise was added.
- No animation was added; lists remain flat and border-separated for low-cost Android rendering.

## Verification

- Focused test: `pnpm.cmd --filter @workspace/sikshya exec node --test --experimental-strip-types utils/studentMonthlyJourney.test.ts` — **11 passed, 0 failed** after review fixes.
- App typecheck: `pnpm.cmd --filter @workspace/sikshya run typecheck` — **passed** outside the sandbox.
- Design lint before baseline update: **passed, no new leaks**; target improvements are
  `monthly.tsx` 3→0 hex / 14→0 sizes, `monthly-homework.tsx` 4→0 / 17→0, and
  `monthly-chat.tsx` 5→0 / 13→0.
- `git diff --check` — **passed**; Windows only reported expected future LF→CRLF normalization.
- Full app unit suite: `pnpm.cmd --filter @workspace/sikshya run test` — **255 passed, 0 failed** after review fixes.
- Final design lint: **passed, no new leaks** — repository total 101 hex / 295 sizes against
  the current 113 / 339 baseline; the three target files account for all 12 hex and 44 size
  improvements awaiting a combined baseline update.
- Final `git diff --check` — **passed** with only expected Windows LF→CRLF warnings.

## Problems and surprises

- The first sandboxed typecheck could not resolve three already-installed Expo social-auth
  packages through Windows workspace links. Re-running the same command outside the sandbox
  passed; no dependency or package file was changed.
- The first focused run was 5/6 because one source assertion omitted the existing
  `<ChatMessage>` generic on `apiPost`. The product source was correct; the assertion was fixed
  and the rerun passed 6/6.
- A final manual diff review caught two accessibility props accidentally placed as JSX children
  on the “today's class” button. TypeScript permits textual JSX children, so the successful
  typecheck could not catch it. The props were moved onto `TouchableOpacity` before handoff.
- Independent lead review then rejected the first handoff with four valid regressions: an empty
  chat did not poll for its first message; a successful submissions retry retained the old error;
  an enrolled student with no alternative classes saw the global “no classes running” sentence;
  and single-line input minimum heights plus spacing/radius token coverage were incomplete.
  Each was corrected before the final handoff.
- The server route was inspected before changing polling. `GET /monthly/classes/:id/messages`
  explicitly treats an omitted `after` as the latest page, while `after=<id>` is ascending
  catch-up. The app now omits `after` only while the loaded thread is empty and switches to the
  existing incremental path as soon as the first message arrives.
- A second lead review found an overlapping-request order defect in the first merge helper:
  local POST result 74 arriving while catch-up returned 73 and 74 could paint `[72, 74, 73]`.
  The route documents ascending numeric ids, so the merge now deduplicates by id, preserves the
  already-rendered object for a duplicate local/server id, and sorts the combined rows by id.
  Pinned rows are compared by identity and content rather than length, so replacing or editing
  one pin with the same total count is reflected.
- No browser/device render was performed in this delegated slice. Visual/touch/network behavior
  remains for manual verification.

## Fabrications found

- Student monthly join rendered `NPR 0` when `quote` was absent. It now blocks the payment sheet
  and says the price is unavailable.
- All three screens could conflate a failed first load with genuine empty data; chat also left a
  writable composer visible without a loaded server view. Failures are now separate states.
- Missing optional homework counts were displayed as two real zeros. Missing counts now say
  “Submission totals unavailable”; real server zeros remain zeros.

## Deliberately not changed

- No API/server/database/schema, monthly cycle, make-up, attendance, payment, refund, membership,
  booking or session-access logic.
- No endpoint, request payload field, route destination, WebSocket/chat polling contract,
  optimistic/retry behavior, file MIME/size rule, upload/download behavior, or shared app state.
- No Daily/Stream/video work, dependencies, installs, accounts, data, `db:push`, deployment,
  commit, push, purchase, or design-baseline update.

## Remaining risks / next pickup point

Independent review passed after the polling, retry, context-copy, touch-target and chat-order
corrections. Lead acceptance then passed app typecheck, the full **255/255** app unit suite,
design lint and `git diff --check`. The design ratchet was lowered from **113 hex / 339 raw font
sizes** to **101 / 295**; all three target screens are now **0 / 0**.

Manual checks should cover:

- 390px phone and laptop widths; long Nepali/English subject, teacher, file, and message text;
- slow/offline first loads versus genuine empty classes/homework/chat, plus retry recovery;
- quote missing, full class, enrolled class, and next-cycle/no-classes-left states;
- keyboard open with a multiline message, attachment selected/removed, failed send restoration,
  reaction/pin controls, and read-only chat;
- question sheet and submission open/download as both teacher and student; replace submission,
  mark with feedback/file, and every busy/disabled state;
- screen-reader names and physical touch size on a cheap Android phone.
