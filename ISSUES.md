# Known issues

Running list of bugs and rough edges. Add anything you notice — a one-line description and
where you saw it is enough; I'll investigate and fill in the rest.

Status key: **open** · **in progress** · **fixed** · **won't fix**

---

## Before this goes to the App Store, Play Store, or a real launch

Not a wish list — these are the things that are *unsafe or wrong* to launch with, and each one
is cheap next to what it costs afterwards. Tick them off in order.

- [x] ~~**Rotate the Daily.co API key.**~~ Done by the owner on 2026-08-24: rotated in the Daily
      dashboard and updated in Railway. The old key had been pasted into a chat transcript, so
      it was public and anyone holding it could create rooms and bill the account. The lesson
      outlives the task — never put a key, connection string or token in chat; hand over the
      variable name and let the owner set the value. See A4.
- [ ] **Decide what happens to chat.** Daily's chat is web-only. The moment an installed app
      is in someone's hands, a class mixing an app user and a browser user has two
      conversations that cannot see each other, and both look like they are working. Either
      bridge them or turn Daily's chat back off and fix the app's own panel. See
      `.agents/memory/one-chat-per-class.md`.
- [ ] **Somebody has to actually pay the refunds.** The Refunds tab in the support desk is the
      payment system: every row is a debt an agent settles by hand and then records a reference
      against. Students are told a refund is *requested* and takes 5-7 business days, which is
      true and will stay true until a provider exists. Decide who does this and how often, or
      the queue grows and the promise stops being kept. See REFUNDS.md section 2b.
- [ ] **Wire a real payment provider.** Today bookings approve themselves and no money moves.
      Setting `PAYMENT_WEBHOOK_SECRET`, `ESEWA_MERCHANT_ID` or `KHALTI_SECRET_KEY` closes that
      door and declines every booking, because the eSewa/Khalti branch is not written. See A1.
- [ ] **Set the email variables** if you want email notifications: `RESEND_API_KEY`,
      `EMAIL_FROM`, and `APP_URL` for the links inside them.
- [ ] **Create the Cloudflare R2 bucket and set four variables on Railway.** The code is done
      and tested; it needs a bucket. Until then the app says "File uploads are not set up on
      this server yet" and reports still go through without their attachment. Step by step in
      `DEPLOY.md` under *Uploaded files*.
- [x] ~~**Decide where uploaded files go.**~~ Cloudflare R2, chosen for no egress charges and
      the account already existing. Attaching anything to a Customer Support report had
      never worked — the app asked for an upload URL with the wrong field names and every
      attempt returned 400 before a byte left the phone. That part is fixed, but the endpoint
      behind it still wants object-storage settings left over from this app's Replit origins
      (`PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`), which do not exist on Railway. Until
      somewhere to put files is chosen, a report goes through without its attachment and the
      person is told so. This blocks the part of the refund policy that assumes somebody can
      hand over a video. See F1.
- [ ] **Turn both test-access switches off and check no live grant remains.**
      `ALLOW_TEST_TEACHING_ACCESS` lets a named teacher create classes without paying for a plan;
      `ALLOW_TEST_STUDENT_ACCESS` lets a named student book *those* classes without paying. Both
      default to off and both must be unset on Railway before the public arrives. Unsetting them
      is enough on its own — a grant does nothing while its switch is off, whatever the table
      says, and no test booking has ever counted as revenue — but look anyway:

      ```sql
      select * from test_teaching_grants where revoked_at is null and valid_until > now();
      select * from test_student_grants  where revoked_at is null and valid_until > now();
      ```

      Leave any rows in place; they are the record of who could act for free and who said so.
      See `.agents/memory/test-access-is-two-grants-and-two-switches.md`.
- [ ] **Test the whiteboard on the cheapest Android you can find.** The target market is a
      phone nobody here has held. The same run should cover the call window — hide, minimise,
      drag, rotate, full screen. Those were proved in a desktop browser sized to a phone, which
      is not a phone: it has no weak GPU, no thermal throttling and no real touch.
- [ ] **Settle the name, then the bundle identifier, before the first store build.** The owner
      expects to rename once more before launch — "probably GharTuition or TuitionGhar or
      something similar". The name itself is cheap to change at any time: `name`, `slug` and
      `scheme` in `artifacts/sikshya/app.json`, then a rebuild — and the build now fails loudly
      if a stale bundler cache tries to ship the old one.

      The **identifier** is the part that is not cheap. It is `com.sikshya.app` on both iOS and
      Android today, free to change until the app is published and *impossible* afterwards: a
      different identifier is a different app, with its own downloads, ratings and reviews, and
      existing users do not get moved across. So the order matters — decide the name, set the
      identifier to match it, and only then make a store build. Set in
      `artifacts/sikshya/app.json` (`ios.bundleIdentifier` and `android.package`).


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

**Now closed on the phone apps too, with one thing left to confirm on a real device.** A
picked PDF used to be a device-local `file://` URI rather than bytes, so there was nothing to
hand the board and it opened for the teacher alone. The app reads the file into bytes and posts
those to the board instead. Nothing about the board itself changed: on a phone it is a WebView
running the same web board, which already turns a PDF into pages — it only ever wanted the
bytes rather than a path to them.

What still cannot be checked here is the size a phone will actually carry. Everything else
crossing into the WebView is small; an 8 MB PDF is about 11 MB once base64-encoded, and the
largest thing proven across that bridge so far is a compressed photo at roughly 1 MB. A message
that big can be *dropped* on the way in rather than refused, which from outside looks exactly
like a board still thinking.

So it is made visible rather than guessed at: the board acknowledges a document the moment it
arrives, and the app tells the teacher plainly when no acknowledgement comes — "the whiteboard
did not receive that file, it may be too large for this phone". If a PDF fails on your phone
you will be told, and the message tells us where the real limit is. **Worth testing with a
large PDF (5-8 MB) as well as a small one.**

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

## Reported 2026-08-21 (teacher on Android, student on iPhone)

Nine problems from a real class. Labelled G.

