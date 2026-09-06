# Paired teacher and student profile UI upgrade

- Date: 2026-09-06
- Agent: Codex sub-agent (`profile_ui_upgrade`)
- Branch: `codex/session-create-ui`
- Base commit: `2ef9d0b` (`Record session creation preview deployment`)
- Status: complete, uncommitted for lead review

## Requested

- Upgrade `artifacts/sikshya/app/(teacher)/profile.tsx` and `artifacts/sikshya/app/(student)/profile.tsx` together as the next paired design-system slice.
- Keep business logic, API contracts, authentication, navigation, upload/delete/logout behaviour, payments, Daily, WebSockets, membership and backend code unchanged.
- Remove every raw hex colour and raw `fontSize` from both files without updating the design-lint baseline yet.
- Trace visible claims to real data, remove fabricated or stale values, add honest loading/error/empty states, keep touch targets at least 44 px, and make the layout usable at phone and laptop widths.
- Run the focused design check, Sikshya typecheck, full Sikshya unit suite, `git diff --check`, and a clean web export. Render only if already-installed browser tooling is available; install nothing.

## Changed

### Both profiles

- Replaced hard-coded colours, translucent colour strings, font families and all raw `fontSize` declarations with `useColors()` and the responsive type scale from `useLayout()`.
- Rebuilt the screen layout around the responsive `gutter`, shared spacing/radius/elevation tokens, a centered `readingWidth` ceiling on large displays, and a phone-safe single column.
- Made profile navigation and logout rows at least `HIT_SLOP_MIN` tall, added accessibility roles to headings and actions, and gave file-opening actions a 44 px target.
- Changed the destructive logout control from a tinted fill to the design system's required outlined treatment.
- Kept the existing initials avatar rather than inventing an image URL treatment. Its white-on-translucent fill had weak contrast; it now uses dark navy text on a solid card surface.
- Preserved the existing `SocialSignIn`, notification navigation and logout flows. The teacher's My Plan navigation is also unchanged.

### Teacher profile

- Kept credential selection as a first step and upload as a separate explicit action. PDF and supported image MIME types remain unchanged.
- Preserved credential upload, open, delete-before-review, lock-after-open/approval, rejected-file replacement and haptic/notification behaviour.
- Added distinct credential loading, ready and failure UI. A failed credential fetch no longer silently becomes an empty list that invites a teacher to upload duplicates; it shows that nothing was removed and offers a real retry.
- After a successful credential submission and list reload, the screen now awaits the existing `refreshUser()`. Uploading a replacement resets the server-owned teaching profile from rejected to pending; the badge therefore updates without a sign-out/reload. `AuthContext` intentionally absorbs refresh network failures, so a completed upload is not mislabeled as failed by this follow-up.
- Replaced the unsupported “reviewed within 24–48 hours” promise with copy describing only behaviour the server enforces: operator review, rejected-file replacement, and locking after an operator opens a file.
- Relabelled the account approval states as “Teaching profile approved”, “Teaching review pending” and “Teaching review needs action”. These describe the actual `teacher_profiles.approval_status` state without claiming that a teacher who still lacks email verification or a paid/test plan can already schedule classes.
- Removed the separate “Under review” badge from the credential card. Account status `pending` does not prove that an operator has opened any document; each document continues to show its own real `submitted`, `opened`, `approved` or `rejected` state.
- A teacher with zero reviews now sees “No student reviews yet”; `0.0 (0 reviews)` is no longer presented as a poor rating. Real non-zero rating and review counts still come from the review aggregate and use tabular figures.
- Replaced the unsafe saffron pending text with the contrast-safe `warn` token and paired semantic states with their soft background tokens.
- Added document-specific screen-reader labels to Select/Choose another, Upload and Delete while preserving the compact visible labels.

### Student profile

- Replaced the fabricated “Verified Student” badge with the actual `emailVerified` state supplied by `/auth/me`: “Email verified” or “Email not verified”.
- Removed “0 sessions attended”. `AuthContext` always constructs `enrolledSessions: []`; no server response populates it, and enrolment is not the same as attendance. The profile now makes no attendance-total claim.
- Kept real account email and grade data, with an honest “Grade not added yet” fallback instead of a blank label.
- Kept the payment section non-interactive and provider-neutral. It now says only that methods are not saved to the profile and any option offered during booking applies to that booking; it no longer implies that eSewa/Khalti is necessarily available or that any account was charged.

## Decisions and assumptions

- No shared presentation helper was added. The two screens share visual rules but not enough behavioural logic to justify a new abstraction; keeping each screen explicit avoids coupling teacher credential states to the simpler student profile.
- A browser-free focused source contract was added for the two review-sensitive invariants: refresh follows a successful credential POST/list load, and every credential action's accessible name includes its document type.
- The existing `readingWidth` token is appropriate because these are reading/settings surfaces, not grids or whiteboards.
- An overall student attendance count was removed, not replaced with another number. The existing client field cannot support it and changing the API was explicitly out of scope.
- The credential list fails closed on fetch error. Showing four apparently empty upload slots after a network failure could cause a duplicate submission; retry is safer and does not change server behaviour.
- After independent review, the lead accepted the slice and ran `lint:design:update`. The ratchet is now locked at **183 hex / 373 raw font sizes** (down from **196 / 404**).

