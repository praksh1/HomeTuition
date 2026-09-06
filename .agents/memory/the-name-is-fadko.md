# The name is Fadko, and the rename is finished

**Owner decision, 6 September 2026.** The product is **Fadko**. The line under it is
**"Tuition from Home"**.

This is the third and final name. It replaced **Sikshya**, which replaced **Guru** — the name
the project was generated under, which survived for months wherever the machine looked rather
than the user: the browser tab, and the label under the icon when a student added the site to
an Android home screen.

Earlier drafts of `HANDOVER.md` predicted one more rename, to "GharTuition" or "TuitionGhar".
**That question is closed.** Do not raise it, and do not treat the old prediction as live if you
find it quoted somewhere this note missed.

## What carries the name

Everywhere a person can see it: the interface, `app.json` (name, slug, scheme, web name and
short name), every email and account notice the server sends, the support signature
("Fadko Support"), the operator case narratives, and the refusal messages.

## What deliberately still says "sikshya", and why

The rename was done by replacing the **capital-S** word only. That was not laziness — it is
what makes the change safe, because every remaining use is lowercase and every one of them is
plumbing that a rename would break rather than improve:

| Still `sikshya` | Why it stays |
|---|---|
| `artifacts/sikshya/` and `@workspace/sikshya` | The workspace folder and package. Renaming touches every script, every workflow, every tsconfig path and the Cloudflare build config, for something no user sees. The same call the project already made for the repository name. |
| `sikshya<id>` — the provider room name | **The load-bearing one.** `lib/sessionProof/providerEvents.ts` parses `/^sikshya(\d+)$/` to tie a provider's attendance events back to a class. Change it and every meeting recorded under the old name correlates to nothing, and the evidence behind a refund argument goes quiet. It also lives in `lib/daily.ts`, which is deliberately frozen during the LiveKit trial. |
| `@sikshya_token` — the login storage key | Invisible. Changing it signs every existing session out to rename something nobody reads. |
| `student@sikshya.np`, `teacher1@sikshya.np` | Seeded demo logins, documented in `LOCAL_SETUP.md` and used for the LiveKit two-person test. Changing them without re-seeding would give the owner a login that does not work, at the moment they are following a checklist. |
| The local `DATABASE_URL` database name | On the owner's own machine. Changing it in `.env.example` would break a working local setup for nothing. |

`HomeTuition` likewise stays as the **repository** and **Cloudflare Worker** name.

## What must not be swept up

`artifacts/api-server/src/data/nepalEducationFacilities.json` contains **38 real Nepali school
names** with "Sikshya" in them — *Sikshya Deep English Boarding School*, *Bal Sikshya Sadan*,
*Ratna Sikshya Sadan*. They are other people's institutions, not this product. A
case-insensitive find-and-replace would have renamed 38 schools.

`.agents/worklog/` and `.agents/memory/` were left alone as well. They are a record of what was
true when written; rewriting them would make the history lie.

## The bundle identifier changed too

`com.sikshya.app` → **`com.fadko.app`**, on both platforms.

This was free to do now and would have been permanent after the first store publish, so it had
to happen with the rename rather than after it. Two consequences:

- **A debug build installed before this change will not be replaced.** Android treats a
  different package as a different app, so a new build installs *alongside* the old one.
  Uninstall the old "Sikshya" app from the phone first, or you will be testing whichever of the
  two you happen to tap. This is the same trap the `com.guru.app` → `com.sikshya.app` rename
  set, recorded then and hit again.
- It is now on the pre-launch checklist as **settled**, not open.

## Still open

The **Devanagari** wordmark. The welcome screen carries `शिक्षा • ज्ञान • समृद्धि`
(education • knowledge • prosperity) as a values line. It was left as it stands because it is a
statement of values rather than the name — but its first word is the *old* name, and if the
owner wants "फड्को" written anywhere, they have to supply the spelling. Do not invent Nepali
branding for them.
