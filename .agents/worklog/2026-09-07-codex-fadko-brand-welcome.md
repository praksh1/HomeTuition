# Fadko brand and welcome integration — 7 September 2026

## Scope approved by the owner

Install the selected Fadko threshold mark and rebuild the welcome screen from the approved
mockup. Preserve Claude's Fadko rename and LiveKit trial work, avoid duplicate work, update the
existing dependency checkout, and do not deploy production before preview verification.

## Reconciliation before editing

- Started from `codex/fadko-livekit-integration`, based on Claude's pushed
  `claude/livekit-trial` commit `e54f141`.
- Preserved Claude's product rename, app identifiers, exact teacher/student routes and LiveKit
  provider-selection work.
- Preserved the already-declared and locked packages (`livekit-client` in the app and
  `livekit-server-sdk` in the API). No branding package was added because `react-native-svg`,
  `expo-image`, the token system and vector icons already cover the implementation.
- Ran `pnpm install --frozen-lockfile`; the lockfile was already current. This linked the
  dependency checkout without changing package declarations or versions.
- Kept Claude's earlier ascent, board and book concepts under `assets/brand/` as design history.

## Changes made

- Added the selected threshold mark as SVG masters, a 1024px app-icon master and a token-driven
  native `FadkoLogo` component.
- Installed the threshold icon at the path already used by Expo for iOS, Android, splash and web.
- Matched the Expo splash and Android adaptive background to the icon's warm-paper ground so the
  raster does not appear as a white square on the former navy background.
- Generated and compressed a text-free welcome hero showing a mature Nepali teacher, a student
  and their shared mathematics whiteboard. The JPEG is about 128 KB and contains no app copy.
- Rebuilt `app/welcome.tsx` as native responsive UI: warm ground, selected logo, approved hero,
  approved headline/supporting copy, and two role cards.
- Removed the redundant bottom sign-in link. Both role cards continue to open the same combined
  sign-in/sign-up flows Claude had wired.
- Added scrolling for small/landscape screens, safe-area padding, a reading-width cap, tokenized
  spacing/typography/colours, minimum touch targets and accessibility labels/hints.
- Updated brand README and asset metadata so later agents do not mistake rejected candidates for
  the installed identity.
- Added a source contract covering wording/artwork, exact routes, no redundant sign-in copy,
  scrollability and the touch-target token.

## What did not change

- No authentication, routing destination, data fetching, state, payments, Daily, LiveKit runtime
  behavior, API, database or WebSocket logic changed.
- No new dependency or paid service was introduced.
- No production deployment was performed.

## Problems encountered

- The first patch attempted to delete and add `welcome.tsx` in one operation; the patch tool
  refused the duplicate target. It changed nothing and the operation was safely split.
- Sandboxed TypeScript could not follow Windows pnpm junctions and falsely reported four modules
  missing. The same read-only typecheck with normal filesystem access passed.
- Claude's shared browser-test helper used a raw Windows absolute path with dynamic `import()`,
  so `test:livekit` initially failed before its assertions with `ERR_UNSUPPORTED_ESM_URL_SCHEME`.
  The helper now converts the resolved module path with `pathToFileURL`, which preserves Linux
  behavior and makes the same harness runnable on Windows. No provider code changed.
- The first preview dispatch stopped safely because GitHub had a Cloudflare API token but no
  `CLOUDFLARE_ACCOUNT_ID`. Added the known account ID as an Actions secret; no credential was
  written to Git.
- The next dispatch stopped in `pnpm/action-setup`: the workflow requested generic pnpm 11 while
  root `package.json` pins `pnpm@11.11.0`, and the current action rejects two version sources.
  Removed the redundant workflow version so CI follows the repository's exact package-manager
  pin. This changes deployment tooling only.

## Verification to date

- Typecheck: pass in all four workspaces (API server, mockup sandbox, Fadko app and scripts).
- App unit tests including the new contract: 258/258 pass.
- Design lint: pass at the unchanged baseline of 99 hex / 294 sizes.
- `git diff --check`: pass.
- Asset inspection: 1024px icon is about 6 KB; 3:2 welcome hero is about 128 KB.
- Phone render at 390×844: no horizontal or vertical overflow; role cards measured 358×82;
  hero loaded at 1280×853; no console errors. The only warning is Expo Notifications' known
  notice that push-token-change listeners are not supported on web.
- Laptop render: content remains centered at the reading-width cap and all controls are visible.
- Static web export: pass; bundle target verified as the existing Railway API and title as Fadko.
- `test:livekit`: the Windows module-URL defect is fixed; this laptop then stops at the explicit
  prerequisite check because Playwright/Chromium is not installed. No package was installed for
  that optional browser suite. Claude's earlier Linux run remains the available harness result.

## Remaining before release

The built `/welcome` route was inspected in Chromium: selected logo, hero, copy and both role
cards render correctly, with no redundant sign-in line. The LiveKit harness now gets past its
Windows module-path defect but cannot start Chromium because Playwright is not installed on this
laptop; no heavy global browser package was installed merely for this branding task. Complete
the remaining gates and deploy only the preview for owner approval.
