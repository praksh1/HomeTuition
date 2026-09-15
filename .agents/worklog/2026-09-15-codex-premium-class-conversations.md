# Premium class conversations and expired-class recovery — 15 September 2026

## Outcome

Rebuilt the persistent class conversation and moved an expired classroom decision in front of
the video provider. Work is on `codex/premium-class-conversations` for preview review; production
is unchanged until the owner passes it.

## Why this slice

The reported notification journey was correct until its destination. A stale **Class is live
now** notification mounted Daily before Fadko had loaded the lesson, leaving the student with the
provider's small **Session expired** panel and no coherent way home. Separately, the class chat
was still a form followed by an ever-growing stack of cards even though direct conversations had
already been modernized.

## Product changes

- Student classroom entry now loads authoritative lesson details before requesting or mounting a
  Daily room. The API supplies its own clock so a wrong handset time cannot make the decision.
- A finished lesson opens a Fadko-owned **This class has ended** screen, counts down from ten,
  returns to the student dashboard automatically, and offers **Go to dashboard now**.
- The persistent class conversation now has a compact header, Nepal-day dividers and clock times,
  left/right message bubbles, clear teacher identity, pinned teacher updates, inline photo/file
  presentation, a fixed thumb-reachable composer, device-saved drafts, connection recovery and
  automatic movement to a newly received or sent message.
- No typing indicator, online status or group seen receipt was invented; the server does not yet
  know those facts.
- Busy classes now open on the newest 50 messages rather than the oldest 250. Earlier history is
  paged backward with a visible **Load earlier messages** action, and late-joining students remain
  unable to read the conversation from before they enrolled.

## Evidence

- API TypeScript: clean.
- Sikshya TypeScript (including regenerated Expo route types): clean.
- API unit suite: **569 passed, 0 failed**.
- Sikshya unit suite: **465 passed, 0 failed**.
- Rendered Messages/class-chat/expired-state suite: **78 passed, 0 failed** at 390 and 1440 widths.
- Rendered Notifications/settings suite: **40 passed, 0 failed** at 390 and 1440 widths.
- Visual inspection: phone class chat and expired-class states; no clipped controls or horizontal
  overflow, all primary actions at least 44 points.
- Design ratchet: **65 hex / 213 font-size literals**, no new leaks.

## Integration proof

`scripts/classroom-tests/run.mjs` now creates a paid student in an ended lesson, seeds the exact
live-notification tap, and asserts that the Fadko ending appears, no room request occurs, camera
and microphone are never requested, the ten-second redirect fires and the immediate Dashboard
button works. This database/browser test cannot run on the Windows host because it has no local
Postgres; the Preview workflow supplies a fresh Postgres service and runs the gate there.

## Deliberate boundaries

- Direct person-to-person messaging was already modern and remains unchanged.
- Class group read acknowledgement remains one cursor per person. A claim such as “seen by all”
  would need a real aggregate contract before the UI may show it.
- This does not alter Daily credentials, payment, booking, attendance, or refund policy.

## Next

Push the branch, run the Preview workflow against staging, then have the owner test one expired
notification and one class conversation as both teacher and student. After that passes, merge to
production under the standing authorization and continue with the unified Messages inbox so class
groups and direct conversations are both discoverable from one place.
