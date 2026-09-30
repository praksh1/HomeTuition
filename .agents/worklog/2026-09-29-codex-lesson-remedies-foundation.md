# Lesson remedies policy and implementation foundation

- Date: 2026-09-29
- Agent: Codex root, remedy dependency audit and typography audit
- Branch: `codex/lesson-remedies-foundation`
- Base commit: `ce26b0ebab4ecf60781976296d1b623689e3a818`
- Status: complete for the dormant foundation; booking workflow not active or deployed

## Requested

Discuss and begin integrating fair make-up rules with original lesson/payment linkage, advance absence requests, limited student courtesy allowance and separate teacher-failure remedies. Preserve the two-day dispute window and premium phone/laptop experience. Improve typography without adding paid font assets.

## Changed

- `artifacts/api-server/src/lib/lessonRemedies.ts` and its core/adversarial tests: versioned policy snapshots, allowance calculations, request/acceptance prerequisites, actors and lifecycle, quota reservation accounting, original-versus-replacement settlement target and review clock. These pure functions are foundations, not routes or database transactions.
- `lib/db/src/schema/lessonRemedies.ts` and index export: three additive dormant tables for original cases, versioned offers and audit events. Restrictive financial/evidence foreign keys; original booking/position uniqueness; one accepted offer ever per case using the retained acceptance timestamp. Group replacements can share a room but each student must independently accept.
- `makeupPolicy.ts`: refund review is preserved for both reasons, without promising refunds for student no-shows.
- `batchTestSettlement.ts` and tests: when supplied a remedy, only the confirmed replacement delivery target can advance accounting. The live settlement reader does not yet supply this context. Missing/wrong target and unresolved cases hold; an original completed label cannot release a supplied replacement allocation.
- `routes/programCommerce.ts`: refuses ledger-only `replacement_scheduled`, matching the existing batch-test route guard.
- ClassSetup, teaching-classes list and teachingClasses route wording: Monthly tuition program, with explicit 30-day periods. Internal IDs and original purchased schedules unchanged.
- `constants/fontFamilies.ts`, typography.ts, FloatingTabBar and AppShellHeader: real bundled Inter weights, tabular unread badges, local Nepali fallbacks without remote font requests. `utils/typography.test.ts` and `scripts/typography-ui/` exercise the shared fonts/navigation.
- Updated the existing lesson-remedies policy document, backlog, project decision note and HANDOVER with the approved allowance and exact activation gates. Other queued work remains tracked.

## Decisions and assumptions

The owner explicitly approved this launch extension during the turn: two teacher-approved courtesy replacements per paid 30-day tuition period; short courses use one per ten purchased lessons rounded up, capped at three; one-lesson courses have no courtesy allowance; no rollover; teacher non-delivery is quota-exempt; missed replacements go to human review, without automatic refunds or forfeiture. There is no additional weekly cap. A late join can only request replacements for purchased positions, but retains the approved two-per-period tuition limit. Teacher failure of an accepted courtesy replacement restores that usage; the original case still goes to review rather than another automated replacement.

Previously approved timing remains: offer response up to seven days, closing sooner if the offered lesson begins; replacement must finish within thirty days of the original scheduled end; preserve a timely original claim and give confirmed replacement delivery a fresh 48-hour review from the later of scheduled/recorded end. A request records intent, not automatic attendance, cancellation or approval. Refund review is not a guaranteed refund.

This checkout's active commerce is simulated batch checkout. The new schema explicitly references that original booking model; it is not a generic real-money provider integration. Production source remains in premium-shell-production. The new branch isolates this foundation from the cost-dashboard release and does not change deployment configuration.

## Verification

- Focused make-up/settlement/adversarial checks: 36/36 passed.
- API typecheck and full API unit suite: 840/840 passed.
- App typecheck and full app unit suite: 600/600 passed.
- Class-creation Chromium fixture: 129 checks passed at 360/390/1440px, including discard/publish recovery/conflict editing. Class-list fixture: 10 checks at 390/1440px.
- Typography Chromium fixture: 48 checks at 320/390/768/1440px. Proper bundled faces, tabular digits, font fallback strings, visible/tappable navigation, no horizontal overflow or runtime errors. Root inspected the 390px typography fixture and 390px class-form screenshot; audit agent also inspected desktop.
- Design ratchet passed unchanged: 56 hex literals, 211 raw sizes. No baseline expansion.
- API bundle compiled successfully. Full `pnpm.cmd run typecheck` passed, including library builds, API, app, scripts and mockup sandbox. `git diff --check` passed.
- Schema audit compiled DB TypeScript and inspected three table configurations: 11 restrictive foreign keys, 10 checks, 11 indexes. This is metadata inspection, not proof the constraints/races work against PostgreSQL.

## Problems and surprises

- The first focused run rejected a TypeScript parameter property in Node strip-only mode; converted it to a declared class field. The first API typecheck rejected a deliberately malformed test cast; changed the cast through unknown and reran.
- Independent review reproduced malformed boolean values bypassing ownership/quota/refund prerequisites. Strict runtime checks now reject them, as well as impossible future recorded end times and inherited event names.
- `@workspace/db` has no typecheck script; the attempted filtered script was unavailable. The schema audit used direct TypeScript compilation; the root workspace typecheck includes the library build.
- Existing app tests emit module-type warnings. No package-wide module conversion was attempted.

## Fabrications found

The old product documents could imply that a pure offer validator represented a working make-up flow. Status is now explicit throughout: no request/acceptance routes, persistent runtime service, migrated tables or activated booking UI. Unit tests validate the policy but cannot prove database races, real delivery or transfers.

## Deliberately not changed

No database migration, deployed feature flag, Preview/Production release, provider billing, real payment/refund/payout, automated ban, original booking rewrite or legacy Monthly contract change. No app processes stopped and no credentials/private identity evidence read. Existing untracked `.ux-audit/`, `artifacts/sikshya/.ux-audit/` and `artifacts/sikshya/operator-web-build/` preserved. Inter assets and responsive type scale retained; no remote font download or new dependency.

## Remaining risks / next pickup point

The next phase is one allocation-aware transactional service plus participant/teacher/operator screens. Before activation, settlement must actually query case/accepted replacement evidence, refund/drop/cancellation actions must share the original allocation lock, replacement rooms must be excluded from public booking/discovery, and schedules/Class Home/receipts/notifications/closure must project open remedies correctly. Preserve materials/evidence after course or period closure. Store purchase policy before advertising its entitlement.

General Support currently allows seven-day lesson selection and accepts late reports; do not globally apply a 48-hour refusal to safety, refund-status or legacy-contract reports. Separate the standard new-class financial review deadline from continued Support access. A completed label plus any recorded teacher presence is not enough for an authoritative replacement-delivery decision.

Required actual-DB tests: duplicate acceptance and retries after lifecycle advances; acceptance versus refund; simultaneous quota reservations; final group capacity; teacher/student overlaps; expiry boundaries; replacement after renewal; failure/missing evidence; held-versus-paid-out reconciliation. A generic ledger event still must not create or imply a classroom booking. No new owner policy decision is pending, but the feature is not ready for user testing yet.
