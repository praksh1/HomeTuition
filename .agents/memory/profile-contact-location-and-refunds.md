# Profile contact, location and refund destination — owner decision (2026-09-12)

Teachers and students will be able to edit Account details from Profile. Email and phone are required account contacts. Province and district must be selected from valid Nepal data; municipality and school use canonical choices plus explicit not-listed/manual fallbacks, and school also supports not applicable/independent.

Approved refunds return to the original payment method. A changed payment method or account detail does not silently redirect money; the student is told to contact Fadko Support.

This decision is tracked for implementation in `.agents/backlog/2026-09-12-profile-account-details-and-refund-contact.md`. It is intentionally separate from the current class-group home release.

## Premium interaction decision (2026-09-14)

Profile is the private account home, not a collection of explanatory cards. Both roles share one identity hero, a compact Account details card and descriptive action rows. Student Profile does not show a dead “No saved payment method” panel. Teacher credential forms stay collapsed behind a truthful status summary until the teacher chooses to manage them.

Nepal Province, District and Municipality choices open in a bounded searchable sheet. They must never expand dozens of options inline and make the account page several screens longer. The cascade remains Province → District → Municipality, with official Province/District values enforced on the server and the approved manual Municipality/school fallbacks preserved.