| # | Issue | Status |
|---|-------|--------|
| G1 | A teacher could start a class that ended days ago | **FIXED PROPERLY** — the first attempt guarded the wrong screen, see below |
| G2 | The app's in-call chat took over the screen and could not be closed | **FIXED** — Daily's chat is on instead |
| G3 | Adding a PDF to the whiteboard still does not work; the picker has no way to cancel | **FIXED** — two causes found |
| G4 | Force-closing the browser left a class live, blocking the next one with no way back | **FIXED** |
| G5 | On iPhone the chat box sits under the browser's URL bar | **FIXED** — needs your phone to confirm |
| G6 | Two End Call buttons | **FIXED** |
| G7 | Let a teacher tell their students about a new class | **FIXED** |
| G8 | Student Sessions and Discover go blank for a few seconds | **FIXED** |
| G9 | Search cannot cope with how people actually type a name | **FIXED** |

### G1 and G4 — when a class may run

These are one subject. A class was only ever "live" or not, with nothing recording what had
actually happened to it, so both of these were possible at once: a class from days ago could be
started, and a class nobody was in could not be got rid of.

A class that is over now stays over, with a **three-hour window** after it finishes — the
owner's reasoning, kept because it is the whole justification: a teacher may have ended the
call by accident and should be able to get straight back in. Past that, starting it again is a
mistake far more often than an intention. The window is measured from what actually happened:
when it ended, else when it started plus its length, else the slot it was booked into. So a
12:30 class begun at 15:00 is a class in progress, not a stale one.

Force-closing is now recognised. The classroom connection records that the teacher is in the
room; a live class whose teacher has been gone **two minutes** is closed rather than left
blocking the next one. Two minutes rides out a phone changing cell — the socket reconnects in
well under a second, and its heartbeat notices a dead one within about 25 — without locking a
teacher out for an hour after a force-quit.

And the refusal has always named the class it meant. The app threw that away and showed only
the message, which is what left a teacher told they had an active session with no route to it.
It now offers to open that class.

### G3 — the PDF, and two separate reasons it failed

The first fix went to the wrong place. There are two file pickers in the classroom: one for the
phone apps, and an invisible `<input>` overlaid on the button for the web. The `.pdf` extension
was added to the first and the browser uses the second, so on the web nothing changed at all.

The second reason is why it failed on Android even with the picker working. The code asked
`file.type === "application/pdf"` and nothing else — and a PDF picked from Android's Downloads
or Drive commonly arrives with **no type at all**. It was therefore sent down the image path,
where the teacher was told their PDF could not be opened as an image. That is also why photos
worked: a gallery photo does declare its type. The file name is now consulted whenever the type
is missing or meaningless.

The picker menu also has a **Cancel**. There was no way out of it except the browser's Back
button, which you were right to be wary of.

### G5 — the chat box under the URL bar

Expo's web page sizes everything with `height: 100%`, and on iOS Safari that measures the
**layout** viewport, which extends behind the browser's own toolbar. Anything at the bottom of
the screen — the message box — is drawn underneath it. The app now sizes itself to the viewport
as it actually is, which shrinks and grows as Safari's bars collapse.

Verified only as far as it can be here: the fix is in the shipped bundle. iOS Safari cannot be
run on a build machine, so **this one needs your phone**.

### G7 — telling your students about a class

When creating a class, a teacher can now pick from the students who follow them and those who
have taken a paid class with them. Those students get a notification with a link.

**It grants nothing.** The owner underlined this and it is worth stating plainly: an invitation
writes no enrolment, issues no token and opens no door. There are tests that create a class
with an invitation and then check that nobody is enrolled, nobody is marked paid, and an
invited student who has not booked is **refused at the classroom door** — and let in only once
they have booked and paid, exactly like anyone else. A teacher also cannot use this to reach
the platform: the recipients are filtered on the server against their own followers and past
students, so a crafted request reaches nobody new.

### G9 — searching for a name

Every spelling reported — `RamPrasad`, `ram p rasa d`, `ram pra sad`, `r ampr asad` — now finds
Ram Prasad Sharma, checked against the real server. Spacing and punctuation are ignored on both
sides, because that is what a thumb on a phone produces. Results are ranked while typing, so
the person asked for is not buried under whoever happens to be rated highest. The app and the
server apply the same rule: a search that found someone on one screen and missed them on the
next would be worse than either.

---

## Reported 2026-08-22 (fifth run) — after the fourth-round deploy

### J1 — the camera stayed on after the class ended — **FIXED**
**Where:** teacher, web. Screenshot shows the browser's camera indicator still lit on the
session list, after the class was over.

Nothing in the app was using the camera. The abandoned call was. Tearing the video down called
Daily's `destroy()`, which removes the iframe but does not reliably end the call inside it — and
a frame still in a call keeps its camera and microphone. The order is now `leave()` and then
`destroy()`, and the destroy still runs if the leave fails: a frame that will not leave must not
be left behind holding the devices.

There is also a sweep for a frame this module has lost track of. Daily keeps its own pointer to
the one frame a page may have; if ours is ever dropped — a re-render at the wrong moment, an
error between creating a frame and recording it — that frame holds the camera and nothing here
would ever release it. Asking Daily is the only way to find it.

Four checks in `scripts/call-leave-tests` drive it with a stand-in SDK: the call is left, the
frame is destroyed, in that order, and Daily itself is left holding no call. Reverting to the
old teardown prints `["destroy"]` with no leave.

### J2 — two chats in one class — **FIXED on web**
Daily's chat works now, so the classroom's own tab beside the board was a second, emptier
conversation next to a working one: "I don't want teacher and student to get confused on which
chat system to use."

Hidden on the web, where the call carries Daily's chat. **Kept on the installed iOS and Android
apps**, where Daily's chat does not exist at all — those drive the native SDK behind this app's
own call interface, which has no Prebuilt panels, so removing it there would leave a student on
a phone with no way to ask a question. One rule, in `utils/classroomChat.ts`, with tests.

That difference is the split already on the pre-launch checklist: a class mixing an installed
app with a browser has two conversations that cannot see each other. Nobody is on an installed
app today, so nothing is paid for it yet.

### J3 — the "+ Add" payment method button did nothing — **FIXED**, and it was the small half
**Where:** student → Profile → Payment Methods

