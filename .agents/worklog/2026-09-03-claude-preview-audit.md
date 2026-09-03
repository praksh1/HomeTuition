# Preview infrastructure — independent audit and corrections

- Date: 2026-09-03
- Agent: claude
- Branch: `claude/preview-infrastructure` (PR #11)
- Base commit: `4a12775`
- Status: corrections complete; PR #11 still unmerged and no preview has ever run

## Requested

An independent audit found PR #11 green but neither safe nor usable. Six findings, all valid.

## Findings and corrections

### 1. The workflow cannot be triggered until PR #11 merges — VALID, documented

GitHub only offers a `workflow_dispatch` workflow once the file is on the **default branch**. While
`preview.yml` lives only on this branch, "Preview a branch" does not appear in Actions and a
dispatch returns 404 — which I hit and reported earlier, but PREVIEW.md still read as though the
workflow were available now.

PREVIEW.md opens with the prerequisite. Not merged here; that is a review decision.

### 2. "Preview ready" printed even when every retry failed — VALID, fixed

The post-deploy loop `break`-ed on success and simply fell through on exhaustion, into a summary
that announced the preview. A reviewer would have been handed a link to a dead page and told it was
ready. Two further paths were wrong in the same way: an empty URL was a `::warning::` that still
reached the summary.

Both now `exit 1`. The summary is written only after the page has actually responded.

A **pre-build** `GET {api}/api/healthz` was added, five attempts, and it fails the job before any
build minute or upload if the staging API is not answering. Path confirmed against the source:
`routes/health.ts` serves `/healthz` and `index.ts` mounts the router at `/api`.

### 3. The workflow cannot prove the Railway branch, database, or variables — VALID, boundary stated

PREVIEW.md now has a section separating what each run proves automatically from what it cannot, and
it does not claim the second set.

It cannot prove which commit the staging service runs, that the database is separate, or that
outbound credentials are withheld. **No repository-only assertion exists for any of the three.**
Each needs either a Railway credential in CI — deliberately absent, since a token that can deploy
the API can deploy production — or an API change. `/api/healthz` returns `{"status":"ok"}` and
nothing else; adding a build-SHA field would make the commit checkable, and is noted as a separate
change with its own review rather than smuggled into preview setup.

A mandatory pre-run checklist for Codex covers all three by hand: active deployment branch **and
commit SHA**, the full variable list read rather than only the ones set, the Neon project being
separate, and workspace spend against the saved limits.

### 4. `APPLE_CLIENT_IDS` and `EXPO_PUBLIC_DOMAIN` missing — VALID, added after re-audit

Both verified in source rather than assumed:

- `APPLE_CLIENT_IDS` — `socialIdentity.ts` reports `apple.enabled: false` without it, and
  `verifySocialCredential("apple")` returns null before any token is checked.
- `EXPO_PUBLIC_DOMAIN` — `appUrl()` in `notify.ts` reads `APP_URL ?? EXPO_PUBLIC_DOMAIN`; with both
  absent it returns an empty string, so no outbound link points at the live site. Withholding
  `APP_URL` alone was insufficient.

**The re-audit caught a worse problem than the two names.** My first pass grepped the working tree
while `origin/claude/excalidraw-whiteboard-sync-gjoqaz` was **stale at `25ebc94`**, and returned a
short list missing `BREVO_API_KEY`, `EMAIL_FROM`, every `R2_*`, every `GOOGLE_*`/`FACEBOOK_*`,
`RESEND_API_KEY`, `APP_URL` and `PUBLIC_APP_URL`. Had I documented that, staging would have been
built with the live Brevo key present and could have emailed real people. Refetching gave the true
surface at `bc0aa17`. The withheld table is now derived from the commit staging will actually run.

Non-outbound names are listed separately as safe to set: `LOG_LEVEL`, `WS_HEARTBEAT_MS`,
`MODERATION_TERMS`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`.

### 5. `pnpm run seed` recommended — VALID, removed

Read before ruling out. `scripts/src/seed.ts` opens with six unconditional `DELETE FROM` statements
— `reviews`, `session_enrollments`, `sessions`, `teacher_profiles`, `student_profiles`, `users` —
with **no guard on which database it targets**, then writes ~200 teachers, ~500 students, thousands
of randomised sessions and up to 50 reviews per approved teacher.

Beyond the risk, it is the wrong fixture twice over: thousands of fabricated rows are not a
reviewable state, and it **creates no operator account**, so it cannot exercise the operator screens
PR #10 is largely about.

PREVIEW.md now forbids it and asks for a few hand-registered accounts instead. No replacement seed
was invented — that is its own task with its own review.

### 6. Record the audit — this entry

## Changed

| File | Change |
|---|---|
| `.github/workflows/preview.yml` | pre-build health probe; retry exhaustion and empty URL now fail red |
| `PREVIEW.md` | merge prerequisite; prove/cannot-prove boundary; Codex pre-run checklist; re-audited withheld table; seed prohibition |
| `.agents/worklog/2026-09-03-claude-preview-audit.md` | this entry |

## Verification

All run in this container against the extracted step bodies, not by reading.

| Check | Result |
|---|---|
| Workflow YAML parses | valid, 12 steps |
| Staging health failure (unreachable API) | **exit 1**, error surfaced, nothing built |
| Staging health success (local stub on :9099) | exit 0, `{"status":"ok"}` |
| Post-deploy retries exhausted | **exit 1**; "Preview ready" printed **0 times**; summary file never written |
| Deploy log with no URL | **exit 1** |
| URL guard × 8 | 7 refused, 1 allowed — see below |
| `git diff --check` | clean |

Guard cases: nothing configured · production API · production Worker · the existing frontend-only
branch Worker · any `-production.` service · plain `http` · production Worker in uppercase — all
refused. A genuine staging URL — allowed.

## Problems and surprises

- **The stale remote ref (finding 4)** is the serious one. A `git grep` against a remote-tracking
  ref that has silently fallen behind produces a plausible, wrong answer with no error. The
  container has rolled back repeatedly this session; refs are not trustworthy without a fresh
  fetch, and anything derived from them must be re-derived after one.
- `git grep <rev> -- <pathspec>` returned empty for a file that certainly contained the term.
  Reading files via `git show <rev>:<path>` was reliable where `git grep` was not.

## Deliberately not changed

- **Not merged, not deployed.** No cloud account, secret, or production behaviour touched.
- **No replacement seed fixture.**
- **No build-SHA field on `/api/healthz`** — an API change, out of scope here.
- Slices 5–7 not resumed.

## Remaining risks / next pickup point

- Three properties remain human-verified only: staging branch/commit, database separation, withheld
  variables. Codex's pre-run checklist is the control; there is no automated substitute without a
  Railway credential in CI.
- PR #11 must merge before any preview can be run at all.
- The workflow has still never executed. YAML validity, guard logic and both failure paths are
  proven; the deploy path is not.
