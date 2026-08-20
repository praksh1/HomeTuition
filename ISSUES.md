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

## Reported 2026-08-19 (whiteboard, testing round 3)

Five reports against the Excalidraw board, all from a live teacher/student session.

### D1. A second toolbar under the board, and none of it worked — **FIXED**
**Where:** `app/(teacher)/classroom/[id].tsx`
Pens, shapes, colours, sizes, eraser, zoom, pan, undo, redo and clear sat in a strip below the
canvas. Every one of them drove the *old* SVG surface, which stopped being rendered when
Excalidraw arrived — so the buttons did nothing at all, while costing the board a 56px strip
and reading as the board's real controls. The strip is gone, along with the state and handlers
behind it and the text-entry modal it opened. Excalidraw's own toolbar has done this job since
the rebuild.
**Status:** fixed — needs re-testing

### D2. The Stroke / Background panel covers the canvas and never leaves — **FIXED**
**Where:** `components/SmartBoard.web.tsx`
Excalidraw shows its shape-properties panel the moment a tool is picked (pressing `7`, or the
pencil) and leaves it there. On a laptop it is a reasonable sidebar; here the board is sharing
the screen with a video call, so it covered a quarter of the drawing surface with no way to
dismiss it. It is now hidden until asked for — a **Styles** button next to the board's top-right
controls toggles it — and it gets out of the way again the moment the teacher starts drawing.
**Status:** fixed — needs re-testing

### D3. No way to clear the board — only an eraser — **FIXED**
**Where:** `components/SmartBoard.web.tsx`, `ws/classroomHub.ts`
Rubbing out a whole lesson one stroke at a time is not a way to start the next problem.
Excalidraw's own "reset canvas" was worse than nothing here: it empties the local copy only, so
every student would have kept the whole board. There is now a **Clear board** control (the bin,
beside Styles, and in the board menu) which confirms first, wipes locally and tells the server,
so it means the same thing for everyone.
**Status:** fixed — needs re-testing

### D4. "Convert to text" turned a hand-drawn B into an L — **REMOVED**
**Where:** `components/recognition/handwriting.ts` (deleted)
It was Tesseract, which is a *printed*-text OCR engine; handwriting is a different problem even
in English, and the failures are not near misses. A button that confidently replaces what a
teacher wrote with a different letter costs more than a missing feature. Removed, along with
the `tesseract.js` dependency. `WHITEBOARD.md` §4 records what a real implementation needs.
**Status:** won't fix as built — needs ML Kit or MyScript, which is a budget decision

### D5. The student's board showed erased work, and was zoomed away from the lesson — **FIXED**
**Where:** `components/SmartBoard.web.tsx`, `hooks/useClassroomSocket.ts`, `ws/classroomHub.ts`
Two separate faults, both making the student's board disagree with the teacher's:

- **Erasing never reached anyone.** Excalidraw flags a rubbed-out element `isDeleted` and bumps
  its version rather than removing it, and `getSceneElements()` hides exactly those — so the
  outgoing diff saw no change and sent nothing. The teacher erased a scribble, drew an arrow,
  erased that and wrote a word; the student saw all three piled up. The diff now runs over
  `getSceneElementsIncludingDeleted()`.
- **Nobody agreed on where to look.** On an infinite canvas, matching elements is not enough:
  students opened at their own viewport and had to pinch repeatedly to find the teacher's work.
  The teacher's visible rectangle is now broadcast (`board_view`), replayed to late joiners, and
  fitted to each student's screen. A student who pans or zooms stops following, and a **Follow
  the teacher** button takes them back.

Verified end to end with two boards driven through the real page and the real message flow: the
student's canvas renders pixel-identically to the teacher's, before and after an erase, and
follows the teacher through a zoom.
**Status:** fixed — needs re-testing

---

## Reported 2026-08-20 (first full teacher/student run — Surface laptop teaching an Android phone)

The whole list, in the order it will be worked. Nothing here is closed by argument: each one
is closed by a test or by the owner seeing it work.

| # | Issue | Status |
|---|-------|--------|
| E1 | A photo the teacher shared arrived as an empty picture frame; resizing it gave students a bigger empty frame | **FIXED** |
| E2 | A shared PDF hid the whiteboard for the teacher and showed students a broken half-view neither could see was different | **FIXED** by E3 |
| E3 | PDF pages must live *on* the board, annotatable like anything else | **FIXED on web** — native still opens locally, see below |
| E4 | A teacher can open three concurrent sessions; starting a second tells students the first has ended while the teacher sees it running | **FIXED** |
| E5 | Teacher dashboard lists upcoming sessions, but Sessions → Upcoming is empty | **FIXED** — cause not reproducible without the live database, so the class of bug was removed |
| E6 | The whiteboard is live and shared before the teacher has started the call | **FIXED** |
| E7 | On Android Chrome the board is too small to teach on, and only the video can be maximised | **FIXED** — needs your eyes on a real phone |
| E8 | A student who drops takes a long time to rejoin, and sometimes cannot | **FIXED** |
| E9 | "The teacher has ended this session" reaches students who left long before | **FIXED** |
| E10 | Notifications are not real time: a new follower and a new message both arrive late or not at all. Wants per-user notification preferences, and email for the important ones | **FIXED** — email needs one setting from you, see below |
| E11 | Teachers cannot see who follows them; students cannot see who they follow | **FIXED** |
| E12 | Use Daily's in-call chat instead of the app's own | **DONE differently — read why** |
| E13 | Excalidraw's Library button opens a library teachers cannot use; wants curated free content instead | **FIXED** |