## Verification

- Source check: `rg -n '#[0-9A-Fa-f]{3,8}|fontSize\\s*:'` against both target files returned no matches.
- Focused design check: `pnpm.cmd --filter @workspace/sikshya run lint:design` passed with no new leaks. It reports:
  - student profile: **7 hex → 0, 15 sizes → 0**
  - teacher profile: **6 hex → 0, 16 sizes → 0**
  - repository current total: **183 hex / 373 sizes**; recorded baseline remains **196 / 404**.
- `pnpm.cmd --filter @workspace/sikshya run typecheck` passed when run outside the restricted filesystem view.
- Focused `node --test --experimental-strip-types artifacts/sikshya/utils/profileCredentialUi.test.ts` passed: **2 tests, 2 passed, 0 failed**. It checks the successful-upload refresh ordering and all four document-specific accessible-name templates without a browser or network.
- `pnpm.cmd --filter @workspace/sikshya run test` passed after adding that focused contract: **230 tests, 230 passed, 0 failed**.
- `git diff --check` passed. Git emitted only the existing Windows LF→CRLF working-copy warning.
- Lead verification after the review fixes also passed: app typecheck, the complete **230/230** app test suite, design lint, ratchet update, a second design-lint run against the lowered baseline, and `git diff --check`.
- Clean web export passed with `EXPO_PUBLIC_API_URL=http://127.0.0.1:8080` and `EXPO_EXPORT_MAX_WORKERS=2`. Metro rebuilt from an empty cache, exported 3 web files plus assets/bundles, verified the local-only API target in the bundle, and verified the app name as Sikshya.

## Problems and surprises

- The first web-build attempt failed before Expo started because no deployment domain or explicit API URL was present in this shell. This was an environment requirement, not a source failure. It was rerun with the loopback-only `http://127.0.0.1:8080` target and passed.
- The first typecheck inside the restricted sandbox reported three installed Expo social-auth packages as missing. The package manifest, lockfile and package directories all contained them. Rerunning the same checker outside that restricted junction view passed with no source errors.
- Already-installed browser tooling was checked through the repository's own browser harness. It reported that Playwright was not installed. Per the instruction, nothing was downloaded or installed, so no visual render or screenshot was produced.
- Metro printed its existing warning that local resources inside Excalidraw CSS are not supported. The export completed and this warning is unrelated to either profile.
- Independent review caught two omissions before handoff: a replacement credential changed `approval_status` on the server but the profile badge retained the stale rejected user object, and repeated visible labels such as “Upload” did not identify a document to screen readers. Both were corrected, given the focused source contract above, and the full gates were rerun.

## Fabrications found

- **Student “Verified Student”:** no student approval/identity-verification state exists. The screen now reports only real email verification.
- **Student sessions attended:** `mapApiUserToUser()` sets `enrolledSessions` to an empty array for every student, and the API profile response does not supply an attendance total. The permanent zero was removed.
- **Teacher review SLA:** no server-side 24–48 hour deadline, scheduler or enforcement was found. The time promise was removed.
- **Credential “Under review” from account state:** a pending teaching profile does not establish that an operator opened a particular document. The card-level badge was removed; only each credential's stored status is shown.
- **Teacher zero rating:** review count and rating are real aggregates, but presenting an unrated teacher as `0.0` makes “not reviewed” read as “badly reviewed”. Zero reviews now receives a categorical empty state instead.
- **Named payment availability:** the profile cannot prove which provider is configured at booking time. The copy is now provider-neutral.

## Deliberately not changed

- No backend route, query, schema, auth mapping, API shape or database data.
- No payment configuration or booking logic.
- No navigation destinations or tab semantics.
- No document picker MIME types, R2 upload path, credential state transition, delete rule or attachment access rule.
- No logout confirmation semantics.
- No Daily, WebSocket, classroom, membership or session code.
- No dependency, lockfile, generated native project, test account, external request, database write, commit, push, deployment or purchase.
- No baseline increase; the design ratchet was lowered only after all checks passed.

## Remaining risks / next pickup point

- The slice has passed lead review. The remaining step is manual preview testing at phone and laptop widths before any production release.
- The layouts were compiled but not rendered because no browser runtime is installed. Manual checks remain necessary at 390 px and 1440 px, especially long names/emails, credential filenames, rejected reasons, wrapping status labels and the SocialSignIn block.
- Native file picking, upload progress, attachment opening, deletion and logout were preserved by inspection and typechecking, not exercised on an iPhone or cheap Android phone.
- The app still has dead profile fields (`sessionsThisMonth`, `monthlyEarnings`, and client-only `enrolledSessions`) outside these two screens. Removing them from shared types/application data is broader than this UI-only slice and was not attempted.
