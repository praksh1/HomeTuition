# Shared Daily embed UI token and accessibility pass

- Date: 2026-09-06
- Agent: Codex sub-agent (`daily_embed_ui`)
- Branch: `codex/session-create-ui`
- Base commit: `bebd163` (`Record monthly classes preview deployment`)
- Status: complete, uncommitted for lead review

## Requested

- Upgrade only the shared native and web Daily embed components as a design-token, accessibility and responsive-control pass.
- Preserve Daily room/token joining, participant and media behavior, lifecycle callbacks, microphone/camera/screen-share/leave behavior, provider configuration, the single-chat decision and every component prop.
- Remove all raw hex colours and raw `fontSize` declarations without changing the design-lint baseline.
- Add meaningful focused checks for provider and control contracts, run the app gates, and leave the work uncommitted.

## Changed

- `artifacts/sikshya/components/DailyEmbed.tsx`
  - Replaced 43 raw hex colours and 10 raw font sizes with `useColors()`, `useLayout()` and the existing touch/radius/spacing tokens.
  - Kept a dark, contrast-safe video surface using semantic design tokens. Primary blue now identifies the chat-send action; crimson remains only the unread/live-attention marker; Leave is a destructive outline rather than a second filled red action.
  - Increased the native call controls, chat close button and chat send button to the shared 44-point minimum target.
  - Added action-based accessible names for microphone, camera, chat, screen share, send, close and leave controls; exposed chat expanded and screen-share busy/selected states; labelled joining and error states for assistive technology.
  - After independent review, changed the Leave control to the established `destructive` ink/border on `destructiveSoft` surface (**6.30:1**) and the presenter tag to `secondaryForeground` on opaque `secondary` (**12.14:1**). The earlier destructive-on-near-black icon and translucent scrim tag did not provide adequate contrast over video.
  - Moved the native StyleSheet factory outside the component and memoized it on stable token primitives/type/spacing/radius objects. Participant events and chat keystrokes no longer rebuild roughly forty style objects.
  - Guarded native `onLeft` so an SDK event following a failed imperative leave cannot announce the same departure twice. The callback still fires for the one real local departure.
  - Kept the control row within the existing normal-window minimum: five 44-point controls plus the existing gaps fit the 280-point normal call window. The compact call window continues to hide provider controls through the existing shared call-window model.
- `artifacts/sikshya/components/DailyEmbed.web.tsx`
  - Replaced 23 raw hex colours with semantic tokens; the file already had no linter-counted raw React Native font sizes, and all DOM font sizes now also come from the responsive type scale.
  - Tokenized dormant in-call chat spacing/radius/colours and increased its interactive controls to the 44-point minimum. This panel remains disabled in production because the classroom owns the one real slide-over conversation.
  - Added an alert role to the connection-error overlay and kept the existing chat accessible names intact.
- `artifacts/sikshya/utils/dailyEmbedUi.ts` and `.test.ts`
  - Added pure, provider-independent accessible-label, unread-count and participant-selection helpers. Tests pin action wording for every media state, unread behavior while open/closed, the non-negative reset edge case, the first-remote stage rule, screen-share presenter detection and the exact watched-name predicate.
- `artifacts/sikshya/components/DailyEmbedProviderContract.test.ts`
  - Added focused source-contract tests that pin permission-before-join ordering, the authenticated Daily join payload, native media method wiring, watched-participant and local-left callbacks, leave-before-destroy cleanup, web Prebuilt duplicate-control suppression, iframe media permissions, failed-join guarding and the disabled duplicate chat.
- `artifacts/sikshya/scripts/call-leave-tests/run.mjs` and `call-chat-tests/run.mjs`
  - Made the existing harnesses path-safe on Windows: invoke esbuild's JavaScript CLI with the current Node executable, resolve packages from the app's node_modules, and alias React Native to React Native Web for this browser-only bundle. Product behavior and dependencies are unchanged.

## Decisions and assumptions

- This is not a provider redesign. Existing Daily SDK calls, event names, join payloads and lifecycle state were retained exactly and are now guarded by focused tests.
- The video surface uses `foreground`/`secondary` plus inverse text tokens. Light app surfaces would reduce video contrast; new one-off dark colours would violate the system.
- A muted camera/microphone uses the semantic destructive state fill, while the actual Leave action follows the design rule and remains outlined.
- The existing compact/normal/full window model owns responsiveness. This component does not add another resize state or intercept classroom/whiteboard touches.

## Verification