Two reasons, and removing the button answers both. `Alert` is a React Native module that
**react-native-web does not implement**, so the tap did nothing at all in a browser. And had it
worked, it promised "add a new payment method via eSewa or Khalti" when there is no payment
provider connected and nothing to add. A control that cannot do its job is worse than none — it
makes somebody think the fault is theirs. It comes back with the payment provider (A1).

The empty state now also answers the question behind the report — *"I used this account to pay
with eSewa/Khalti, why is nothing here?"* — by saying that choosing a method when booking
applies to that class only, that no account is stored, and that nothing has been charged to one.

### J4 — thirteen other buttons that said nothing on the web — **FIXED**, found while fixing J3
Not reported, and worse than what was. `Alert.alert` is silent on the web, and thirteen call
sites used it with no web path at all. Every one was a message somebody was supposed to see and
nobody ever did:

- **Booking a class**: "Booked! Paid with eSewa" and "Payment declined — nothing has been
  charged and you are not enrolled". A student paid and the app said nothing at all.
- **Uploading credentials**: "Uploaded — reviewed within 24-48 hours", the failure, and the
  permission refusal. A teacher had no idea whether it worked.
- **Support**: both the success and the failure of submitting a report.
- Also "Already booked", the rating thank-you and its failure, and the profile settings rows.

All now go through `utils/alerts.ts`, which uses the browser's own dialog on web and `Alert` on
a phone. The two Log Out buttons were **already** guarded and were never broken; the classroom
had worked this out too and branched inline every time. This is that, in one place, so the next
screen cannot forget.

---

## Reported 2026-08-21 (fourth run) — after the Sikshya rename and PDF-on-phone deploy

Three recordings: an Android student watching a shared PDF, and an iPhone teacher trying to
get back into a call they had ended. Five reports, four of them reproduced here before being
fixed and one still open.

### H1 — the PDF that turns into a grey icon on the student's board — **FIXED**
**Where:** student on Android; teacher had shared a PDF

The student saw the page, and then a grey image placeholder instead. Two separate defects, in
two different processes, both producing exactly that and both silent.

**On the server.** The classroom hub filtered elements and their pictures *independently*. A
picture refused for being too large, or for being past the forty-picture limit a board holds,
was dropped — and its element was broadcast anyway. Every student then rendered an empty frame,
permanently. The teacher's own board looked right throughout, because it draws from local
memory rather than from what was sent, so nobody in the room could tell the two had diverged.
The hub now refuses the frame along with the picture, and drops it from the stored board so a
late joiner is not replayed the same hole.

**On the teacher's board.** The same shape of mistake one process earlier. A picture that could
not be re-encoded small enough was marked unshareable, and the guard that holds an element back
until its picture is ready read `&& !unshareable.has(fileId)` — which skipped the guard entirely
for exactly the pictures that could never be sent. The comment three lines below it said the
opposite of what the code did.

The board-limits suite has said "refused rather than half-delivered" in its title since it was
written, and only ever asserted the picture half. It asserts the frame now too, and reverting
either fix turns those checks red naming the exact elements that got through — `el_big`, and
`el_p40` through `el_p45`.

**Not yet explained:** in the same recording the student's board also jumps away from the
content entirely — "Scroll back to content" on an otherwise blank canvas — when the teacher
zooms or scrolls. Driving a teacher and student board through zoom and scroll here keeps them
pixel-identical, so that is a separate fault and it is still open. See H5.

### H2 — a teacher could not get back into a call they had ended — **FIXED**
**Where:** teacher on iPhone, within minutes of ending the class

"Setting up video room…" forever, with the whiteboard loaded underneath.

The server was never the problem: it hands back a room for a class ended minutes ago, which is
what the three-hour window is for. The classroom screen threw it away. It could not tell "I
ended this and came back" from "someone ended this while I was in it", so re-entering a class
you had hung up on took the second path: the room was nulled, and the teacher was told *"if you
started another class, that one ended this one"* — which they had not — and bounced to the
dashboard. On a phone that alert blocks, so the screen sat on "Setting up video room…" with the
room already discarded.

Three things were wrong and all three are fixed: a class the teacher ended and comes back to
inside the window is taken live again rather than refused; the "ended elsewhere" interruption
now only fires for a class that was live *on this visit*; and a live class with no room asks for
one instead of spinning, because `loadRoom` previously ran once at mount and nothing could ever
bring it back.

The owner's suggestion was to load the whiteboard only after the video arrives. That would have
hidden this rather than fixed it — the board loading first was not the fault, the room being
discarded was — and it would make a poor connection cost the teacher their board as well as
their call.

### H3 — Profile → Notifications went to the Dashboard — **FIXED**
**Where:** teacher profile, any platform

The screen was fine and unreachable. The route guard keeps its own list of screens that belong
to neither the teacher nor the student tab group; `notification-settings` was declared as a
screen and left off that list, so a teacher who went there failed every branch of the role check
and was `replace`d back to their dashboard. Its sibling `notifications` *was* on the list and
worked, which is what made it look like a dead button rather than a routing bug.

There is one list now, read by both the guard and the navigator, so the two cannot disagree
again. The app's notification suite tries the door.

### H4 — a teacher cannot start a conversation — **FIXED**
**Where:** Messages, teacher

`ConversationList` listed conversations and offered no way to begin one, on either side. A
student could message a teacher from that teacher's profile; a teacher had nowhere to start, so
their Messages screen showed conversations they could only ever reply to under an empty state
reading "Messages you send or receive will show up here" — true, and no help when there is no
way to send one.

There is a **New** button on Messages now, and the empty state offers the same thing rather than
just describing the emptiness. It opens a picker of the people that person could sensibly write
to, from `GET /message-recipients`: for a teacher, the students who follow them and the students
in their paid classes; for a student, the teachers they follow and the ones they are learning
from. Names are searched with the same matcher as the rest of the app, so "si ta" finds Sita.

Two sources unioned, because either alone is wrong. Subscription is the relationship the owner
named. Enrolment is the one that matters in practice: a student who has paid for your class is
someone you must be able to reach whether or not they ever tapped Follow.