### E1 — what it actually was

Excalidraw stores a picture's bytes in a `files` map, separate from the element that draws it;
the element carries only position, size and a file id. The sync sent elements alone, so every
image element arrived pointing at data the student had never been given — which is precisely
what Excalidraw's grey placeholder is for. Files now travel with the elements that reference
them, once each, and are replayed to late joiners under their own much lower cap. Covered by a
test that shares a solid red picture and counts red pixels on the student's canvas: a
placeholder is grey, so it cannot pass on an empty frame.

Uploaded photos are also real board objects now rather than a picture painted behind the
canvas — movable, resizable, and counted when a student's view is fitted to the lesson.

### E2 — why it is "fail honestly" and not "fixed"

The PDF was broadcast and rendered independently by each participant. Making pages into board
images is the right fix (E3) and is not a small change. Until then a PDF opens for the teacher
alone, is not broadcast at all — so the student-side mess is gone — and the teacher is told on
screen that students cannot see it. A teacher who knows will hold up a photo instead; a teacher
who does not know teaches a lesson to nobody.

### E3 — where it stands

A PDF shared from the web app is rasterised in the teacher's browser and its pages placed on
the board as ordinary pictures, stacked in reading order: annotatable with every tool, movable,
and synced like a hand-drawn line. Students receive plain images and never run a PDF engine,
which is what matters on low-end Android. Beyond 25 pages the rest is left off and the teacher
is told — a board is not a textbook.

Two things are recorded in `.agents/memory/pdfjs-legacy-build.md` because both failed silently
and cost real time: pdf.js's modern bundle needs JavaScript that older Android browsers do not
have, and its worker is refused if served with the wrong MIME type.

**Still open:** on the *phone apps*, a picked PDF is a device-local `file://` URI rather than
bytes, so there is nothing to hand the board. It opens for the teacher alone with the banner
saying students cannot see it. Reading the file into memory first would close this, and the
board itself already knows how to do the rest.

### Found while doing E11, and worth more than E11

Two screens were showing invented data as though it were real, which is worse than showing
nothing: it lets someone believe a thing about their own business that is not true.

- The teacher's **My Students** tab was six hard-coded students — names, session counts,
  five-star reviews — displayed to every teacher who opened it.
- The student's **Payment Methods** listed two *verified* eSewa and Khalti accounts with masked
  numbers, for every student, invented in the code. No payment provider is connected at all.

Both now show the truth. Alongside them, two access holes: `PATCH /teachers/:id` required a
login and nothing else, so any account could rewrite any teacher's bio, subjects and price per
session; and `GET /students/:id/followed-teachers` would tell any logged-in user which teachers
any student follows. Both are now restricted to the person they belong to.

### E8 — two separate problems wearing one name

**"Sometimes cannot rejoin" was not slowness at all.** Nothing on the server checked whether a
connection was still alive. A phone that walks out of coverage, or a network that drops a
connection at a router, leaves a socket that is open on paper and carries nothing — and
*neither side is told*. The server kept the student in the room, so the class showed someone
who was not there. Worse, the student's app believed it was still connected, so it never
retried. It simply sat there. No amount of retrying would have fixed that, because the app had
no idea anything was wrong.

The server now pings every connection every 25 seconds and closes any that does not answer.
That is the standard WebSocket ping, which browsers reply to on their own — no change needed
in the app for it to work. It also keeps a healthy connection alive through the proxies and
mobile networks that drop an idle one after 30 or 60 seconds, which is very likely a second
cause of the same complaint.

**"Takes forever" was a schedule written for the wrong situation.** Every retry waited
`3 seconds × 2^attempts`, up to 30 seconds, whether or not the student had ever been in the
class. So a phone that blinked off for a moment cost three seconds; a genuinely patchy
connection — which is most of this product's market — soon cost half a minute at a time, while
the lesson carried on without them.

Those are two different situations and are no longer treated the same. A socket that has been
open once is a blip: it is retried after about 300ms, backing off to at most 8 seconds. One
that has never opened may be a server that is down, and still backs off to 30. Both are
jittered, because a teacher's connection wobbling disconnects the whole class at the same
instant and they should not all come back on the same tick.

