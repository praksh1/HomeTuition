# Production review: teacher studio and support

This checklist describes application commit **ca3b05c**, verified live in Production on **24 September at 08:38 UTC**. Refresh Production once to load the new web build. Do not change a student's existing paid timetable to test an edge case.

## Quick teacher check

1. Open **My classes**. Search by a class name, try Published/Drafts/Closed, and clear the filter. A class with several date sets should take one grouped card; expand it only when needed. On a laptop the action sits beside the details rather than stretching across the whole card.
2. Compare Dashboard **Upcoming** with the beginning of **Schedule → Upcoming**. Both should start with the nearest remaining lesson, including one still within its start window. Past unstarted lessons belong in History, not at the head of Upcoming. Live lessons retain their separate Live view.
3. Open **Create a class**. It should be fresh, not step four of an old class. Choose English, Nepali, Both, or Other. Other needs the language written out.
4. On the timetable step choose dates, then **Check timetable availability**. If more than one lesson overlaps, all affected lesson numbers should be listed. Edit their dates/times in that same screen and recheck; no trip through pricing/publishing is needed. Another class may be linked for editing only when ownership and its paid-booking state permit it.
5. In pricing, make an explicit joining choice. Ongoing tuition can allow joining for remaining lessons. Fixed courses retain their existing start-time joining cutoff. There is no silent extension of that policy.
6. Before publishing, read the student-facing description, language, capacity, exact lessons and total price in the confirmation. Cancel closes the confirmation without publishing. Confirm is the actual publish action; do not confirm merely to test the dialog.

## Simulated booking check

- Use only classes explicitly displaying simulated checkout/no money collected. This release does not activate real payments.
- A confirmed enrollment should remain visible after reopening the class. A failed refresh should not erase a confirmed receipt.
- If the teacher changes an unbooked offer after a student obtained a quote, the student must review the new quote and confirm again. The app must not silently accept a new price.
- A lost confirmation response triggers a status read, not a second checkout. A status that cannot be verified must say so; it must never manufacture a success receipt.
- Do not disconnect a real class or alter a live payment record to test this. Network loss, duplicate requests, capacity races and post-commit failures are covered by isolated API/browser tests.

## Support check

Open **Profile → Fadko Support**. The panel identifies itself as automated assistance, offers topic choices and human help, and can retain the chosen own lesson context. Human handoff should carry checked records, the user's report and missing evidence separately.

The starter Help Library guides remain private drafts until reviewed and published by an operator. No new free-provider account or paid fallback was activated. Vision/recording analysis and fully autonomous technical diagnosis are not implemented by this release. Refunds and account restrictions remain human decisions.

## If something fails

Record the class name, which account role was used, approximate Nepal time, exact message and whether refreshing changed it. A screenshot is useful; passwords, login codes and payment credentials are not. Avoid repeatedly clicking checkout while its status is unknown.

Still queued: the four earlier classroom follow-ups, make-up policy/implementation and teacher-reviewed document-to-quiz import. See the teacher-studio backlog and remedy proposal; none is silently advertised as complete.
