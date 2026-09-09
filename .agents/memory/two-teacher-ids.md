# A teacher has two ids, and mixing them up gives a 404

**Rule.** A teacher is stored in `users` (their account) and in `teacher_profiles` (their
teaching side). Both tables have their own `serial` primary key, so every teacher has *two* ids
that are almost never the same number.

- `users.id` is the "user id". `sessions.teacher_id`, `student_teacher_subscriptions.teacher_id`,
  the classroom-socket identity, JWT `userId`, notification recipient — every relation the app
  has to "who the teacher is as an account" keys on this one.
- `teacher_profiles.id` is the "profile id". The public teacher page's route
  `/(student)/teacher/[id]` and the `GET /api/teachers/:id` lookup key on this one.

**How it goes wrong.** A public list that joins through `sessions` naturally has the user id
in hand. Handing that to the teacher page as `/teacher/{userId}` produces a 404, because
`GET /teachers/:id` looks up by profile id. That is exactly what the initial Classes-tab
routing did.

**The fix.** When a response wants the caller to open the teacher page, include the profile id
too — even when the user id is right there for follow / subscribe / socket use. Public listings
should return both under distinct names (`teacherUserId`, `teacherProfileId`) so no caller has
to guess which one is which. The `GET /public/classes` route does this since
Phase 2B correction round 2 (8 Sep 2026).

**Where to look.**

- `artifacts/api-server/src/routes/sessions.ts` — the `GET /public/classes` route selects both
  `teacherId` (aliased `teacherUserId`) and `teacherProfilesTable.id` (aliased `teacherProfileId`).
- `artifacts/sikshya/utils/publicClasses.ts` — `PublicClass` carries both; the card exposes only
  `teacherProfileId` because the tap opens the teacher page.
- `artifacts/sikshya/app/(student)/index.tsx` → `openClassOnTeacherPage()` routes on the
  profile id, with a comment naming the reason.

If a new public listing joins `sessions` and only surfaces the user id, a stranger tapping a
card will get a 404 that looks like the class was withdrawn.
