# Unified Messages inbox and repeat-visit caching — 15 September 2026

## Outcome

Combined direct conversations and booked-class discussions into one Messages home and added an
immutable cache policy for fingerprinted web assets. Work is on `codex/unified-messages-inbox` for
Preview review; production remains unchanged until the Preview journey passes.

## Product changes

- Messages now contains direct conversations and class discussions in one newest-first list.
- A booked class is discoverable before anybody has sent its first message. Students can see only
  classes they joined, and teachers can see only their own classes with a booking.
- The inbox has All, Unread and Classes filters. Search includes the person name, class name,
  sender and latest message.
- Direct-message drafts remain device-saved. Class rows open the existing durable class
  conversation instead of creating a second chat system.
- The app refreshes the inbox for both direct-message and class-message live events.
- The website makes one inbox request instead of separate client round trips. The legacy direct
  endpoint remains available so a mixed frontend/API release cannot remove direct messaging.
- Fingerprinted Expo assets now receive a one-year immutable cache rule. HTML and unversioned
  files remain revalidated, so a new release is still discovered normally.

## Privacy and authority

- A student cannot discover an unbooked private class discussion.
- A late-joining student cannot see or count messages from before their booking.
- The teacher list excludes draft/empty catalogue classes and includes only a class with at least
  one booked student.
- Read badges continue to use the durable per-person class-message cursor; the UI does not invent
  per-message group-seen claims.

## Evidence

- API TypeScript: clean.
- Sikshya TypeScript with regenerated Expo route types: clean.
- API unit suite: **572 passed, 0 failed**.
- Sikshya unit suite: **473 passed, 0 failed**.
- Rendered unified Messages suite: **118 passed, 0 failed** at 390 and 1440 widths.
- Production web export: clean; `_headers` copied into the deployable `web-build` with the exact
  immutable policy.
- API build: clean.
- Design ratchet: **65 hex / 213 font-size literals**, no new leaks.
- Visual inspection: unified inbox at phone and laptop widths; no clipping or horizontal overflow.
- `git diff --check`: clean.

## Performance finding

The live site currently serves fingerprinted JS through Cloudflare with `max-age=0,
must-revalidate`, making return visits ask the network about unchanged bundles. The new `_headers`
rule removes that unnecessary repeat validation. The production export also measured two initial
shared JavaScript files at roughly 5.5 MB and 5.8 MB uncompressed. Splitting heavyweight
classroom/document features away from the initial route is the next performance slice; this change
does not pretend the cache correction solves that larger bundle problem.

## Deployment gate

The extended real-API `test:batch-booking` journey proves that a quiet booked class appears for the
right teacher and student, an outsider cannot discover it, incoming questions/replies appear with
the right sender and unread badge, and acknowledging the class discussion clears its inbox badge.
The Windows host has no disposable PostgreSQL service, so the Preview workflow supplies that gate.

## Next

Push this branch, run the Preview workflow, and have the owner test Messages once as teacher and
once as student. After it passes, merge to production under the standing authorization. Then split
the heavy classroom, diagram and document-preview code away from the initial application bundle.
