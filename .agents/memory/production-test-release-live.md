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

No existing table, column, row or payment record was changed. `test_teaching_grants` already
existed.

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

## Remaining human verification

Automated browser tests used Daily-compatible scaffolding but did not measure a real two-device
Daily call. The owner must still grant one approved teacher and one verified/onboarded student,
create a test-marked class on the live site, book it with the granted student, and join from the
laptop and phones. That is the point of this release.
