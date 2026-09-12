# Public share history and bookability

Owner verification on 12 September 2026 established two rules for links shared outside Fadko.

- The Fadko logo is a normal forward navigation to `/welcome`, not a replacement. Replacing the
  class/teacher URL destroys the browser-history entry and makes Back unable to return to the link
  somebody pasted into an incognito window.
- A public class page also has an explicit `Back to <teacher>` control. Browser history is not a
  sufficient product control for a visitor who moved Teacher → Class from a direct shared link.

A published class description is not automatically bookable. `GET /programs/:id/batches` returns
`availability: open | closed | not_scheduled` alongside only the immutable offers whose enrollment
window remains open. Show sign-in/account actions only for an open offer. A closed offer says its
booking time ended; an unscheduled one says dates and price were not opened. Never show a checkout
door that the booking endpoint must refuse, and never call a closed schedule "not published".

Implementation: public teacher/program routes, `ProgramView.tsx`, and `programBatches.ts`. The
rendered Discover suite covers both empty reasons and the explicit teacher return.
