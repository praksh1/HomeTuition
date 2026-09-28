# Class library, profile photos and board readability — Preview

- Date: 2026-09-28
- Branch: `codex/support-case-workspace`
- Scope: isolated Preview Worker and `hometuition-api-staging` only; no Production release or purchase

## Changed

- Signed private profile-photo views now travel with authenticated profile and approved teacher-directory responses. Own profile, shell header, teacher cards, followed-teacher cards and student class cards render the photo over initials. A photo failure falls back to initials without blocking login or the whole directory.
- The student class library starts with one card per enrolled class, split into `Active (n)` and `Past (n)`. Opening a class reaches Class Home, where its schedule, materials, homework and messages already live. The lesson detail now links back to Class Home for grouped classes.
- New browser profile uploads are resized to a maximum 640 px and JPEG-compressed when this reduces bytes. A signed photo URL is reused for up to eight minutes, avoiding needless refetches caused by a new signature on each account refresh. The bucket remains private and storage keys are not returned.
- Student read-only whiteboards default to a more readable cross-aspect view when a portrait teacher phone is viewed on a landscape student screen. A local `View` control offers Fit full board and +/- zoom; it cannot send a competing teacher viewport. Classroom mic/camera status now sits on an opaque high-contrast pill.
- `Feature`/`Stop featuring` is relabelled `Pin video`/`Unpin video`. It controls LiveKit video spotlight, not whiteboard edit access.

## Verification

- Workspace typecheck and API build passed; API unit tests 787/787, design lint passed.
- Student sessions UI 48/48 and profile UI 260/260 passed at phone and laptop widths.
- Classroom floor UI 360/360 and media UI 4/4 passed. Board suite 154/154 passed on the prior bundle; the focused 14-page PDF/cross-device view case passed 18/18 against the final rebuilt web bundle.
- The database-backed API floor integration test could not start locally: `psql` is not installed. This is not counted as a pass.
- Staging API deployment `7c48e67d-0df6-47e3-8de8-df68e5aaeda1` reached SUCCESS; readiness returned `ok`. Its approved teacher had a signed JPEG photo that returned HTTP 200, and two profile reads returned the same short-lived URL without exposing `profilePhotoKey`.
- Preview Worker dry run passed. Preview Worker version `741d7759-087d-48bd-be00-c79e9c4e32f6` deployed at `https://hometuition-preview.praksh-dhakal.workers.dev`. `scripts/verify-preview.mjs` matched served HTML and all three initial bundles to the local build and staging API; the Production API hostname was absent.

## Boundaries and follow-up

- Existing uploaded photos can still be large: the staging teacher JPEG was about 2 MB. New browser uploads are reduced, and short-lived URL reuse avoids duplicate downloads, but existing originals were not transformed or deleted. Monitor real-device directory speed before increasing page size.
- Student photos are not made public to arbitrary visitors. A separate privacy-scoped decision is needed before showing minors' photos to other participants; this release makes a student's own photo visible in their account and teacher photos visible in approved discovery/class surfaces.
- This did not create student whiteboard edit grants. `Pin video` is only a video layout control.
- A paired iPhone/laptop live lesson with an existing PDF and real profile-photo refresh remains a physical-device acceptance check for the owner. No Production Worker/API was changed.