- Raw-design scan over both target files returned no hex literals, `rgba(...)` literals or raw `fontSize` declarations.
- `pnpm --filter @workspace/sikshya run typecheck` passed outside the restricted filesystem view.
- `pnpm --filter @workspace/sikshya run test` passed after review corrections: **244 passed, 0 failed**. This includes three provider-contract tests and three pure UI tests.
- `pnpm --filter @workspace/sikshya run lint:design` passed with no new leaks and reports:
  - native Daily embed: **43 hex → 0, 10 sizes → 0**
  - web Daily embed: **23 hex → 0, 0 sizes → 0**
  - repository current total: **113 hex / 339 sizes** against the committed **179 / 349** baseline.
- `git diff --check` passed after removing one trailing blank line. Git emitted only its existing Windows LF→CRLF warning.

## Problems and surprises

- The first sandboxed typecheck falsely reported three already-declared Expo social-auth modules as missing because the restricted filesystem view could not follow their workspace junctions. The same command outside that view passed; this was unrelated to DailyEmbed.
- The first version of the new source test used the DOM `URL` type with Node `readFileSync`, exposing the project's DOM/Node URL type collision. It now converts `import.meta.url` with Node's `fileURLToPath`; typecheck passes.
- Both existing browser suites initially failed because Node on Windows could not execute their extensionless `.bin/esbuild` shim. A first `.CMD`/shell correction then failed on the repository path's spaces; this was rejected rather than left as a fragile workaround. The final Node+esbuild-JS launcher bundled both components successfully. Each suite then reached the browser stage and stopped because Playwright is not installed. Nothing was installed, per scope. Their behavior is covered by the strengthened contract/pure tests and the full unit suite, but a real browser result was not obtained.

## Fabrications found

- None. The visible states are derived from SDK events, real participants, permission results, chat props and component state. No count, provider capability, delivery promise or availability claim was added.

## Deliberately not changed

- No classroom screen, overlay, pointer-event mapping, call-window reducer or whiteboard code.
- No Daily SDK/Prebuilt setting, room or token path, permission request, screen-share flow, hide/minimize/maximize/resize behavior or bandwidth choice. Participant/media selection is now expressed through pure helpers but is behaviorally identical. The only lifecycle tightening is once-only native local-leave notification.
- Daily's built-in chat was not enabled, and the dormant app-owned in-call panel remains off.
- No Stream POC, backend, payment, database, WebSocket, membership, dependency, native project, provider account or deployment configuration.
- No package installation, purchase, real call, room creation, commit, push, deployment or design-baseline update.

## Remaining risks / next pickup point

- Lead should review the two component diffs, rerun typecheck/unit/design/diff gates, then update the design ratchet only after accepting the slice.
- A real two-device Daily call remains required. On laptop and a cheap Android/iPhone, verify join, remote video/audio, mute/unmute, camera off/on, teacher screen share, student shared-screen view, Leave callback, watched-teacher departure, unread chat badge, compact/normal/full transitions and that the whiteboard still receives touches around the call window.
- Both browser lifecycle harnesses now resolve esbuild portably on Windows and complete their isolated bundles. Browser execution remains unverified because Playwright/Chromium is not installed; nothing was downloaded or installed.

## Lead acceptance

- Independent review accepted the code after corrections to Leave contrast (**6.30:1**), presenter-label contrast (**12.14:1**), native style memoization, provider-behavior guards, and Windows test-harness portability. Its only final finding was the stale harness sentence corrected above.
- Lead reran app typecheck, the full **244/244** app test suite, design lint, and `git diff --check`; all passed.
- The design ratchet was lowered from **179 hex / 349 raw font sizes** to **113 / 339**. Both Daily embed files are now **0 / 0**.

## Commit and preview deployment

- Accepted implementation commit: **`8675b0f`** (`Tokenize and harden Daily video embeds`) on `codex/session-create-ui`, pushed to GitHub.
- Built with `EXPO_NO_DOTENV=1` against `https://hometuition-api-staging-production.up.railway.app`.
- Pre-deploy scan found the staging API in two built files and the production API in zero files; Wrangler dry run passed with 242 assets and no bindings.
- Deployed only the existing `hometuition-preview` Worker. Cloudflare version: **`5489ca58-a40c-4884-ad60-9859fc69198f`**.
- Post-deploy verification passed: served HTML and all three exact JavaScript bundles matched the local staging build.
- Preview: `https://hometuition-preview.praksh-dhakal.workers.dev`
- Production was not changed. No real call, provider setting/account, database, payment, or user data was touched.