**This is a convenience, not a gate.** `POST /messages/:otherUserId` still accepts any real
user, exactly as before. Narrowing that is a separate decision — it is the only thing standing
between the app and unsolicited messages between strangers, and it also governs the
student-to-teacher direction that already works, so it should not be changed in passing.

### H6 — loading a tab URL directly bounces to the dashboard — **OPEN**, found while fixing H3
**Where:** any platform, web

Not reported, found by a test that tried to reach `/profile` by loading it rather than by
tapping the tab. Opening a tab URL cold — a refresh, a shared link, a bookmark — lands on the
dashboard instead. Tapping the tab from inside the app is fine, which is why nobody has hit it.

Same guard as H3, a different hole in it: on a cold load the route's group has not been resolved
when the role check runs, so `segments[0]` is `profile` rather than `(teacher)`, the check
decides the user is somewhere they should not be, and replaces them. Worth fixing before anyone
shares a link to anything, and worth fixing carefully — the guard is what keeps a student out of
teacher screens.

### H5 — Daily's chat does not appear in the call — **FIXED, needs your phone to confirm**
**Where:** the video call, web

The hypothesis held up in the code. A room is created once and then reused for the rest of its
life, and `ensureDailyRoom` returned an existing one untouched — so a room's settings freeze at
whatever they were the day it was made, and every later change to them reaches new rooms only.
Turning Daily's chat on therefore left every room already in existence without a chat panel, for
the whole six hours until it expired. The same would have been true of every future change to
those settings, silently.

An existing room is now checked against the wanted settings on the way past and repaired if it
is short of them. It costs one extra API call, and only when something is actually wrong. A
repair that fails is logged and the lesson goes ahead: a call with the wrong settings is worth
far more than no call at all.

**What is proven and what is not.** The comparison is its own module with no imports, and seven
tests cover it — a room that is already right, one with chat switched off, one missing a setting
entirely, one from before any of this, several wrong at once. Breaking the comparison so it only
notices *missing* settings rather than wrong ones turns three of them red. What cannot be
checked here is the call to Daily itself: there is no API key in this environment and no route to
their API, so **the repair has never run against a real room**. If chat still does not appear
after this deploys, that is where to look, and the server log line is `repairing Daily room
settings`.

### H7 — a video call that fails to connect ended the class — **FIXED**
**Where:** teacher's classroom, any platform

Found by CI while checking the H2 fix, and it is the more serious of the two.

The teacher's classroom ends the class when the call reports a leave — mark it completed, tell
the students, go back. Daily emits `left-meeting` when a join **fails** as well as when somebody
hangs up. So a room that could not be reached — a poor connection, a room that had expired,
Daily having a bad day — silently marked the lesson finished and threw the teacher out of their
own class, with "Class ended" as the only explanation. On the connections this product is built
for, that is not an edge case.

It also explains why the H2 fix passed here and failed on CI twice: this sandbox cannot reach
Daily at all, so the call never runs and never fails. CI can. Every local run was green because
the bug needs a *working* network to a *broken* room.

A leave now only counts if there was something to leave — the embed records a join first. The
new suite replaces Daily's SDK with one the test drives, so both orderings are reproducible
anywhere: a leave with no join before it must not end the class, and a leave after a join still
must. Reverting the guard turns four of its five checks red.

### H5b — the student's board loses the lesson — **OPEN, with a likely cause found**
**Where:** student, any platform

Described under H1: the student's board jumps away from the content ("Scroll back to content"
on blank canvas) and a shared picture shows as a grey placeholder. The empty-frame fault fixed
in H1 was one half of it. This is the other half, and it is **not fixed**.

**The likely cause, from reading rather than from a reproduction.** In the student's classroom
the board is *conditionally rendered* — `{mode === "board" && ...}`, inside `{!videoExpanded &&
...}`. So switching to Chat, or expanding the call, **unmounts** it. Everything the board knows
lives inside that component: the elements it has accumulated, the pictures registered with the
editor, which versions have been seen. Unmounting throws all of it away.

Nothing brings it back. The catch-up that would rebuild the board is sent when the **socket**
connects, and the socket lives in the screen above, which does not remount. The queue of pending
deltas has already been consumed by the previous instance. So a student who glances at the chat
and comes back gets a blank board that then fills in only with whatever the teacher draws next —
and a picture element arriving without its file renders as exactly the grey placeholder that was
reported.

The teacher's classroom already learned this for video: *"Video is persistently mounted so it
never reconnects when switching tabs."* The board needs the same treatment — hidden with
`display: none` rather than unmounted.

**Why it is not fixed here.** The change is four lines and reads as obviously right, which is
the most dangerous kind. There is no test that can drive the student's classroom at all: an hour
went into building one and it never reached the board — the class is booked, live, and returned
by both endpoints the screen calls, yet its card does not render for the student. That is worth
understanding on its own, and may be a second bug sitting in front of this one. Shipping an
unverified change to the student's board — the screen this whole product is for — on the
strength of reasoning alone is the exact thing that has gone wrong here before.

**What it needs:** a rig that can get a student into a live classroom, which does not exist yet.
That is the piece of work, and the fix is a few lines once it does.

---

## Reported 2026-08-21 (third run) — still opening a finished class

Reported again after the fix above, with recordings. The fix was live; the app running on the
phone was not.

The recordings are timestamped 10:09:55 to 10:13:12. The API redeploys on push and had picked
up the guard partway through that window — which is visible in the footage: at 10:11:37 a
video room is still handed over and the phone asks for the camera, and by 10:13:12 the same
tap gets "Couldn't set up the video room" instead. The **web app** deployed at 10:13:34, after
the last recording, so every tap in those videos went through the old screens: into the
classroom, LIVE badge, running timer.

**That timing is an explanation and not a defence.** The real fault is that none of it should
have been possible to ship: there was no test that tapped the card a teacher taps. Every test
written for this was a test of a *rule*, and the screen that had to ask the rule was never
touched, so all of them passed against a build that opened a three-day-old class and asked for
the camera.

### What is different now

`artifacts/sikshya/scripts/classroom-tests` signs in as a teacher, opens My Sessions, taps a
class that finished three days ago, and asserts what the teacher sees:

- the classroom is never opened, **not even briefly**
- nothing asks the server for a video room
- nothing asks for the camera or microphone
- no LIVE badge appears
- the screen says the session has expired

Watching every address the app visits rather than where it ends up is deliberate, and it is
what made the difference. The classroom already bounced a finished class back out with an
alert, so "where did the teacher end up" answered *the sessions list* — while the classroom had
mounted, asked for a room and started a call on the way through. Reverting the guards prints
the trail exactly as reported:

```
visited ["/", "/sessions", "/classroom/75", "/", "/"]
requests: [".../api/sessions/75/room"]
```

Which is the report in two lines: in, out to the dashboard, camera prompt on arrival.

## Reported 2026-08-21 (second run) — opening a finished class

G1 was reported fixed and was not. The guard went on the dashboard's Start button, and that is
not how a teacher opens a class. Tapping a card in **My Sessions** pushed straight into the
classroom with no check of any kind, and the classroom asks the server for a video room the
moment it mounts.

**Four separate holes, and the video one was the serious one.**

`GET /sessions/:id/room` never looked at the class's state at all. For a lesson that finished
three days earlier it called `ensureDailyRoom` — which **creates a Daily room** — and minted an
owner token. That is why the phone asked for camera and microphone after backing out to the
dashboard, and the owner's reading of it was exactly right: *"I feel like clicking/tapping in a
completed session activates DailyCo internally somehow and that triggers a call."* It did.
Removing the new guard and re-running the tests reproduces it in one line:
`{"roomUrl":"https://sikshya.daily.co/sikshya35","isOwner":true}` for a class from Tuesday.

The other three:

- **My Sessions had no check.** Any card, any status, straight into the classroom.
- **The classroom asked for the room before it knew what the class was.** `loadRoom()` ran on
  mount, in parallel with loading the session, so the video request went out before anything
  could refuse it.
- **The LIVE badge was hardcoded.** It was drawn unconditionally, so a class that ended on
  Tuesday was labelled LIVE with a running timer. That is the "big disconnect" in the report.

### What it does now

A tap is refused immediately, from the date and length already in the list — no round trip, no
navigation, no room request, no camera. It says **"Session already expired. Please create a new
one."**, and offers to create one.

The server refuses the room on the same window, and that is the control rather than the
courtesy: the room URL and the owner token are the things worth refusing, and a screen that
declines to ask for them is only a good manner. Both use the same three-hour rule, so "may I
start it" and "may I go in" cannot answer differently.

Landing in the classroom anyway — a stale link, a back-stack entry — now shows the expired
screen instead of a classroom, before any video is set up.

Covered by tests that ask the real server for a room on a class aged three days and assert
there is no URL, no token, and that asking did not quietly make the class live. Removing the
guard turns exactly five of them red.

---

## A whiteboard now survives the server restarting

Board state lived only in the classroom hub's memory, so a restart erased it. That was listed
as a known gap and it was quietly worse than it read: **the API redeploys itself on every
push**, so shipping any change during a lesson took its whiteboard with it — silently, with
nothing for the teacher to recover. Every deploy made while someone was teaching was a small
data loss.

Boards are now written down as they change: elements, the pictures they point at, and where
the teacher was looking. Read back once when the first person joins after a restart, and never
again — after that the copy in memory is the truth, so a class that has been running since the
process started is never overwritten by an older one.

Written on a two-second debounce rather than on every change, because a teacher drawing
produces a change every hundred milliseconds and one lesson would otherwise be thousands of
writes for a board nobody is reading. A restart loses at most a stroke or two.

Two hazards that persistence itself creates, both handled and both tested:

- **Clearing has to persist.** Otherwise wiping the board and restarting would bring the whole
  lesson back.
- **Starting a class must not resurrect the last one.** Taking a class live empties the board
  on purpose; without care the next person to join would have the previous lesson read back
  over the top of it.

Pictures are dropped, and the drawing kept, past about 6 MB. A restored board missing a picture
is worse than one that has it — but a board with nothing at all is worse than both.

Checked by restarting the real server between writing and reading, because that is the only
way to tell persistence from a variable that happens to still be in scope. Removing the save
turns five of the seven checks red with exactly the old symptom: no board, no elements, no
picture.

---

## The whiteboard on a slow phone — measured

"WebView board performance on cheap Android is untested" has been on the gaps list since the
board was built, and it is the one aimed squarely at the actual market. It is now measured,
with the processor throttled to roughly a budget Android's speed at a phone's screen size.

| Board contents | Time until a joining student sees it | One new stroke arriving |
|---|---|---|
| 50 things | ~1.2 s | 109 ms |
| 200 things | ~1.1 s | 118 ms |
| 500 things | ~1.6 s | 139 ms |

Pushed harder by hand: 1000 elements paint in 2.5 s, 2000 in 4.4 s, and the board **still
paints within 10 seconds at 25× slowdown** — slower than any phone likely to be in use. On this
evidence the board copes, with room to spare, and there is nothing here to fix.

**Two limits on that, stated because the number on its own would overclaim.** This is a
simulated processor: it slows the main thread and does not reproduce a weak GPU, memory
pressure, thermal throttling, or a phone running four other apps. And the measurement
interfered with itself — polling by screenshot every 500 ms made 12× look like it never
painted, and this was very nearly written up as a performance cliff between 6× and 12×. There
is no cliff. Sampling infrequently and from outside the page showed it painting fine
throughout.

The suite runs on every deploy. Most numbers are reported rather than asserted, because "is
300 ms too slow" is a judgement; it fails only when the board never becomes visible or a single
stroke takes over three seconds, which is breakage rather than slowness.

Still worth doing when a device is to hand: open the board on the cheapest Android you can
find. That remains on the pre-launch checklist at the top of this file.

---

## Open — known, not yet fixed

### A1. No payment provider is integrated, so configuring one stops all bookings

**This entry used to say something else, and it was out of date.** It said enrolling left a
`"pending"` row nobody promoted, so a student could join a paid class for free. That was true
of the old two-step flow and has not been true since booking became one transaction: `/enroll`
is now the same call as `/book`, there is no pending state to be stuck in, and the classroom
door checks a paid enrolment rather than the existence of a row.

