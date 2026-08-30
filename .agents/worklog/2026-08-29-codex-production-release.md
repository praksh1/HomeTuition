# Release approved classroom and design-system work to production

- Date: 2026-08-29
- Agent: Codex
- Branch: `claude/excalidraw-whiteboard-sync-gjoqaz`
- Base commit: `13c4d3a`
- Status: complete

## Requested

The owner confirmed that the branch-preview classroom redesign was acceptable for now and then
explicitly asked to put all work completed on the branch onto the actual website:
`https://hometuition.praksh-dhakal.workers.dev/`. The owner also asked for a complete handoff
record. This request changed the earlier production restriction: production deployment was now
authorized.

## Changed

- Built a fresh static Expo web export from commit `13c4d3a` with the public production API URL.
- Validated the Cloudflare static-assets deployment using a Wrangler dry run against the Worker
  named `hometuition`.
- Deployed the exported assets to the production `hometuition` Worker.
- Cloudflare uploaded three new or changed assets: `index.html`, the final main application
  bundle, and the PDF-to-images bundle. Existing unchanged assets were reused.
- Production moved from the older `entry-292c7e35f4071f2ecc397b02f0ec9052.js` bundle to the
  approved `entry-f511b4a1c03291262c310044476fc3a4.js` bundle.
- Added this worklog, added a production follow-up notice to the 2026-08-28 classroom worklog,
  and updated `HANDOVER.md` with the exact production release state.

This production release includes everything already committed through `13c4d3a`, notably:

- the design-system conversions already completed on the branch;
- the teacher and student edge-to-edge classroom architecture;
- accessible Excalidraw tool boundaries;
- Sikshya-owned slide-over chat and unread notification badges;
- Daily internal chat/PiP suppression already implemented before this release;
- the teacher and student app-owned call window with Hidden, Small, Medium, and Full states;
- draggable windowed video, visible Hide/Show controls, and Full/Restore behavior;
- the provider-research and cross-agent handoff documentation.

## Decisions and assumptions

- The exact production target was resolved from `wrangler.jsonc`: Worker name `hometuition`,
  static assets from `artifacts/sikshya/web-build`, SPA fallback enabled.
- The branch was clean and its `HEAD` exactly matched the tracked GitHub branch before building.
- The production API remains
  `https://workspaceapi-server-production-5a63.up.railway.app`; no API, database, Worker binding,
  secret, or environment-variable change was made.
- No Git branch merge was needed. The owner's actual website is a Worker asset deployment and
  was published directly from the already-pushed, approved branch commit.
- No Daily replacement was attempted. Daily remains the active provider.

## Verification

Before deployment:

- `pnpm run typecheck` passed. Its artifact filter still reports no matching projects, so the
  focused app typecheck is the direct application proof.
- `pnpm --filter @workspace/sikshya run typecheck` passed.
- `pnpm --filter @workspace/sikshya run test` passed: 154 tests, 0 failures. Existing Node
  module-type warnings remain and were not caused by this release.
- `pnpm --filter @workspace/sikshya run lint:design` passed with the unchanged baseline of 223
  hex literals and 429 raw font sizes; no new design-token leak.
- `pnpm --filter @workspace/sikshya run build` passed and verified both the production API URL
  and the Sikshya application identity.
- `npx --yes wrangler@latest deploy --dry-run --name hometuition` passed and read 242 files from
  the static-assets directory.

After deployment:

- Wrangler reported a successful `hometuition` production deployment.
- A cache-busted HTTP request to the real site returned status 200 and referenced the final
  `entry-f511b4a1c03291262c310044476fc3a4.js` bundle.
- The served production bundle contains the new classroom strings for Hide, Show, Medium, Full,
  and Restore controls.
- A fresh browser load of the actual production URL rendered Sikshya and redirected normally to
  `/welcome`; browser console inspection found no application errors.
- No classroom was started during automated browser verification because doing so would mutate a
  real scheduled session. The owner's real teacher/student interaction test remains the only
  proof of Daily controls, screen sharing, and whiteboard touch behavior in a live class.

Live production URL:

- <https://hometuition.praksh-dhakal.workers.dev/>

## Problems and surprises

- The fresh Expo/Metro production build took about 20 minutes instead of seconds. OneDrive paused
  filesystem reads for roughly 16 minutes, then resumed. Metro ultimately bundled all 3,904
  modules and the build completed successfully; no fallback to an older cached export was used.
- Wrangler is not a repository dependency. `pnpm exec wrangler` therefore is not available;
  the already-established ephemeral `npx --yes wrangler@latest` path used Wrangler 4.127.1. No
  package or lockfile was changed.
- The fresh production browser context had no production-origin login session, so the smoke check
  reached `/welcome` rather than an authenticated classroom. Bundle inspection proved the new
  classroom code is deployed, but it does not replace the owner's two-device live-class test.
- The production welcome screen visibly contains hardcoded claims `5,000+ Teachers`, `50,000+
Students`, and `77 Districts` in `app/welcome.tsx`. They were outside this deployment request
  and were not changed. They need a truth/data audit before launch; the issue was added to the UI
  backlog rather than silently ignored.

## Deliberately not changed

- No source UI or business-logic change was made during the production release itself.
- No backend, database, membership, booking, payment, WebSocket, R2, Daily, or session-state
  change.
- No Worker secret, binding, route, compatibility date, or API URL change.
- No provider migration or provider proof of concept.
- No production class was started and no user/session data was modified in browser verification.
- The unrelated paused `is_online` cleanup stash was not restored or changed.

## Remaining risks / next pickup point

- The owner should hard-refresh the production site and repeat the teacher-laptop/student-phone
  classroom checks on the actual production URL.
- If an old service-worker/browser cache still displays the prior interface, verify the main
  bundle name after a hard refresh before changing code; production itself serves the final
  bundle.
- The welcome-screen population/district claims are hardcoded and must be verified or removed in
  a future one-file UI truth pass.
- Minor classroom corrections mentioned by the owner have not been specified. Do not guess them;
  wait for the owner's concrete list.
- Daily remains active. Resume replacement research/prototyping only when the owner returns to
  that decision.
