# Daily staging activation

- Date: 2026-09-11 (12 Sep UTC)
- Agent: Codex
- Branch: codex/batch-simulated-checkout
- Base commit: 586a803; deployed application6da5489
- Status: failed real-call experiment; preview rolled back to echo

## Requested

Owner confirmed simulated checkout manual testing passed and explicitly approved attaching the
stored Daily credential to staging after the action-time shared-allowance warning.

## Changed

Only hometuition-api-staging service cc10a94f-b24b-47bc-ae5c-ec2a9307cfa0:
- DAILY_API_KEY references existing shared variable; value never revealed/copied.
- VIDEO_PROVIDER echo -> daily.
- VIDEO_ROOM_NAMESPACE=fadko-preview.
Reviewed all three changes together in Railway and deployed as one configuration release.
Production service untouched. Do not attach shared DATABASE_URL or SESSION_SECRET.

## Decisions and assumptions

Already deployed code isolates preview rooms as fadko-preview-sikshya<ID>, private and token-bound,
with knocking disabled. Native and web both use the same membership authority. No new recording,
streaming or transcription enablement. Owner screenshots showed42/10000 included minutes and
estimated$0.00; this is not a spending cap or indefinite free-use promise.

## Verification

Three-setting review confirmed target staging service only, correct namespace, daily selection,
and shared credential reference. Railway building at checkpoint. Existing code previously passed
Daily isolation tests and full safety CI34669036220; these were mock-provider tests, not real media.

## Problems and surprises

Old Railway agent tab was removed between turns. Recovered by listing tabs and opening the exact
known staging URL; signed-in session remained available. Browser is signed in as operator, not a
teacher/student; cannot honestly claim participant room/token/media verification from that account.

## Fabrications found

None newly found. Do not describe echo tests as real Daily calls or simulated allocations as payouts.

## Deliberately not changed

Live site, production credentials/config, payment providers, prices, real money, recording,
Daily billing/subscription, spending limits, student grant expiry and classroom access rules.

## Remaining risks / next pickup point

Verify deployment active and startup health. Owner then tests teacher/student on two devices using
the same simulated-purchased class at its scheduled time. Student grant still ends17Sep2026,
teacher grant10Jan2027. Renew student grant through supported operator flow before expiry.
Real network/phone behavior, remaining account allowance at call time and media delivery unverified.

## Deployment result

Railway deployment88a6d07b-2a78-42cc-a124-afd972ebd84b ACTIVE / Deployment successful.
Application remains6da5489; configuration-only redeploy, no main push or web rebuild needed.
Only staging appears in the three-change review. No key value was printed or copied.
Next action belongs to owner: sign into preview teacher/student on two devices, use the same
simulated-booked class during its join window, confirm real audio/video and shared drawing.
No real Daily room/token/media request was made by Codex in this turn; API-key validity and
provider-side defaults remain unproven until that first authorized classroom request.

## Manual result and rollback

Owner tested the configured preview and reported the exact visible result: **“Could not load
video room.”** This is a failed real-call result. Do not describe the activation as working merely
because Railway health stayed online or the configuration deployment succeeded. Root cause was
not diagnosed in this pass; owner explicitly chose to defer Daily and continue other work.

Changed only staging `VIDEO_PROVIDER` from `daily` back to `echo`. Railway deployment
`026ae593-d3e3-4592-900b-abc92cac759c` is ACTIVE / Deployment successful. Production was never
changed. The shared Daily reference and isolated namespace remain attached but inactive; no room
request is made while echo is selected. A future retry must begin from the visible room-load error
and provider logs, not from the assumption that credentials or room creation were already proven.
