# Profile account details and refund contact

Status: approved product backlog, not part of the class-home deployment.

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

