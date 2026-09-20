# The classroom's authority is a signed token, not a hidden button

Until 7 September 2026 every LiveKit join token carried `canPublish: true`. A class stayed
orderly because `LiveKitEmbed` drew no microphone or camera control for students — which is
protection against a student who behaves, and against nobody else. Anyone who opened a browser
console could publish audio and video into somebody's lesson.

## What replaced it

**A student's token permits nothing to be published**: `canPublish: false` and an empty
`canPublishSources`. Both fields, because they are separate in the protocol and an SDK that read
one without the other must still refuse. The teacher's token is unchanged.

**The floor is granted afterwards, by the server**, in `livekitProvider.setPublishing`, using
`RoomServiceClient.updateParticipant`. Not by minting a second token: that would mean handing a
client a fresh credential, asking it to reconnect mid-lesson, and leaving the old token valid in
the meantime.

`livekitProvider.silence` exists alongside it because revoking permission stops somebody
publishing *again* and does not close a microphone that is already open. A teacher pressing mute
means both.

## Three things worth not re-deriving

**`roomAdmin` is not part of `ParticipantPermission`.** A permission update is structurally
incapable of making somebody a moderator; moderator rights exist only as a claim in the signed
token, and the token gets them only from `isOwner`, which comes only from `lib/membership.ts`.
The compiler rejected an earlier version that set `roomAdmin: false` defensively — the guarantee
comes from the protocol, which is better than one from our own code.

**Permission is never activation.** Granting a microphone moves a student to "allowed"; their
device stays shut until they accept. Two reasons, and the second is the one that matters: a
browser will not open a microphone without a user gesture anyway, and a teacher who can silently
open a child's microphone is a surveillance feature. The owner asked for "invite all to speak",
not "unmute everyone" — those are different products.

**The decisions are pure.** `lib/classroom/speakingFloor.ts` has no database, no network and no
clock of its own, for the reason `lib/monthly.ts` states about money: a rule that can only be
exercised against a live LiveKit room and two browsers is a rule nobody runs. 35 tests state the
authority model in English.

## How a change here is proved

Two suites, and they answer different questions. `scripts/video-tests` decodes the JWT and
asserts what the *server* authorised, rather than trusting a UI that might be hiding a button
while the token underneath allows everything. `sikshya/scripts/livekit-live` runs a real SFU and
asserts that a granted student's camera actually reaches the teacher, and stops when revoked —
the half no unit test can cover.

When the token was tightened, the live suite failed immediately: the teacher decoded zero frames
from the student. That failure was the change working, and both suites now assert the classroom
model rather than the old one.
