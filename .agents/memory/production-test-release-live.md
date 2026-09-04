# Production test release is live

**Activated 4 Sep 2026.** Release candidate `999fe3b` was fast-forwarded to `main` and deployed to
the normal production addresses:

- web: `https://hometuition.praksh-dhakal.workers.dev/`
- API: `https://workspaceapi-server-production-5a63.up.railway.app`

The GitHub workflow `33889966505` completed successfully. Railway showed the API deployment as
ACTIVE, `/api/healthz` returned `200 {"status":"ok"}`, and the production Worker served the new
`entry-da308df1a79efb1e2a688f67e07be405.js` bundle.

## Production changes made outside Git

The new tables were added to Neon project `orange-credit-19129973`, production branch
`br-dawn-haze-ayvqjc9n`, **before** the API deploy:

- `test_student_grants`
- `test_classes`
- `test_teaching_grants` (added after the first operator record load exposed that it was missing)

No existing table or column was dropped or altered, and no payment record was changed. The first
two tables were created before deploy. The release record initially — and incorrectly — said
`test_teaching_grants` already existed. Opening teacher 719 in the live operator desk returned a
server error; Railway logs identified `relation "test_teaching_grants" does not exist`. The missing
table and its `(teacher_id, valid_until)` index were then created in one Neon transaction. Reloading
the operator record succeeded. This correction is important: do not repeat the old assumption.

Railway production now has both exact kill switches set to `true`:

- `ALLOW_TEST_TEACHING_ACCESS`
- `ALLOW_TEST_STUDENT_ACCESS`

An early attempt used the wrong name `ALLOW_TEST_TEACHER_ACCESS`. It was caught against the source,
deleted, and replaced with `ALLOW_TEST_TEACHING_ACCESS` before the final deployment became active.
The final Variables screen showed only the two correct names.

## What this does and does not enable

This does **not** make the public site free and does not alter the payment provider. The ordinary
student path still reaches the ordinary payment flow. Free testing needs three server-side facts:

1. the teacher has an operator-granted, live test-teaching grant;
2. the class was created while that grant was live and is recorded in `test_classes`;
3. the student has an operator-granted, live test-student grant.

Grant through the production operator page, never by direct SQL. The API routes verify email,
approval/onboarding and suspension state, close prior live grants, record operator activity and send
an in-app notification. A direct insert would miss those guarantees and the activity record.

Before public launch, switch both Railway variables off. Existing grant rows should remain as the
audit trail; with the switches off they buy nothing.

## Live production test accounts

The owner selected these accounts, and both grants were applied through the production operator
desk (not SQL) with the reason `Owner-authorized production classroom and whiteboard verification`:

- teacher `praksh.temp@gmail.com` (user 719): base allowance, active until 11 Sep 2026 at 1:30 PM;
- student `student@sikshya.np` (user 706): test booking access, active until 11 Sep 2026 at 1:38 PM.

The first student grant was correctly refused because this old seeded account had no
`user_onboarding` row. The account already had extensive legitimate test activity, but the new rule
does not let a grant skip onboarding. The known seed account signed in through `/auth/login`, then
completed `/onboarding/me` through the supported application API with explicitly synthetic test
details (adult test DOB, non-routable-looking test phone, Bagmati/Kathmandu/Kathmandu and
`Sikshya production test account`). The retry through the operator desk succeeded and is visible as
an active seven-day grant. No password was changed and no eligibility check was bypassed.

## Remaining human verification

Automated browser tests used Daily-compatible scaffolding but did not measure a real two-device
Daily call. The grants are ready. The owner should sign in as the teacher, create a new class while
the teacher grant is live, then sign in as the student and choose the no-payment test-place action
on that newly created class. Both devices can then join the real Daily room near its scheduled time.
