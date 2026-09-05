# Discover omitted teachers after the first API page

- Date: 2026-09-04
- Agent: Codex
- Branch: codex/discover-complete-directory
- Base commit: 999fe3b
- Status: complete

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
design ratchet unchanged at 205 hex/418 sizes. Production build passed and verified the production
API address and Sikshya identity. Committed as 07a1bf5, pushed to main, then manually deployed the
tested static build with Wrangler 4.124.0 to avoid waiting for the full CI deployment pipeline.
Cloudflare version f4a15edf-30d1-4d71-a7f7-dc72ea3a1e2a. The normal main-push CI is also triggered.
Rendered production verification as the selected student passed: name search and email search
each find Prakash Teacher, clicking the card opens /teacher/208, and Past shows the actual trial
class. This is real production browser evidence, not an echo fixture or a mocked teacher list.

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

The owner's trial session 2715 was scheduled 2026-09-04T19:04:00Z and is now completed; create a
new future session for the next real-call test. No session was rescheduled or created by this fix.
The unchanged API orders equal ratings without a unique tie-breaker; eventual server-side search
should address stable ordering and concurrent directory changes. Current observed production
directory loads both pages and finds the selected teacher. Claude must incorporate main 07a1bf5
before preparing its next release, so an older candidate does not undo this fix.