And the app no longer waits out a timer it set while offline: coming back into signal, or
picking the phone back up, reconnects immediately.

**How it was checked.** Against a running server: a socket is made to go silent without
closing — the closest thing to leaving coverage that can be arranged — and the test asserts
the server notices, drops it, and lets the person straight back in. Both the user channel and
a real classroom socket. Turning the heartbeat off turns exactly that check red. The retry
schedule has six tests of its own, including the two properties that were wrong before: a
student who was in the class waits under 400ms, and nobody ever waits more than about 8
seconds.

### E10 — there were no notifications at all

This one was worse than reported. "Not real time" implies a system that is slow; there was no
system. The list every user saw was **invented on their own phone**: the app wrote six sample
notifications into local storage the first time it opened — a payment of NPR 500 from "Aarav
Shrestha", a verification approval, a subscription renewal — and showed them as though they
had happened. None of it ever touched the server.

The one thing that did work, new messages, worked only while the Messages screen was open: it
compared each poll against the last and announced the difference. Close the tab and nothing was
announced at all. Following a teacher wrote a row into the database that nothing ever read, so
a teacher was genuinely never told.

**What is there now.** A signed-in app holds one WebSocket to the server for as long as it is
open — separate from the classroom socket, which only ever carried one lesson and so could not
carry anything that happened outside one. Three things push down it today: a message, a new
follower, and a class going live (to the students who paid for it, and no one else).

The invented notifications are deleted. A new account's list is empty until something actually
happens, and there is a test that fails if sample data ever comes back.

**Preferences.** Profile → Notifications, for teachers and students alike. Four switches for
in-app alerts and four for email: messages, class starting, new followers, class reminders.
They are stored on the server, so they follow you to every device you sign in on. Turning one
off genuinely stops the notification being sent, rather than hiding it after the fact.

**Email needs one thing from you.** Nothing in this project could send an email — there was no
mail provider at all. The code is written and tested; it needs an account with a sending
service. Until two settings exist on Railway, the email switches appear greyed out with the
line "Email is not switched on for this server yet", rather than pretending to work:

- `RESEND_API_KEY` — from a free account at resend.com
- `EMAIL_FROM` — the address mail comes from, e.g. `Sikshya <hello@yourdomain.com>`
- `APP_URL` (optional) — so the links inside emails open the app

This follows the same rule as payments: what the server can do follows from what is configured,
not from a flag someone can flip by mistake.

**You do not have to run anything.** Storing preferences needs a new table, and the first
version of this put it as a column on the users table — which would have meant you running
`db:push` at exactly the right moment. That was tested rather than assumed, and it was bad:
with the code deployed and the database not yet updated, **logging in and registering both
returned 500**. The whole site, not just notifications, for as long as it took someone to
notice and run a command.

So it is a table of its own instead, and the server creates it on start-up if it is not there.
That is safe in a way a column change is not: it only ever creates, it does nothing at all if
the table already exists, and if it fails the server still starts — only the notifications
settings screen waits. Verified against a database that had never seen the feature: sign-in,
registration, browsing classes and sending messages all keep working throughout.

**How it was checked.** 39 checks against a real server and a real Postgres, and 9 more driving
the actual built app in a real browser — including that a message arrives with nobody touching
anything, that a brand new account's list is empty, and that turning a switch off really stops
it. Both suites were then deliberately broken to prove they fail: removing the preference check
turned exactly one red, removing the socket's token check turned exactly the three security
checks red, and stopping the app from listening turned exactly the four delivery checks red.

### E12 — you got what you asked for, by not doing what you asked

You asked for Daily's chat instead of the app's own. That is the one change this project has
already written down as a mistake, and the reason has not changed: **the phone app has no Daily
Prebuilt at all.** It uses Daily's SDK with a screen we built, because a WebView cannot share a
screen. Turn Prebuilt's chat on and a class with you on the laptop and a student on a phone has
*two* conversations that cannot see each other — and neither of you can tell. Each side sees
their own messages sent successfully and concludes the other is ignoring them. That is a worse
bug than the one being fixed, and it is invisible from a bug report.

So what was the actual complaint? On the web, chatting meant tapping the Chat tab, which hid
the video completely. You left the lesson to say a sentence. That is what "I want Daily's chat"
meant in practice — chat you can read without leaving the call. It did not require Daily's chat
at all, and the phone app already worked that way.

The class conversation is now inside the call on the web too: a Chat button on the video, with
an unread count, opening a panel over the call rather than instead of it. The call keeps
running underneath. It is the same conversation as the Chat tab and the same one the phone
sees — one conversation everywhere, which is the whole point.

The Chat tab stays, because the call is not always on screen: full-board mode hides it. Same
messages either way.

