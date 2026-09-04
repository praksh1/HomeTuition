# Live test script — production, `main` 999fe3b

For the owner and whoever is helping. Run top to bottom; each step says what you should see and
what it means if you see something else.

**Before you start, have ready:** the agent (operator) sign-in, the exact **teacher** email and the
exact **student** email you want to use, a laptop, and a phone (iPhone or Android).

> The teacher and student accounts are **yours to name**. Nothing in this script guesses an
> account, and no grant is ever made by editing the database — every grant goes through the
> operator screen, which checks eligibility, ends any previous grant, writes the activity record
> and notifies the person.

Addresses:

- website — `https://hometuition.praksh-dhakal.workers.dev/`
- operator desk — the same site with **/desk** on the end

---

## 1 · Operator grants the teacher

1. Open **/desk**, sign in as the **agent**.
2. **People** → find the teacher by email → open them.
3. Check the top of the record: it must say **Email verified**, and credentials **approved**. If
   either is missing, fix that first — test access does not skip either one.
4. Box **Test teaching access** → type a reason (e.g. `Owner live test, 4 Sep`) →
   **Give 7 days of test access (Base allowance)**.

**Expect:** the box turns into **Active until <date>**, your reason underneath, and a red
**End test access now** button.

**If it says "Switched off on this server"** the Railway variable is missing — stop and say so.

---

## 2 · Teacher creates the class

1. Another browser (or private window) → sign in as the **teacher**.
2. Create a class as normal. **Put a real price on it** — that is what everybody else pays.
3. Go to the teacher's **Sessions** list.

**Expect:** under the class, an amber strip:
**TEST-ENABLED CLASS — ONLY APPROVED TEST BOOKINGS BYPASS PAYMENT**

That marker is written the moment the class is created. Granting the teacher access *after*
creating a class does not change that class — make the class after step 1.

---

## 3 · Operator grants the student

1. Back on **/desk** as the agent → **People** → the student by email.
2. Box **Test booking access** → reason → **Give 7 days of test booking access**.

**Expect:** **Active until <date>** and a red **End test booking access now**.

**If refused,** the message names the reason — unverified email, onboarding not finished, or
suspended. Fix that; do not work around it.

---

## 4 · Student books, with no payment form

1. Third window → sign in as the **student**.
2. Open the **teacher's profile** → **Upcoming** tab → find the class.

**Expect, in order:**

| | What you should see |
|---|---|
| the button | **Take a test place — no payment** (not "Book & pay NPR …") |
| pressing it | **no payment screen at all** — no eSewa/Khalti choice, no phone number, no PIN |
| confirmation | **You're in — no payment was taken** |
| My Sessions | the class, with **TEST — NO PAYMENT WAS PROCESSED** under the price |

**If the button says "Book & pay" and a payment screen opens**, one of the three gates is not
met — the Railway switch, the student's grant, or the class not being test-marked. That is the
system working; do not force it.

---

## 5 · Both join the real Daily room

Teacher on the **laptop**, student on the **phone**.

1. Teacher: open the class and start it.
2. Student: join from **My Sessions**.

**Expect** the top strip to say the thing that is true for each reader:

- student: **TEST — NO PAYMENT WAS PROCESSED**
- teacher: **TEST-ENABLED CLASS — ONLY APPROVED TEST BOOKINGS BYPASS PAYMENT**

---

## 6 · What to actually check in the call

Tick these off. This is the part no automated test has done — everything below is a real Daily
call on real hardware and has never been measured.

**Video and audio**

- [ ] Teacher sees the student's video; student sees the teacher's.
- [ ] Audio both ways, no echo when both are in the same room with headphones off.
- [ ] Mute / unmute and camera on / off work on both.

**The call window** (the buttons at the top of the video panel)

- [ ] **Minus** — from any size, the window snaps to a **small preview in the bottom-right**.
      From the small preview the only button is **Restore**.
- [ ] **Restore** — gives back the working-size window.
- [ ] **Maximise** — fills the screen; press again and it returns to the previous size.
- [ ] **Hide** (the HUD button) — the call keeps running, the board gets the whole screen, and a
      **Show call** button appears. Pressing it brings back the size you hid.
- [ ] Drag the window by its grip; it stays on screen and never covers the board's own toolbars.
- [ ] **Rotate the phone** while the call is up — the window stays on screen.
- [ ] Through all of that, **the video never reconnects** — no black flash, no re-joining.

**Whiteboard**

- [ ] Teacher draws; the student sees it within a second or so.
- [ ] Student draws; the teacher sees it.
- [ ] Erase — the erasure reaches the other side.
- [ ] Explicit shape tools (line, arrow, rectangle, ellipse) still make those shapes.
- [ ] **Handwriting stays handwriting** — write an `A` and a rough circle; nothing should be
      silently replaced by a shape. (Automatic conversion is off; this is the check that it is.)
- [ ] Teacher moves the view; the student's view follows.
- [ ] Zoom and the toolbar are usable at phone width — nothing off the left edge.

**Screen share**

- [ ] Teacher shares a screen; the student can read it, especially in full-screen.

**Chat and attachments**

- [ ] Student sends a message while the teacher is on the board → the teacher gets an unread mark.
- [ ] Teacher sends one back; the student's phone shows it.
- [ ] Teacher puts an **image** on the board — it appears for the student.
- [ ] Teacher puts a **PDF** on the board from the phone — it appears, or fails with a message.
      *(A large PDF over the phone bridge has never been tested; ~1 MB is the biggest proven.)*

**Leaving**

- [ ] Student leaves and rejoins — they get back in.
- [ ] Teacher ends the class — the student is returned out of the room, not left staring at a
      frozen video.
- [ ] After it ends, reopening the class does **not** ask for camera or microphone.

**Money, at the end**

- [ ] The teacher's earnings show **nothing** from this class.
- [ ] The class's record lists the student as having attended.
- [ ] No refund is owed anywhere for it.

---

## 7 · When you are finished

1. On **/desk**, end both grants (**End test access now**, **End test booking access now**).
2. On Railway, delete **ALLOW_TEST_TEACHING_ACCESS** and **ALLOW_TEST_STUDENT_ACCESS**.

Deleting the two variables is the one that matters — with them gone no grant works, whatever the
table says. **Leave the grant rows in the database**; they are the record of who could act for
free and who said so.
