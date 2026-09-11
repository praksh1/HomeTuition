# Optional late joining, lesson pricing and publication review

- Date: 2026-09-11
- Agent: Codex
- Branch: codex/program-batch-foundation
- Base commit: 779d809
- Status: in progress

## Requested

Owner agreed optional late joining for ongoing tuition: buy remaining unstarted lessons upfront,
keep the shared end date. Preceding discussion approved prominent lesson counts, average lesson
price, a one-lesson publication warning and locking purchased promises before checkout goes live.

## Changed

Additive `teaching_class_joining` table; draft policy on simplified class API, immutable snapshot
policy/cutoff, public server-time joining estimate, teacher opt-in and student explanatory copy.
Exact count/average price and explicit one-lesson confirmation. New unit/route/parity/browser tests.

## Decisions and assumptions

Off by default, regular tuition only, each new period requires a fresh choice. Estimate rounds the
proportion once to whole NPR, half up using integer arithmetic. No schedule-derived claim of actual
lesson completion. Old publications without policy remain closed at original cutoff.

## Verification

- Root typecheck passed all four packages outside restricted filesystem sandbox.
- API unit: 519 passed; app unit: 373 passed; design ratchet unchanged 94 hex / 282 font sizes.
- Rendered teacher setup: 70 passed at 360/390/1440 incl. one-lesson warning and explicit policy save.
- Rendered Discover/student detail: 168 passed incl. 11-lesson estimate and original-price distinction.
- Screenshot review: small-phone publish confirmation fits with count, price and both controls.
- Real API/DB/schema parity awaits the isolated CI PostgreSQL gate; no local psql executable found.

## Problems and surprises

Initial broad documentation output truncated; relevant authority/memory files re-read separately.
Some guessed filenames/globs did not exist on Windows; located actual files using rg.
- Restricted sandbox falsely presented installed jose/LiveKit packages as missing and esbuild could
  not read the repo's parent directory. Frozen offline install changed nothing; rerunning outside
  that filesystem sandbox passed. No dependency/lockfile modification was needed.
- A multi-file patch failed an unmatched backlog heading before applying anything; corrected using
  the actual heading. No destructive operation performed.

## Fabrications found

Avoided calling a scheduled past lesson completed. Estimate never reports seats available, payment
confirmed or access granted. Missing/zero price does not display a fabricated free purchase.
Screenshot review caught the older TuitionPeriodSummary still claiming no mid-period joining
above the new quote. Corrected with an explicit published-policy prop and rendered regression.

## Deliberately not changed

No real checkout, paid Batch enrollment, seat reservation, payment/refund/payout, purchased-edit
locking, membership, Daily/LiveKit, old Monthly/Single Class, capacity cap or production deployment.
No paid service/dependency or column added to an existing table.

## Remaining risks / next pickup point

Finish gates/rendering and preview deployment. Real checkout must freeze exact version, subset and
amount, atomically enforce capacity and cutoff and block unauthorized paid-promise changes. It must
allocate the actual late payment, not mutate existing buyers. Preview quote is not a reservation.