**Something worse found while testing this.** Daily's `join()` never fails when it cannot reach
the room — it does not return an error, it simply never finishes. So a student whose connection
could not reach Daily saw a **black rectangle, indefinitely**, with nothing to read and nothing
to do. Nobody would report that as a bug; they would report that the app is broken. There is
now a 20-second deadline, after which it says it is still trying and points out that the board
and chat work in the meantime — and if the call does come up later, the message removes itself.
A failed call also no longer takes the chat panel down with it, which it used to: a student
whose video failed lost the one way they had left to say so.

**How it was checked.** Seventeen checks driving the real component in a real browser, with the
test playing the classroom socket on both sides. Turning the in-call chat off turns exactly the
two chat-control checks red; removing the join deadline turns exactly the two "says so" checks
red.

---

## Reported 2026-08-20 (iPhone, Safari — five screen recordings)

The same teacher, this time on an iPhone. Three problems reported, and a fourth found in the
footage. Labelled P for phone; F is already taken further down this file.

| # | Issue | Status |
|---|-------|--------|
| P1 | The whiteboard toolbar is cut off on iPhone — tools missing | **FIXED** |
| P2 | A photo shared from the iPhone reached the student as an empty picture frame | **partly fixed — read below** |
| P3 | PDFs are greyed out in the iPhone file picker | **fix shipped, needs your phone to confirm** |
| P4 | The in-call Chat button sat on top of the call's own Leave button | **FIXED** — found in the recordings, not reported |

### P1 — the toolbar was missing its most important tool

Measured rather than eyeballed. At iPhone width the editor's own toolbar is 373px wide, the two
buttons this project adds to it (Styles and Clear) are another 70px, and the row is centred in a
393px screen. So 27px was lost off **each** side, and the **Selection tool ended up at x = -23**
— entirely off the screen. A teacher on a phone could not select, move or resize anything they
had drawn, which is most of the point of having an object board rather than a drawing surface.

The two buttons no longer appear in the phone layout. Nothing is lost with them: "Clear board
for everyone" is already in the menu there, and the style sheet already opens from the palette
in the bottom bar. They exist for laptops, where the properties panel covers a quarter of the
canvas and nothing dismisses it — a problem the phone layout does not have.

Now covered by tests that open the real board at three phone widths — iPhone 14, iPhone SE, and
a small Android — and fail if any tool lands off screen. Run against the previous build they
report exactly `off screen: Selection`, at all three sizes.

### P2 — the photo that arrived as an empty frame

**What was found, measured against a running server:** a picture over about 1.8 MB is dropped by
the server while its element goes through — which is precisely an empty frame on the student's
screen — and a picture over about 3 MB exceeds the WebSocket frame limit and **closes the
teacher's board connection** in the middle of the lesson. Neither said anything to anyone.

Both halves are addressed. Pictures are re-encoded down to a size the class can actually receive
before they are sent, whichever button put them on the board: the "Add material" upload always
did this, the editor's own image tool did not. And the refusal the server has always sent, which
nothing in the app had ever listened for, now reaches the teacher as a message instead of
leaving them explaining a picture nobody can see.

**What could not be reproduced: the exact failure on the iPhone.** In a desktop browser the
editor compresses a 12-megapixel photo to about 1.1 MB on its own, so it arrives fine — which is
why this was never caught here. The likeliest explanation is that the editor's compression
behaves differently under iOS Safari's canvas memory limits, but that cannot be confirmed
without an iPhone, so it is not being claimed as fixed. What can honestly be said is narrower:
the app no longer trusts the editor to keep pictures small, and when one still cannot be shared
the teacher is told rather than left guessing.

A large SVG *was* reproduced going over the limit — 2.43 MB, refused by the server, empty frame
for the student. That one is fixed outright: it now goes out at 0.06 MB.

**Worth trying again from your phone.** If the class still cannot see the picture, there should
now be a message saying so — and that message is the useful thing to report.

### P3 — PDFs greyed out in the picker

The picker asked for `application/pdf` and nothing else. iOS matches on the file's type
identifier, and without `.pdf` in the list it disables the very files the button exists to
choose. The extension is there now.

Honestly: this could not be verified here. iOS Safari cannot be run on this machine, and its
file picker is exactly the part that behaves differently from every other browser. It is a
one-line change with a well-established cause, but it needs your phone to confirm.

### P4 — the Chat button was on top of the Leave button

Not reported — found in the recordings. The in-call Chat button was placed at the top-right of
the video on the assumption that the call keeps its own controls along the bottom. True on a
laptop, false on a phone: the footage shows the Chat button, the call's **Leave** button and its
fullscreen control all stacked in the same corner, overlapping. Aiming for Chat and hitting
Leave ends the class.

It now sits in a strip of its own above the call, which cannot collide with anything — including
whatever the video provider does with its layout next.

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
