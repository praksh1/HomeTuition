# New class material attachments

Date: 2026-09-12
Branch: `codex/class-material-files`

## Delivered

- A teacher can add one optional photo or PDF to a new-style class material while keeping the
  existing title, note and web-link options.
- Choosing a file is separate from adding the material. The chosen name is visible and removable;
  storage begins only after the teacher presses Add material.
- The student and teacher see the attachment on the material card and open it through the existing
  short-lived signed-link flow.
- The server checks the stored object's real owner, size and type before linking it to the class.
- A second rapid press cannot create a duplicate material while the first upload is running.
- The old Monthly materials, homework, conversations and their tables were not changed.

## Access and data safety

- Added only `class_group_material_files`. No existing table or column changed.
- One file belongs to one material; material deletion cascades to its file record.
- The existing class-group authority decides access. The teacher and booked students may open a
  handout; outsiders may not. A late-joining student may open class materials because handouts are
  intentionally shared class resources, unlike unpinned historical chat.
- Files remain limited to the established photo/PDF types and 10 MB server cap.

## Verification before commit

- Full workspace typecheck: pass across all four packages.
- API build: pass.
- API unit suite: 556 passed, 0 failed.
- Sikshya unit suite: 404 passed, 0 failed.
- Focused class-group and material checks: 9 passed, 0 failed.
- Design lint: unchanged at 94 hex literals / 282 raw sizes.
- `git diff --check`: clean.
- The real database journey was not run locally because its safety guard correctly requires an
  explicitly disposable PostgreSQL URL. The repository safety workflow supplies that database.

## Not claimed

- Not deployed to production and no real payment changed.
- No video, executable or arbitrary-document support.
- No file deletion or replacement UI in this slice; a teacher can add another clearly named
  material if a revised handout is needed.

## Preview deployment

- Feature commit: `ab030fd`.
- Safety workflow `34737379824`: passed in 2m35s.
- Railway staging API: `Add secure files to class materials` is active and successful.
- Preview workflow `34737499748`: passed in 5m4s.
- Cumulative preview: `https://hometuition-preview.praksh-dhakal.workers.dev`.
- Production was not changed.
