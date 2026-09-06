# Rename the product to Fadko, "Tuition from Home"

- Date: 2026-09-06
- Agent: claude
- Branch: claude/livekit-trial
- Base commit: e2e214b (`Point LOCAL_SETUP at LiveKit too`)
- Status: complete

## Requested

> *"I have come up with the Name — 'Fadko' — 'Tuition from Home'. Can you make the changes
> wherever is needed?"*

## Changed

**The method matters more than the list.** Every path, package name, room name, storage key,
seeded email and local database name in this repository spells it **lowercase** (`sikshya`);
every piece of prose and every user-visible string spells it **capital-S** (`Sikshya`). So the
rename was a replacement of the capital-S word only — 195 occurrences across 80 files — which
protected all of the plumbing automatically rather than by a hand-maintained exclusion list.

- `artifacts/sikshya/app.json` — `name`, `slug`, `scheme`, web `name` and `shortName`, the four
  camera/microphone/photo permission strings, and **`bundleIdentifier`/`package`:
  `com.sikshya.app` → `com.fadko.app`** on both platforms.
- Every user-visible string in `artifacts/api-server/src` — account notices and their sign-off
  (`— Fadko`), verification and password-reset emails, the follower email, the operator refusal
  messages, the session case narratives, and the support identity (`Fadko Support`) in
  `ticketStore.ts` and `routes/admin.ts`.
- Every user-visible string in `artifacts/sikshya/app` and `components` — the welcome screen,
  registration, onboarding, forgot-password, notification settings, and the subscription screen's
  `Fadko Pro` tier label.
- The tagline **"Tuition from Home"** on the welcome screen, directly under the wordmark. It
  replaced *"Live teaching, built around a shared whiteboard"*, which said what the hero image
  immediately below it already says at more length. The whiteboard is still the selling point and
  the hero is still where it is sold.
- `.env.example` — `EMAIL_FROM=Fadko <accounts@example.com>`.
- `.replit-artifact/artifact.toml` — `title = "Fadko — Tuition from Home"`.
- Owner-facing docs: `CLAUDE.md`, `HANDOVER.md`, `ISSUES.md`, `DEPLOY.md`, `LOCAL_SETUP.md`,
  `VIDEO.md`, `DESIGN.md`, `MONTHLY.md`, `REFUNDS.md`, `SESSION-PROOF.md`, `PREVIEW.md`,
  `replit.md`.
- New `.agents/memory/the-name-is-fadko.md`, indexed in `MEMORY.md`.

## Decisions and assumptions

**The bundle identifier was changed, and that is the one with a consequence.**
`com.sikshya.app` → `com.fadko.app`. It was free to change now and permanent after the first
store publish, so it had to move with the name rather than after it. The cost: Android treats a
different package as a different app, so a debug build installed before today will not be
replaced — it installs *alongside*. The old app has to be uninstalled from any test phone. This
is the same trap the `com.guru.app` → `com.sikshya.app` rename set; it is recorded in
`CLAUDE.md` and it was hit again here.

**Five things deliberately keep the old word**, each because renaming would break something real
rather than improve anything a user sees. Full reasoning in the memory note; the load-bearing one
is the provider room name `sikshya<id>`, which `lib/sessionProof/providerEvents.ts` parses to tie
attendance evidence back to a class — renaming it would orphan every meeting already recorded,
and it also lives in `lib/daily.ts`, which is frozen during the LiveKit trial.

**`.agents/worklog/` and `.agents/memory/` were left alone.** They record what was true when
written. Rewriting them would make the history lie about itself.

**The Devanagari line was left alone and raised instead.** The welcome screen carries
`शिक्षा • ज्ञान • समृद्धि`. It is a values line rather than the name — but its first word *is*
the old name, and inventing a Nepali wordmark for somebody else's brand is not a call to make
unasked. Flagged to the owner; needs their spelling of "फड्को" if they want one.

## Verification

| Command | Result |
|---|---|
| `pnpm run typecheck` (four packages) | clean |
| `sikshya` `pnpm run test` | **244 passed, 0 failed** |
| `api-server` `node --test "src/lib/**/*.test.ts"` | **434 passed, 0 failed** |
| `api-server` `scripts/video-tests` | **42 passed, 0 failed** |
| `sikshya` `scripts/livekit-tests` | **82 passed, 0 failed** |
| `sikshya` `call-leave` / `call-chat` / `board` | **9 / 17 / 44** |
| `sikshya` `lint:design` | no new leaks |
| `sikshya` `pnpm run build` | **"Verified: the built app calls itself Fadko"** |

That last line is the one worth noting: `scripts/build.js` reads the name out of `app.json`
rather than hardcoding it — written that way deliberately at the Guru→Sikshya rename "so that
this check keeps working through the next rename instead of quietly becoming a check that the
app is still called Sikshya". It did exactly that, with no edit.

Also confirmed by direct check, not by assumption: the 38 real Nepali school names containing
"Sikshya" in `nepalEducationFacilities.json` are untouched, no `Fadko` was injected into that
file, and nothing under `.agents/` changed.

## Problems and surprises

**The rename silently broke the LiveKit trial, and only one suite caught it.** The client
platform header was two independent string literals — `"X-Sikshya-Platform"` in the app's
`utils/api.ts`, and `req.get("x-sikshya-platform")` in `routes/sessions.ts`. The app's copy was
capital-S so the rename moved it; the server's was lowercase so it did not. The app then sent
`X-Fadko-Platform` while the server read `x-sikshya-platform`.

Nothing threw. Every client would simply have fallen through to the "says nothing → give it
Daily" branch, forever, and the LiveKit trial would never have switched on for anybody — which
looks exactly like LiveKit not working. Typecheck passed. All 678 unit tests passed, because
they exercise `readClientPlatform` directly rather than the wire.

`scripts/video-tests` caught it, because it is the only check that sends a real HTTP request with
that header to a real server. Fixed by making the name a single exported constant,
`PLATFORM_HEADER` in `lib/video/types.ts`, used by the route and the harness — so the two ends
can no longer disagree.

## Fabrications found

None found. The rename changed no number, status or claim — only the word the product calls
itself by. The one place a name is derived rather than written, `scripts/build.js`, reads it from
`app.json` and reported the new value correctly.

## Deliberately not changed

- `HomeTuition` — repository and Cloudflare Worker name.
- `artifacts/sikshya/` and `@workspace/sikshya` — folder and package.
- `sikshya<id>` — provider room name; attendance evidence correlates on it.
- `@sikshya_token` — login storage key; changing it signs everyone out for nothing.
- `student@sikshya.np` / `teacher1@sikshya.np` — seeded demo logins, which the owner is about to
  use tonight from the LiveKit checklist. Changing them without a re-seed would hand them a login
  that does not work at exactly the wrong moment.
- The local `DATABASE_URL` database name.
- `nepalEducationFacilities.json`, `.agents/worklog/`, `.agents/memory/`.

## Remaining risks / next pickup point

1. **Uninstall the old app from any test phone** before installing a Fadko build, or two apps sit
   side by side and it is a coin toss which one gets tapped.
2. **The demo logins still read `@sikshya.np`.** Harmless and internal, but it will look odd next
   to a product called Fadko. Worth changing together with a `pnpm run seed`, at a moment when
   nobody is midway through a checklist that cites them.
3. **The Devanagari wordmark is unresolved** — see Decisions.
4. **Nothing user-facing has been seen rendered under the new name** beyond the build's own
   identity check. The welcome screen's tagline change in particular is unrendered.
