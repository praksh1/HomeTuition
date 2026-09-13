# Profile account details and refund contact

Status: implemented on `codex/profile-account-details`; awaiting preview verification.

## Account details

- Teacher and student Profile pages need an **Account details** section with a clear Edit action.
- Every account must have a login email address and a phone number. Existing users need a gentle completion journey; do not suddenly block sign-in.
- Email changes must use the authentication flow and require verification before the new address becomes authoritative.
- Province and district must come from Fadko's canonical Nepal lists. Do not accept an invented province or district.
- Municipality should use the canonical list where available, with **My municipality is not listed** and a manual value as a reviewed fallback.
- School/institution should use the education-facility list where available, with both **Not applicable / independent** and **My school is not listed**. A manual school value must remain clearly distinguished from a listed institution.
- Keep the choices short and understandable on a low-cost phone. Do not present all of Nepal in one enormous picker.

## Refund contact promise

- A student requesting a refund must be told: **Any approved refund returns to the original payment method.**
- If the payment method or account details have changed, the student must contact Fadko Support.
- An agent may help investigate, but must not casually redirect a refund to a different person or destination.
- The refund journey should display the class, original payment reference, amount under review, and contact path without exposing internal platform earnings.

## Work still requiring design

- Canonical municipality dataset and how it is maintained.
- Phone format, verification, and Nepal/international number support.
- Progressive enforcement date for existing accounts.
- Agent review rules for manually entered municipalities and institutions.

## Implemented in the first safe slice

- Both Profile pages use one Account details card with a clear Edit/Add details action.
- Login email is shown but remains protected; it cannot be silently replaced without a future verified-email-change flow.
- Phone, Province, District, Municipality/local level, locality and school/affiliation are editable through the existing private onboarding record.
- Province and District are now validated against the canonical Nepal hierarchy on the server.
- Municipality and school have explicit not-listed/manual choices; teachers may choose Independent teacher and students may choose Not applicable.
- Existing legacy accounts remain usable and receive a gentle Needs your attention prompt instead of a new login block.
- The refund-request screen states that an approved refund returns to the original payment method and directs changed-account cases to Support.
