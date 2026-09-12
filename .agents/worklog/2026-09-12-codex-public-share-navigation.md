# Public share navigation and honest class availability

- Date: 2026-09-12
- Agent: Codex
- Branch: codex/batch-simulated-checkout
- Base commit: 5b1e157
- Status: complete; isolated preview deployed; owner verification pending

## Requested

Owner tested shared teacher and class links in Chrome Incognito. The Fadko logo reached the home
page but browser Back could not return to the shared link; a class opened from a shared teacher
page had no reliable in-page return; and some published class descriptions showed no student
sign-in or account-creation action.

## Changed

- Public Fadko logo actions now push `/welcome` instead of replacing the shared URL in both the
  teacher and class routes, preserving browser history.
- A signed-out class page keeps the branded home link and adds a thumb-sized, named return to the
  publishing teacher. The explicit return replaces the class with that exact teacher profile so
  it also works when the class itself was a direct deep link.
- The public batches API now distinguishes `open`, `closed`, and `not_scheduled` after validating
  immutable published snapshots. Only open offers are returned as bookable cards.
- Empty class details now say either that joining closed or that dates and price were not opened.
  They do not offer account/checkout actions that cannot succeed, and the older duplicate generic
  "Preview only" notice is omitted for signed-out empty offers.
- Teacher-profile cards now say `View class` or `View course` instead of calling both Programs.

## Decisions and assumptions

Publishing a description alone does not create a purchasable offer. The account doorway remains
visible on every open pilot offer and absent when enrollment is closed or no schedule exists.
Security/payment authority is unchanged; no cutoff is extended to make an old class appear
bookable.

## Verification

- App and API TypeScript checks passed after running outside the restricted Windows sandbox so
  pnpm junctioned dependencies were readable.
- Rendered Discover/public detail suite: 242 passed, 0 failed at 390px and 1440px, including the
  new teacher return, open account doorway, closed reason, unscheduled reason, touch floors and
  horizontal-overflow checks.
- API unit suite: 544 passed, 0 failed.
- Design ratchet: unchanged at 94 hex literals / 282 raw sizes.
- Full four-workspace typecheck passed.
- App unit suite: 390 passed, 0 failed. API unit suite: 544 passed, 0 failed.
- `git diff --check` passed.
- Safety workflow `34709986232` passed on commit `b2df2ac`, including disposable Postgres,
  `test:programs`, `test:batch-booking`, both test-access suites, video/proof checks, rendered class
  setup and the full workspace gates.
- Preview workflow `34710226019` passed in 5m39s after the preview source branch was advanced to
  exactly `b2df2ac`. It proved the built bundle contains no production API host, deployed only the
  preview Cloudflare Worker, and verified the served HTML and initial bundles.
- Live post-deploy checks returned `health=ok`, HTTP 200 from the preview, `open` with one bookable
  batch for program 10, and `closed` with zero bookable batches for program 11.
- The browser journey test was not run locally because it requires a local API listening on 8080.
  The focused rendered navigation contracts and the deployed Incognito journey remain the relevant
  verification for this correction.

## Problems and surprises

- Initial sandboxed typechecks reported installed packages as missing because this Windows pnpm
  tree uses junctions whose targets the restricted process could not read. The same checks passed
  with normal workspace dependency access; no dependency was changed.
- `test:programs` cannot run locally because this Windows host has no `psql` executable. The new
  open/closed/not-scheduled HTTP assertions are in that suite and must pass in disposable Linux CI.
- The supplied MP4 could not be decoded locally because `ffprobe` is unavailable. The owner's
  written reproduction and read-only staging API results were sufficient: program 11 had zero open
  batches while the other tested class descriptions had open pilot offers.

## Fabrications found

The empty-batch page always claimed the teacher had not published dates and a price. That was false
for an offer whose enrollment window had simply ended. The API now supplies the distinction.

## Deliberately not changed

No production/main change, schema, database data, enrollment cutoff, test grant, payment, refund,
Daily/LiveKit setting, membership rule, real checkout, or purchase. New-account email verification
and post-registration return routing are outside this navigation correction.

## Remaining risks / next pickup point

The owner should repeat the Incognito Teacher → Class → named teacher return and Fadko →
browser Back paths. Program 10 is the known-open test offer and should show the account doorway;
program 11 is closed and must show a truthful closed notice with no unusable checkout action.
Production remains unchanged until the owner explicitly approves it after this test.
