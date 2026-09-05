# Discover omitted teachers after the first API page

- Date: 2026-09-04
- Agent: Codex
- Branch: codex/discover-complete-directory
- Base commit: 999fe3b
- Status: in progress

## Requested

Urgently restore Discover so the owner can find their approved teacher and newly created class on production.

## Changed

Discover now loads all API pages before applying its existing local matching, filters and ranking.
Email is included among searchable fields already supplied by the API. Failed directory loading
has an explicit error and Retry action instead of claiming no teachers exist. Added a pure page
loader and regression tests with 197 teachers and the target on page two.

## Decisions and assumptions

Keep the existing local search semantics for this bounded hotfix; do not raise the API limit or
change approval, grants, bookings or payments. A larger directory should eventually use server-side
search with consistent matching semantics and pagination. The present production directory takes
two requests. Claude's newer release-candidate commits remain separate from this urgent fix.

## Verification

Read-only production API reproduced: limit=200 returns 100 of 197; teacher user 719 is absent.
Page two returns 97 and includes Prakash Teacher (profile 208/user 719). Server-side search for
prakash independently returns the teacher. App unit suite 215/215; app TypeScript passes;
design ratchet unchanged at 205 hex/418 sizes. Production build and rendered verification pending.

## Problems and surprises

Discover requested 200 but the API caps requests at 100. The total header was truthful while
the searchable rows were incomplete. Grant activation was verified previously without walking
the student Discover journey; that omission let the owner hit this defect. Initial read-only
network/Git operations were sandbox-blocked and succeeded with approved access.

## Fabrications found

“No teachers found” described a search over only the first page as if it covered the directory.

## Deliberately not changed

No API/schema/account/payment/Daily changes. No fuzzy typo-matching algorithm added.

## Remaining risks / next pickup point

Finish build, verify rendered search and profile navigation, deploy production and record version.
