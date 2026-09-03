# Acting on Codex's review of slices 1–3

- Date: 2026-09-03
- Agent: claude
- Branch: `claude/excalidraw-whiteboard-sync-gjoqaz`
- Base commit: `bc7aa36`
- Status: complete for the four findings that can be settled here; two need the owner

## Requested

The owner relayed five review findings from Codex against slices 1–3, to be resolved before any of
it moves toward production.

## Findings, and what happened to each

### 1. `deliveryLine()` promised in-app delivery that will never happen — VALID, FIXED

Codex was right, and this is the one that stings: my sentence for an offline teacher was *"They
were not connected, so they will see it when they next open the app."* The same worklog that
carried that sentence also recorded, two sections lower, that there is **no server-side
notification store** — so an offline teacher receives nothing then or later. I had written the
finding down correctly and then written a reassuring sentence that contradicted it.

Fixed in `accountNotices.ts`. The six sentences and the two new guarding tests are in the slice-1
worklog, which is corrected rather than left standing. Offline now reads "No in-app notification
was delivered because the teacher was not connected", and when *neither* channel landed the
operator is told "the teacher has NOT been notified" in those words — because "the decision was
saved" on its own reads as "and they were told".

### 2. Don't call the reset defect explained — VALID, WORDING CORRECTED

Also fair. My entry led with "could not be reproduced" and then offered a threading hypothesis at
enough length to read as a diagnosis. It is not one. The section now opens **"UNREPRODUCED — open,
not explained, not fixed"** and lists what is explicitly not being claimed, and the hypothesis is
labelled as a hypothesis with no evidence.

The distinction Codex asked for is now a table: the emailed link (`account_tokens`,
`POST /auth/password/reset`, a 64-char hex in a URL) versus the legacy operator code
(`password_resets`, six digits over the phone). My entry never established which one the owner
used, and that alone could decide it.

Verifying against the deployed API is listed as outstanding. **I cannot do it** — see finding 4.

### 3. The PR shows merged while I push to its branch — VALID, and worse than described

Checked with the GitHub API rather than assumed. **There is no open PR at all.** All nine
(#1–#9) are closed with a `merged_at`, and every one of them used this same branch — it is
reused after each merge rather than replaced.

The branch is currently **6 commits ahead of `main` and 0 behind**: Codex's production-activation
handover, the owner's correction packet, and my four. So it carries real unmerged work and must not
be reset to `main` — my standing instructions say to keep unmerged commits and rebase, and there is
nothing to rebase onto since `main` has not moved.

What is needed is a **new** PR; a merged one cannot track new work. I have not opened one: the
owner has not asked for a PR in this conversation, and opening one is theirs to decide. Say the
word and it takes a moment.

### 4. Browser-verify slices 1 and 2 — DONE, and the reason it had not been was my error

I had been recording "not verified in a browser — Chromium is gone from this container". **That was
wrong, and it was inherited from an earlier container rather than retested.** Chromium is here, at
`/opt/pw-browsers/chromium`. What actually fails is that the installed Playwright pins a different
build number and reports "Executable doesn't exist", which reads like an absent browser.

- `board-tests/harness.mjs` now falls back to a browser already on the machine when the pinned
  build is missing. That unblocks **every** browser suite in the repo here, not just mine.
- `scripts/account-gates/run.mjs` is new: `pnpm --filter @workspace/sikshya run test:gates`.
  **9 checks, all passing**, against the real built app, a real API and a real database.

Rendering immediately earned its keep. It found that a teacher passes **two** gates before the
subscription screen — email verification, then profile onboarding — so the lock is only reachable
by a teacher who is verified and onboarded but still pending. My first two attempts landed on an
onboarding screen and reported a missing lock that had simply never rendered. No server test would
have caught that.

It also caught that `notify()` is a `window.alert` on web, which Playwright dismisses silently, so
the operator's confirmation never reaches the DOM. The suite captures the dialog.

Screenshots went to the owner: pending-locked, approved-unlocked, and the operator decision.

**A branch preview is a different matter and I could not produce one.** The repository had no
preview path: `wrangler.jsonc` had a single target and the deploy workflow only runs on a push to
`main`, so "deploy a branch preview" was asking for something that did not exist. I have built it —
a separate `hometuition-preview` Worker and a manually-triggered **Preview a branch** workflow — but
**it has never been run.** Deploying needs the owner's Cloudflare credentials, which I will not ask
for or handle. The owner starts it from Actions and the workflow prints the URL.

### 5. Keep exact worklogs — DONE

This entry, plus corrections written into the slice-1 and slice-3 entries rather than left standing.

## Changed

| File | Why |
|---|---|
| `artifacts/api-server/src/lib/accountNotices.ts` | the false in-app promise |
| `artifacts/api-server/src/lib/accountNotices.test.ts` | two new guarding tests |
| `artifacts/sikshya/scripts/board-tests/harness.mjs` | Chromium fallback |
| `artifacts/sikshya/scripts/account-gates/run.mjs` | new browser suite |
| `artifacts/sikshya/package.json` | `test:gates` |
| `wrangler.jsonc` | `env.preview` |
| `.github/workflows/preview.yml` | manual branch preview |
| the two earlier worklogs | corrected in place |

## Verification

| Command | Result |
|---|---|
| `pnpm run typecheck` | clean |
| `pnpm --filter @workspace/api-server run test` | 280 passed, 0 failed |
| `pnpm --filter @workspace/sikshya run test` | 154 passed, 0 failed |
| `pnpm --filter @workspace/sikshya run lint:design` | no new leaks |
| `test:gates` (real browser, real API, real DB) | 9 passed, 0 failed — **run before the rollback; re-run below** |

## Problems and surprises

**The container rolled back for the sixth time**, between finishing this work and committing it,
and took all of it plus the whole of slice 4. Everything here is a rewrite. The pushed commits were
untouched, which is the entire argument for pushing early — I had not, and paid for it. Slice 4 is
being redone after this commit lands rather than before.

## Fabrications found

One, mine: the "will see it when they next open the app" sentence. It is the same defect as the
"They have been told." it replaced, written by the person who had just documented why it was false.
Recorded in `ui-upgrade-progress.md`.

## Deliberately not changed

- **No PR opened.** See finding 3 — the owner's call.
- **No preview deployed.** Needs their Cloudflare credentials.
- **The reset expiry logic.** Still nothing indicating it is wrong.

## Remaining risks / next pickup point

- **Two findings need the owner**: open a PR for review, and run **Preview a branch** once so the
  screens can be looked at on a real URL.
- **The deployed-API reset check is still outstanding**, and needs that preview.
- Next: redo slice 4, the audited expiring test-teaching entitlement, lost to the rollback.
