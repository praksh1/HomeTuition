# Testing a real class on the live site, without giving anyone else a free ride

Written for the owner. Every step says which site, which button, and what you should see.

---

## What this actually does

You need to do the whole thing on the real site — create a class, book it, sit in the classroom
with the video and the whiteboard running. The real site is also taking real money from real
students at the same time.

So there are **two temporary permissions**, both given by a support agent to one named account,
both with an end date, and both switched off unless the server says otherwise:

| | What it lets that one account do |
|---|---|
| **Test teaching access** | Create classes without paying for a teaching plan. |
| **Test booking access** | Book *those* classes without paying. |

**Everyone else still pays, for everything.** A student with test booking access who books an
ordinary teacher's class pays the full price. A student without it who finds one of your test
classes pays the full price. The only thing that is free is your test student booking your test
teacher's class.

Nothing you do in a test class is counted as money. It never appears as earnings, it never
becomes a refund somebody owes, and no receipt is created.

### Two labels, and they mean different things

This matters, because the app is careful about it and you will see both:

| What you see | What it means | Who sees it |
|---|---|---|
| **TEST-ENABLED CLASS — only approved test bookings bypass payment** | This class was created under test teaching access, so an approved test booking *may* take a place in it for nothing. It does **not** mean the class is free. | The teacher who created it, on their own class list and in their classroom. |
| **TEST — no payment was processed** | *This particular person* took their place with test booking access, and no money changed hands for it. | Only the person it is true of, on their own class card and in their classroom. |

A student who genuinely pays for a seat in a test class sees **neither** — they see the ordinary
price and the ordinary payment screen, because for them it is an ordinary paid class.

---

## Step 0 — before anything, once

Two settings have to be switched on for the server. **This is the only step that needs Railway.**

1. Go to **https://railway.app** and sign in.
2. Click your **HomeTuition** project.
3. Click the **api-server** service (the box with the API in it).
4. Click the **Variables** tab along the top.
5. Click **+ New Variable**. In the name box type:

   ```
   ALLOW_TEST_TEACHING_ACCESS
   ```

   In the value box type:

   ```
   true
   ```

   Click **Add**.
6. Click **+ New Variable** again. Name:

   ```
   ALLOW_TEST_STUDENT_ACCESS
   ```

   Value:

   ```
   true
   ```

   Click **Add**.
7. Railway will say the service is redeploying. Wait until the status goes back to **Active** —
   usually under two minutes.

**What you should see afterwards:** nothing changes for anybody. These two switches do not give
anybody anything on their own. They only mean that *if* an agent grants a named account test
access, that grant will work. Until an agent does, nothing has changed.

> **When you are finished testing, come back and delete both variables** (hover the variable,
> click the **⋮** menu, choose **Delete**). That closes every outstanding grant at once — you do
> not have to go and find them. It is also on the pre-launch checklist in `ISSUES.md`.

---

## Step 1 — give your test teacher permission to create classes

You need an agent account for this. If you do not have one, `ISSUES.md` explains how one is made.

1. Go to your site and add **/desk** to the address — so `https://yoursite.com/desk`.
2. Sign in with your **agent** account.
3. Click **People**.
4. Find the teacher account you want to test with and click it.

   The teacher must already be **approved** and have a **verified email**. Test access does not
   skip either of those — if the account is still pending, approve it on this same screen first.
5. Scroll to the box headed **Test teaching access**.
6. In the text box, type why. Something like `Owner testing the live classroom, September`. It is
   required, and it is what you will read in six months when you wonder who did this.
7. Click **Give 7 days of test access (Base allowance)**.

**What you should see:** the box changes to say **Active until** with a date and time about a week
away, your reason underneath it, and a red **End test access now** button.

---

## Step 2 — give your test student permission to book

Still on the desk, still signed in as the agent.

1. Click **People**.
2. Find the **student** account you want to test with and click it.

   The student must have a **verified email**, have **finished onboarding**, and not be suspended.
   If any of those is missing you will be told which one, and no grant is created.