That is now tested rather than asserted — `artifacts/api-server/scripts/payment-tests`, run in
**both** modes, in CI. A student who never booked is refused the room; an unsigned or
wrongly-signed provider callback is refused; a correctly signed callback for a booking that
does not exist changes nothing. Forcing the server to approve its own charges while a provider
is configured turns six of those checks red, so they are doing real work.

**What is actually still open** is the other side of the same coin. Payment mode follows what
is configured: no provider means **simulated**, where the server approves charges itself so
the product can be used, and says so in the log every time. Configuring a provider switches to
**gateway** mode permanently — and the eSewa/Khalti branch is not written, so in gateway mode
every booking is declined with "Online payment isn't available yet."

So the position today is:

- **Nobody gets a paid class for free.** The door is sound in both modes.
- **No money is actually being taken.** Bookings in simulated mode approve themselves.
- **Setting `PAYMENT_WEBHOOK_SECRET`, `ESEWA_MERCHANT_ID` or `KHALTI_SECRET_KEY` will stop
  every booking**, because that is what turns the free door off, and nothing has been built to
  replace it. See `.agents/memory/payment-mode-trap.md`.

Taking real money means implementing the gateway branch in `lib/payments.ts` — the redirect to
the provider and the signed callback that settles the booking. The state machine around it,
including the webhook, already exists and is tested.

**Status:** open — and the self-tightening design means it cannot be half-launched by accident

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

---

## Found while building the refund groundwork, 2026-08-22

### F1. Attaching a file to a Customer Support report has never worked — **half fixed**

Two faults in the app, both fixed, and one in the environment, which is not ours to fix.

The app asked `/storage/uploads/request-url` for a URL using `fileName` and no size. The
endpoint requires `name`, `size` and `contentType`, so the request was rejected with a 400
every single time — before any file was read, with nothing shown to the person filing the
report beyond a generic failure. Past that, the app read `uploadUrl` from a response whose
field is `uploadURL`, so even a valid request would have uploaded to `undefined`.

Both are fixed, and the old request shape is now asserted to *fail* in the attendance suite so
it cannot come back quietly.

What is left is not a bug: the upload endpoint is inherited from this app's Replit origins and
depends on `PRIVATE_OBJECT_DIR` and `PUBLIC_OBJECT_SEARCH_PATHS` pointing at a Google Cloud
Storage bucket. Railway has neither. Attachments will keep failing until somewhere to put files
is chosen and configured — a decision, and possibly a cost.

In the meantime a failed upload no longer swallows the complaint: the report is sent without
the file and the person is told plainly that it did not go with them. Evidence is optional on
the server too, because a mandatory attachment on top of an uploader that has never worked is a
complaints box that quietly refuses complaints.

### F2. The teacher was never told when a student booked — **fixed**

A student could book, pay and turn up, and the first the teacher knew of it was finding them in
the room — or never finding out, for a class nobody happened to open. Reported by the owner as
"the teacher does not get any notification when a student registers for the session".

Teachers are now notified when a booking completes, on a preference switch of their own:
somebody who mutes class-starting reminders has not asked to stop hearing that they were paid.

### F3. Every review in the database was written by the app — **fixed**

The server required a comment; the app satisfied that by inventing one. Every review reads
"Great teacher! Rated 4 stars." under a real student's name, whatever that student thought.
Students can write their own now, the box is optional, and no sentence is invented for an empty
one. Existing rows still hold the invented text — worth clearing before launch, since they are
attributed to real people who did not write them.

### F4. Every invitation email linked to a screen that did not exist — **fixed**

`session_invite` emails have always pointed at `/session/:id`. There was no such route, so
every invitation ever sent led to a "not found". The class's own page now lives there.

### F5. The Rec button recorded nothing and said it had — **removed**

In the teacher's classroom, next to End, sat a "Rec" button. It turned red, and on a second tap
it announced "Recording saved to Sikshya cloud." Nothing was captured, nothing was stored, and
there was nowhere for it to go.

That is worse than a missing feature. A teacher could have relied on it in exactly the dispute
this month's work is about — believing they had proof of what happened in a lesson — and found
at the moment it mattered that there had never been anything to produce. So the button is gone
rather than hidden, and the classroom suite now asserts it stays gone.

Real recording is a decision rather than a missing function. Daily can record a call as a paid
feature; doing it would mean paying for storage, asking both people for consent, and holding
video of children. `REFUNDS.md` sets out why it is not the obvious answer, and why the
attendance record covers most of what a dispute actually needs.

---

## The support desk, 2026-08-22

### How an agent account is made

There is no way to become a customer-care agent through the app, and that is deliberate: a
support tool that can create its own operators only has to be breached once. Registration
accepts `teacher` and `student` and refuses anything else.

An agent is made by the owner, directly against the database:

```sql
UPDATE users SET role = 'admin' WHERE email = 'agent@example.com';
```

The account is registered through the app first, like anyone else's, and then promoted. To take
the powers away again, set the role back to `student`. That takes effect on the agent's **next
request** — the role is re-read from the database each time rather than trusted from the token
they signed in with, so a demotion does not wait for a token to expire.

An agent cannot suspend themselves or another agent. Both of those are the owner's decision,
made the same way.

### What an agent can and cannot do

Can: read and close tickets with the evidence attached, suspend and unsuspend accounts, issue
password reset codes, approve or reject teaching credentials, and read the activity log.

Cannot: see or set anybody's password. A reset issues a six-digit code that the agent reads out
and the person redeems to choose their own password; only the code's hash is stored, and the
code is never written to the audit log. The obvious shortcut — an agent typing a temporary
password and reading *that* out — leaves every reset account known to somebody else.

Every action an agent takes is recorded against them in the activity log, on the same terms as
everybody else's.

---

## Moving a class and dropping one, 2026-08-23

### The rules, in one place

`REFUNDS.md` section 2b is the full statement. The short version, for anybody who only needs
the numbers:

- a teacher may move a class up to **48 hours** before it starts, and only to a slot at least
  **48 hours** away
