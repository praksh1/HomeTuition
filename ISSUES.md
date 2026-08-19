# Known issues

Running list of bugs and rough edges. Add anything you notice — a one-line description and
where you saw it is enough; I'll investigate and fill in the rest.

Status key: **open** · **in progress** · **fixed** · **won't fix**

---

## Reported 2026-08-01 (testing round 1)

### B1. Camera and microphone stay on after the call ends — **FIXED**
**Where:** teacher and student classroom, web
The webcam light stayed lit after ending a session; only closing the browser tab stopped it.
Both screens called `router.back()` without clearing `roomUrl`, so the call was only torn down
if the screen unmounted — and a navigation stack often keeps it mounted. Now the room URL is
cleared first on every exit path (End Session, Daily's own Leave button, teacher-ended-session),
which runs DailyEmbed's cleanup and releases the devices immediately.
**Status:** fixed — needs re-testing

### B2. Student was kicked out immediately after logging in on Android — **FIXED**
**Where:** app startup, any platform, most likely on a phone
`AuthContext.loadUser()` deleted the saved login on *any* failure of `/auth/me`, so a single
dropped request — a sleeping phone, a wi-fi blip, the dev server restarting — logged the user
straight back out. Now the token is only cleared on a genuine 401/403; network failures leave
it intact.
**Status:** fixed — needs re-testing

### B3. "Create & Go Live Now" ignores the mandatory Date/Time fields
**Where:** `app/(teacher)/session-create.tsx`
Date and Time are labelled `*` (required), but "Create & Go Live Now" deliberately skips them
and uses the current time — reasonable behaviour, badly communicated. The label is the bug, not
the behaviour. Date/Time should be presented as required only for *scheduled* sessions.
**Status:** open — small fix

### B4. Date/time picker looks dated, and no Nepali (Bikram Sambat) calendar
**Where:** `app/(teacher)/session-create.tsx`
On web it is the raw browser `<input type="date">`; on phone it is a plain text box where the
teacher must type `YYYY-MM-DD` by hand, which is poor on a touch screen. Teachers in Nepal will
expect Bikram Sambat dates — the official civil calendar — not only Gregorian.
**Status:** open — needs a proper date picker component plus BS/AD conversion

### B5. Classroom wastes over half the screen on the upload dock
**Where:** teacher classroom
The "Upload Photo"/"Upload PDF" buttons and the empty white board below them take more than
half the screen, leaving video a thin strip. Should be the reverse: video and interaction
dominant, uploading collapsed into a small control that expands only when used — closer to
Teams/Meet/Zoom.
**Status:** open — layout redesign

### B6. Slow first load on web
The dev server compiles the whole app on first request (~2000+ modules) and serves it
unminified. A production build is dramatically faster; this is a development-mode cost, not an
app defect. Worth re-measuring on a production build before treating it as a real issue.
**Status:** open — probably not a real bug

---

## Reported 2026-08-02 (testing round 2)

### C1. Students saw the rating box for teachers they never studied with — **FIXED**
**Where:** `app/(student)/teacher/[id].tsx`
The server was refusing correctly (verified: 0 of 25 teachers ratable, `POST /reviews` → 403).
The *app* asked the wrong question: eligibility was checked with the teacher's **profile id**
from the route, while the review was submitted with their **user id**. Two different numbers,
so the box appeared for strangers and could hide for teachers the student had actually studied
with. Both now use the user id.
**Status:** fixed — needs re-testing

### C2. Daily's own chat, hand-raising and reactions were switched off — **FIXED**
**Where:** `api-server/src/lib/daily.ts`
Rooms were created with `enable_chat: false`, which is why the app carries its own dated chat
above the call and why students had no Raise Hand. Now enabled: chat + history, hand raising,
emoji reactions, participants panel, network quality, noise cancellation.
**Applies to new sessions only** — rooms already created keep their old settings.
**Status:** fixed — needs re-testing

### C3. Teacher cannot mute everyone / has no moderator powers
Everyone joins the room as a plain participant. Moderator abilities (mute others, eject) require
a Daily **meeting owner token**, minted server-side and handed only to the session's teacher.
Not implemented — needs a `/sessions/:id/room` change to issue tokens.
**Status:** open

### C4. Uploaded material does not appear for the student
Material is broadcast over the app's own WebSocket board channel, not through Daily, so it only
appears on the app's whiteboard — never inside the call. Daily has no file sharing of any kind;
screen share is its only equivalent. Folded into the whiteboard rebuild.
**Status:** open

### C5. Notifications fire for expired and irrelevant sessions
Teachers get reminders for sessions long finished; students get notifications that appear
unrelated to them. Scheduling almost certainly is not cancelled when a session ends or is
completed, and reminders are probably not filtered by recipient.
**Status:** open — needs investigation

### C6. Tapping a notification does not open the relevant screen
Notifications should deep-link to the session, message or profile they refer to.
**Status:** open

### C7. Messages tab shows no unread indicator
No badge, dot, or count anywhere, so new messages are invisible until you go looking.
**Status:** open

### C8. Messages have no Inbox / Sent / Drafts
Requested structure for the messaging area.
**Status:** open

### C9. No notification when a new message arrives
**Status:** open

### C10. Whiteboard feels stiff and cramped — **being rebuilt**
Half the screen was split with video and then eaten by two full-width upload buttons; tools are
minimal; ink is stored in absolute pixel coordinates so it lands in the wrong place for anyone
on a different screen size. Decision taken 2026-08-02: keep and rebuild it properly, since **no
video vendor sells annotation** — Daily has none, Zoom's Web SDK has none, and Zoom's licensing
(one meeting per licensed host) does not fit a marketplace.
**Status:** in progress

---

## Open — known, not yet fixed

### A1. Enrolment does not require payment
**Where:** `POST /sessions/:id/enroll` (`artifacts/api-server/src/routes/sessions.ts`)
Enrolling creates a row with `paymentStatus: "pending"` and nothing ever promotes it to
`"paid"`. The classroom only checks that an enrolment row exists, so a student can join a paid
class without paying. Must be fixed before taking real money.
**Status:** open

### A2. iOS screen sharing not implemented
Needs a Broadcast Upload Extension, and cannot be built on Windows at all. Android only for now.
**Status:** open

### A3. Video rooms expire after 6 hours
`ensureDailyRoom` sets `exp` to 6 hours after creation (`api-server/src/lib/daily.ts`). Fine for
normal classes; a very long session would drop.
**Status:** open

### A4. Daily API key is in the chat transcript
Worth rotating in the Daily dashboard before anyone else gets access to this project.
**Status:** open

### A5. Phone layouts never designed for phones
Every screen was built and reviewed in a desktop browser. Expect cramped spacing, cut-off text
and awkward tap targets on a 6.1" screen until each screen is gone over.
**Status:** open

---

## Fixed (2026-08-01)

| # | Issue | Fix |
|---|-------|-----|
| F1 | Whiteboard zoom crashed the session when a photo was loaded | Images downscaled on upload (923 KB → 128 KB); zoom no longer re-renders the image; memory now flat across zooms |
| F2 | Any logged-in user could join any class's whiteboard, chat and materials | WebSocket now verifies the user is the session's teacher or an enrolled student, before the connection opens |
| F3 | Any teacher account could draw on / replace another teacher's material | Board writes gated on owning *this* session, not merely having a teacher role |
| F4 | Chat sender names were forgeable | Display name read from the database, not the client |
| F5 | Students could post unlimited reviews for one teacher | One review per attended session, enforced by a database constraint |
| F6 | Review window was 15 days from session *start* | Now 7 days from session *end* |
| F7 | Students couldn't join a live class; loading their own Sessions tab silently ended the teacher's class | Staleness now measured from when the class actually started (`startedAt`), not its scheduled slot |
| F8 | Students had to refresh to see a class go live | Sessions list polls every 15s while open |
| F9 | Late-joining students saw a blank board | Board state (material + strokes) replayed on join |
| F10 | Video error showed "[object Object]" | Daily rejects with a plain object, not an `Error`; message now extracted properly |
| F11 | Expo packages were from SDK 56 in an SDK 54 app | Aligned via `expo install --fix`; app crashed at startup on any real device before this |
| F12 | `@config-plugins/react-native-webrtc` referenced in app.json but missing from package.json | Added at the SDK-54-compatible version |
| F13 | `app.json` had two `"plugins"` keys, so the WebRTC config was silently discarded | Merged into one |
| F14 | `.env` was not gitignored | Added, before any secrets were committed |

---

## Reported 2026-08-18 (testing round: booking, lobby, whiteboard)

| # | Issue | Status |
|---|-------|--------|
| G1 | After paying, Discover still showed "Book & Pay" and offered to charge again for a class already booked | **FIXED** |
| G2 | A booked class showed "Enrolled — payment pending" forever, and refused entry at the door | **FIXED** |
| G3 | Unpaid classes appeared under Upcoming Sessions, then rejected the student on join | **FIXED** |
| G4 | Students could not enter until the teacher pressed start, so classes began with an empty room | **FIXED** |
| G5 | A new class opened onto the previous lesson's scribbles | **FIXED** |
| G6 | Whiteboard appeared to have no undo or clear | **FIXED** |
| G7 | Whiteboard was strokes, not objects — nothing could be selected, moved, rotated or resized | **FIXED** |

### What caused G1–G3

One bug, and it was self-inflicted. Booking was two calls — enrol, then confirm payment. When
the unverified payment endpoint was closed for security, the enrol half kept working and the
payment half silently failed. Every booking then created an enrolment that was never paid: the
class appeared in the student's Sessions tab, so they believed they owned it, but the door
refused them. Discover compounded it by never re-checking with the server after booking, so it
went on offering to sell the same class again.

Booking is now one atomic transaction: enrolled *and* paid, or nothing written at all. There is
no pending state left to get stuck in. Nine corrupted enrolments from the old flow were removed
from the database — nobody had been charged for them.

### The rest

- **G4** — paid students may now enter five minutes before the scheduled start and wait, with
  "Awaiting teacher to start the class" on screen; the class begins around them with no
  refresh. Starting the class no longer disconnects the people already waiting.
- **G5** — the board is wiped server-side when a class goes live, and each client resets when
  the session changes, including the teacher's own local strokes.
- **G6** — undo, redo and clear existed but sat at the far right of a horizontal scrolling
  toolbar with its scrollbar hidden, so on any narrow screen they were invisible with no hint
  that anything lay off the edge.
- **G7** — the board was rebuilt on Excalidraw. See `WHITEBOARD.md`.
