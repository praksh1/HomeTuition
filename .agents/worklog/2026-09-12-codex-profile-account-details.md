# Profile account details and refund destination

Status: implementation complete; awaiting CI and preview review
Branch: `codex/profile-account-details`

## Goal

Let teachers and students review and update their private contact/location details from Profile, while preserving verified login identity and clearly explaining where an approved refund goes.

## Work performed

- Added one shared Account details card to both teacher and student Profile screens.
- The card loads the authenticated user's private onboarding record, shows login email, phone, Nepal location and school/affiliation, and provides one Edit/Add details action.
- Reused the existing onboarding record and canonical Nepal education dataset; no duplicate profile table or column was added.
- Made the onboarding screen a safe edit surface for already-onboarded users, with role-correct return navigation.
- Added required phone, controlled Province/District pickers, a manual Municipality fallback, school search/manual fallback, Independent teacher and student Not applicable choices.
- Kept login email read-only and explained that Support is required to start a protected change. No unverified email can become authoritative through this screen.
- Added server-side Province/District relationship validation; the UI is not trusted as the authority.
- Added refund-request copy stating that approved refunds return to the original payment method and changed account/phone details must be raised with Support before processing.
- Existing users are not blocked from login. Incomplete legacy details show Needs your attention and can be completed voluntarily.

## Verification

- Repository-wide typecheck: pass across libraries, API, app, scripts and mockup.
- API unit suite: pass, including three new Nepal hierarchy tests.
- App unit suite: 397 passed, 0 failed, including four new Profile/refund contract tests.
- Design lint: no new leaks; baseline remains 94 hex / 282 sizes.
- `git diff --check`: clean.

## Deliberate boundaries and remaining work

- Phone is required and format-checked but not SMS-verified yet. No paid SMS provider was activated.
- Login-email editing is not exposed until a proper re-verification and collision-safe change flow is designed.
- Manually entered Municipality and institution values are stored distinctly by the user's choice, but an operator review queue for them is still future work.
- The existing dataset remains the source for Province/District/local-level and institution suggestions. Municipality data quality still needs periodic maintenance.
- No real refund, payment destination or payout was changed. This is truthful guidance on the existing request screen only.