- **five schedule changes a calendar month**, counted per change and not per class
- a "schedule change" is the **date or the time** — everything else stays freely editable
- a student may drop up to **24 hours** before, or within **24 hours** of the teacher moving it
- teacher moved it → **all of it back**; student changed their mind → **half**, with a quarter
  each to the teacher and the platform as a **cancellation fee**
- an agent may grant a full refund for something outside the student's control, with a written
  reason
- a dropped seat goes **back on sale**

**No money moves.** A refund is a debt written into `refunds` and settled by a person, who
records a reference. Every message a student sees says *requested* and names the 5-7 business
days.

### Three bugs found while building it, none of them reported

**H1. A limit of five let seven through.** Counting the month's changes and then inserting one
is two steps, and eight requests arriving together all counted before any of them had inserted.
Found by a concurrency test written before the code was believed. The count that decides now
happens inside the transaction, behind a per-teacher Postgres advisory lock. — **fixed**

**H2. A class size of 0.5 was accepted and quietly became 1.** `Math.round` turned a nonsense
number into a different instruction from the one that was sent, which is worse than refusing it:
the caller believes something happened that did not. Duration, class size and price now require
whole numbers. — **fixed**

**H3. A class ten days away was labelled "Session Expired".** Both buttons on the class page
threw away *which* refusal had happened and printed "expired" for every one of them. This is the
same shape as the two cases reported on 2026-08-21 and 2026-08-22, and it survived the fix for
those, because that fix was about which page opens and this is about what the button on it says.
A student who had just paid for a class next week was told it had expired.

The unit test covering that assertion had asserted `"Session expired"` for a class thirty
minutes from opening — it pinned down the bug rather than the behaviour, which is why a covered
line stayed wrong. The label now names the actual refusal: "Not open yet", "Session held and
ended", "Session cancelled", and "Session expired" only once the door has really shut.
— **fixed**

**H5. Cancelling a class was the way round all of the above.** A teacher could set a class to
`cancelled` with no lock, no monthly allowance, no refund and no notification — the students who
had paid were left with a class that had simply stopped existing. The 48-hour rule for *moving*
a class only means something if calling it off costs at least as much. Cancelling an upcoming
paid class now refunds everybody in full, releases the seats and tells them; cancelling one
already taught refunds nobody automatically, because that is a dispute. — **fixed**

**H6. A booking could land on a class as it was being cancelled.** The cancel handler listed who
had paid and *then* wrote the status; the booking route checked the status before opening its
transaction. A booking committing between those two points was on neither side of the fence —
the student paid, the class stopped existing, and no refund was written because the list of who
had paid was already taken. It needed nothing but bad timing, and with the fix reverted it
happened twelve times out of twelve. Closed at both ends: the booking transaction re-reads the
status under the row lock it already takes, and the cancellation reads who has paid after the
write. — **fixed**

### Still open, narrow, and named rather than quietly left

**A booking that commits in the instant *after* a class is rescheduled is not told it moved.**
The class still exists and the drop quote reads the change record when it is asked, so the money
is right — the student can still take the whole price back within the 24 hours. What they miss is
being told, and the twenty-four hours is no use to somebody who never hears it has started. They
also do not appear in the `affected_students` count on the change record.

The window is milliseconds and closing it properly is not a patch to the cancel or reschedule
handler: it needs the booking to check the slot the student actually agreed to, which means the
app sending the date it displayed and the server refusing a booking against a class that has
moved since. That is a real design change and it is not being made on a guess about how often
this happens.

Everything that *can* be guaranteed is: every student holding a paid place at the moment of the
move is counted and notified, and the equivalent hole on **cancellation** — which was a money
hole, not a notification one — is closed at both ends (H6).

### And one caused by a fix in the same session

**H4. A student who dropped lost the class thread.** Dropping marks the enrolment `refunded`,
and both the thread and the attendance record refused anybody who was not currently paid — so
the record of the class disappeared at exactly the moment it became the thing being argued
about. The thread was fixed first; the class page then still drew a blank, because it decides
whether to show the thread at all from the attendance call, which had not been changed. Both now
allow a refunded student to **read** — the thread's composer is hidden rather than offered and
refused. — **fixed**

### What it is tested with

190 tests across two new suites, both in CI:

- `api-server/scripts/refund-tests` — 145 through real HTTP against a real database, including
  the arithmetic (three shares always summing back to the price, an odd price rounding the
  student's way) and two concurrency runs (six simultaneous drops → one refund and one freed
  seat; eight simultaneous moves → never more than five spent).
- `sikshya/scripts/refund-tests` — 45 through a real browser, reading the figures off the
  rendered page and out of the confirmation dialog, because the number somebody agrees to lose
  is the number on their screen and not the one a component was passed.

Both were proved by deliberately breaking seven things in turn — the advisory lock, the seat
going back on sale, the price lock, the refunded student's thread access, the button label,
the cancellation refund, and the exclusion of classes already taught — and confirming each was
caught by exactly the tests that should catch it and no others.

One of those breaks caught a *test* rather than the code: removing the `alreadyRefunded` lookup
from the cancellation loop changed nothing, because the `payment_status = 'paid'` condition
inside the transaction was already doing all the work. The lookup was removed. A redundant guard
that nothing can distinguish from a working one is worse than none — it invites the belief that
it is doing something.

---

## Reported 2026-08-24 (fifth run) — past-dated classes, and a button that forgot

### J1. A teacher could create a class in the past — **FIXED**

And three of the round's other complaints were downstream of it. The class sat in the Upcoming
list, said "Session Expired" when opened, a student was able to buy it, and the class page then
told them their teacher was **2,279 minutes late** and offered them a refund form — for a lesson
that was never going to happen and that they should never have been sold.

`POST /sessions` refuses a date in the past, with five minutes of grace so that "Create & Go
Live Now" — which sends the current time and takes a moment to arrive — is not rejected by the
teacher's own clock.

### J2. A student could enrol in a class that had already started — **FIXED**

The line is the **start**, not the end. Selling somebody the back half of a lesson already
running is a worse deal than they think they are getting, and it is not something this platform
has been asked to do. If that turns out to cost bookings on live classes, it is one number to
change.

### J3. A class whose time had passed sat under "Upcoming" forever — **FIXED**

