# New class chat attachments

Date: 2026-09-12
Branch: `codex/class-chat-files`

## Delivered

- New class conversations accept a written message, one photo/PDF, or both.
- Choosing a file is separate from sending it. The selected name is visible and removable before
  the person presses Send.
- Attachments render inside ordinary and pinned class messages and open through the existing
  short-lived signed-link flow.
- The server verifies the real stored object, owner, size and type before attaching it. Browser
  claims are not trusted.
- Access follows the same batch authority as the class conversation. Teachers and booked students
  may open current attachments; late joiners cannot open earlier unpinned uploads even with a
  guessed key. A pinned teacher announcement remains available because the conversation itself
  deliberately gives it to new students.
- File-only notifications say `Sent a file` instead of showing a blank alert.
- Old one-off and Monthly conversation tables, routes and screens were not changed.

## Data safety

Added only `class_group_message_files`, with one file per message and unique object keys. No
existing table or column changed. The established idempotent class-group schema guard creates it.
No service, credential or purchase was added.

## Verification before commit

- Full workspace typecheck: pass.
- API unit suite: pass.
- Sikshya unit suite: 402 passed, 0 failed.
- Focused class-group/chat/homework tests: 14 passed, 0 failed.
- Design lint: unchanged at 94 hex literals / 282 raw sizes.
- `git diff --check`: clean.

## Preview deployment

- Feature commit: `d81fc0d`.
- Safety workflow `34736601430`: passed in 2m51s.
- Preview workflow `34736739070`: passed.
- Railway staging API: deployment `Add secure files to class messages` is active and reports
  successful.
- Cumulative preview: `https://hometuition-preview.praksh-dhakal.workers.dev`.
- Production was not changed.

## Not claimed

- No production deployment or real payment.
- No support for video files, executables or arbitrary document types; the existing safe photo/PDF
  policy is intentionally unchanged.
- Cloud storage itself is not mocked by the local unit suite. The existing storage integration and
  preview R2 configuration remain in use.