3. Scroll to the box headed **Test booking access**.
4. Type a reason — `Owner testing the live classroom, September` again is fine.
5. Click **Give 7 days of test booking access**.

**What you should see:** the box changes to **Active until** with a date about a week away, your
reason, and a red **End test booking access now** button.

---

## Step 3 — create the class, as the teacher

1. Sign out of the desk, or open a **private / incognito window** so you can be two people at once.
2. Sign in as the **teacher** account.
3. Create a class exactly as you normally would — subject, topic, date, time, price.

   Put a real price on it. The price is what everybody else would pay; it is not what your test
   student pays.

**What you should see:** the class is created and appears in the teacher's list. Nothing looks
different — the class being a test class is recorded, not advertised on this screen.

---

## Step 4 — book it, as the student

1. In another window, sign in as the **student** account.
2. Open the teacher's profile, find the class, and press the button under it.

**What you should see, in this order:**

1. On the teacher's profile, the button under the class does **not** say "Book & pay NPR 500". It
   says **"Take a test place — no payment"**.
2. Pressing it books immediately. **No payment screen appears at all** — you are never asked to
   choose eSewa or Khalti, and never asked for a phone number or a PIN. Nothing is sent that could
   be mistaken for a payment.
3. A confirmation appears reading **"You're in — no payment was taken"**.
4. The class then appears under **My Sessions** with an orange label reading
   **TEST — NO PAYMENT WAS PROCESSED** underneath the price.

If the button says "Book & pay" and a payment screen opens, one of three things is true: the
switch in step 0 is not set, this student's grant has expired or been ended, or this class was not
created by a teacher who had test teaching access at the time. All three are working as intended —
the app is telling you that this booking is a real one.

---

## Step 5 — the class itself

1. As the teacher, start the class when the time comes.
2. As the student, join it.

**What you should see:** the real classroom — the real Daily video, the real whiteboard, the real
chat. At the top of each screen, under the class name, an orange strip that says the thing that is
true for whoever is reading it:

- the **student** sees **TEST — NO PAYMENT WAS PROCESSED**, because that is true of their place;
- the **teacher** sees **TEST-ENABLED CLASS — ONLY APPROVED TEST BOOKINGS BYPASS PAYMENT**,
  because that is true of the class they are running.

This is the actual product. Nothing about the video, the board, the chat, the attendance record or
the clock behaves differently in a test class. Your test student appears on the teacher's list of
who is coming and in the attendance record, and a message the teacher writes in the class's own
thread reaches them like anybody else's.

---

## Step 6 — when you are finished

Two things, in this order:

1. **End the grants** (optional but tidy). On the desk, open each account and click **End test
   access now** / **End test booking access now**.
2. **Delete the two Railway variables** from step 0. This is the one that matters, and it does the
   job on its own: with the switches off, no grant works, whatever the table says.

Any test classes and test bookings you created stay where they are. They keep their labels, they
are still not revenue, and nobody can claim a refund against them. The student simply cannot open
them any more — which is right, because the permission that let them in has ended.

---

## If something does not look like this

- **"Switched off on this server"** in the grant box → step 0 was not done, or Railway has not
  finished redeploying. Check the service is **Active**.
- **The grant button is not there at all** → you are looking at the wrong kind of account.
  *Test teaching access* only appears on a teacher; *Test booking access* only appears on a
  student.
- **"This student has not verified their email" / "has not finished onboarding" / "This account is
  suspended"** → exactly what it says. Test access deliberately does not skip any of those; fix
  the underlying thing first.
- **The button says "Book & pay", or a payment screen opens** → see step 4 above. The app is
  telling you this booking is a real one, and it is right to charge for it.
- **No orange label anywhere** → the booking was a normal paid one. That is safe, but it means the
  class was not a test class; check the teacher had test teaching access *before* they created it.
  A class is marked when it is made, and giving the teacher access afterwards does not change a
  class that already exists.
- **A student who paid sees no label at all** → correct, and deliberate. For them it is an
  ordinary paid class, and the app does not put the word "test" next to their money.