The student's list decided which pile a class belonged in from its `status` alone, so a class
nobody had marked finished stayed Upcoming indefinitely. It reads the clock too now, and
re-checks every thirty seconds while the screen is open.

### J4. The Subscribe button was never green — **FIXED**

It went green on the tap and reverted the moment the screen was rebuilt. The server worked out
"do you follow this teacher" from a `?studentId=` **query parameter** carrying the student's
*profile* row id, while `student_teacher_subscriptions` keys on their *users* row id. Two
different numbers, matching only by coincidence.

It now comes from the token, which fixes the bug and closes a leak in the same move: anybody
could previously ask whether any named student followed any named teacher by putting a number in
a URL.

### J5. Tapping a finished class did nothing — **FIXED**

Those cards had no `onPress` at all. Their page is where the messages, the attendance record and
any refund live, and all three are wanted after the class rather than before it.

### J6. A dropped class disappeared from the student's list — **FIXED**

Worst at exactly the moment the money is owed. It comes back under its own **Dropped** heading,
and its page shows the amount, whether it is still owed, and how many business days remain —
counted over weekends rather than divided, because a refund asked for on a Friday is not two days
from landing on a Sunday.

### J7. The Profile "Security" card was invented, top to bottom — **FIXED**

Found while checking which notification channels exist. It claimed:

- **Two-factor authentication: Enabled.** There is none, and there never has been.
- **Password: Last changed 30 days ago.** Read from nothing.
- **Session alerts: SMS + Email.** There is no SMS code in this product at all.

The first is the one that matters. Somebody who believes they have a second factor makes
different decisions about their password, and they would have been wrong. Same fault as the Rec
button that announced "Recording saved to Sikshya cloud" while saving nothing, and the same
treatment: removed, not hidden.

### The warnings before a drop or a schedule change are now in-app panels

The owner asked for "a little bigger and bold" with "simpler word choices". A system confirm box
can be neither — one type size, no emphasis, and on a cheap Android phone a grey strip most
people tap through. Both are panels now: the amount or the new date in the largest type on
screen, consequences as short lines that each start with what happens, and a confirm button that
says "Yes, drop it" rather than "OK".

### What was tested, and what does not exist

`api-server/scripts/alert-tests` fires each event **twenty times** and counts deliveries down a
real socket, because a notification that arrives nineteen times in twenty works every time you
try it by hand and fails for somebody else.

| Channel | State |
|---|---|
| On-screen toast and OS banner | works — 20/20 on every event |
| In-app list and unread badge | works — same socket event feeds both |
| Email | **real, but off** until `RESEND_API_KEY` and `EMAIL_FROM` are set |
| Phone / SMS | **does not exist.** No SMS code has ever been written |

The SMS row is asserted, not just noted: a preference for it inserted directly into the database
is ignored, so no switch can ever appear for something that will never send.

---

## Reported 2026-08-24 (sixth run) — a receipt for a payment that never happened

### K1. The payment sheet announced success before it tried — **FIXED**

The worst thing found in this codebase so far, and worth reading in order. The sheet collected an
MPIN, paused 1.5 seconds, showed **"Payment Successful — NPR 500 paid via eSewa"**, paused
another 0.8 seconds, and *only then* attempted the booking.

So every possible failure — class already started, class full, server down — arrived on somebody
who had just been shown a receipt. On a product where no money moves at all yet, that was the app
inventing one. Reported as "it says 'Payment Successful' and immediately pops 'Booking failed'".

The order is reversed: the booking runs first, the success screen is only reached if it worked,
and a failure is shown on the sheet itself, still open, saying nothing has been charged. The
success screen says **"You're booked"**, because that is the thing that actually happened.

**And the fix was not enough on its own.** The sheet still showed success for a full class,
because the caller started the booking without returning its promise — the sheet awaited
`undefined`, resolved instantly, and the rejection became an unhandled promise nobody saw. Every
server test passed throughout: the 409 was correct and no enrolment was written. Only a browser
driving the real sheet could see the screen saying otherwise.

The teacher's Pro subscription had the same disease: it swallowed the server error and marked the
plan active locally, so a subscription that never reached the server still told the teacher it was
live. Fixed the same way, minimally, since the payment plans are about to be reworked.

### K2. A dropped class kept saying "Booked & paid" — **FIXED**

`isEnrolled` meant "an enrolment row exists", and dropping leaves the row behind marked
`refunded`. That explains the flapping in the report exactly: refreshing sometimes cleared it,
but only because the check had failed and the screen fell back to offering the booking; signing
back in showed "Book" for a moment before it flipped. It means "holds a place" now.

### K3. Every live class on the platform appeared in My Sessions — **FIXED**

A class the student had never booked showed under "Live Now" with a green **Join Live Session**
and no mention of paying. Tapping it reached the video room, which refused it, and reported
"Couldn't set up the video room" — for a class they simply had not bought. Classes to buy belong
in Discover; that screen is the ones they own.

### K4. "Schedule & Go Live" was unsellable, and that was my doing — **FIXED**

The previous round set the booking cutoff at the scheduled **start**, on the instruction that a
student should never enrol in a past class. But the class that prompted that instruction was two
days dead, and the rule also caught one running *right now*: a teacher scheduled a class two
minutes out, went live, and nobody could buy in.

The cutoff is now the moment the student's door shuts — the booked finish plus five minutes — so
a class in progress can still be joined and one that is over cannot. The original complaint is
still covered, and there is a test naming the two-day-old class from that report.

The first attempt at this used `canJoin`, which is false *before* the doors open as well as
after they shut, and made every class more than ten minutes away unbookable. The tests caught it
on the first run.

### K5. The video size control sat on top of Daily's panel close — **FIXED**

It floated at the top-right corner of the video pane, which is exactly where Daily puts the close
button for its Chat and People panels. The two stacked, ours on top, so the panel could not be
closed at all: every press shrank the video and grew the board instead, with no way back to the
call. Reported with the overlap circled.

**The rule now: nothing of ours is drawn over the Daily iframe's corners.** Daily owns that
surface and changes it between versions. The size control lives on our own header, where it
cannot be covered and cannot cover anything, and the five-minute wrap-up banner leaves a gutter
on the right for the same reason.
