# Monthly make-ups use any time inside the current cycle

Owner decision, 29 August 2026.

## The rule

A monthly class still creates one regular class every day at the same local time during one
30 × 24-hour cycle. The delivery floor is still **25 held classes**, and a teacher still has at
most **five make-ups** in that cycle.

The owner clarified that a make-up must not be pinned to an automatic slot. The teacher may
choose **any future date and any time inside the same monthly cycle**. The old teacher screen
did not offer a choice; pressing “Make up” immediately posted a timestamp three days from the
button press. Its comment claimed “the usual time,” but the code actually preserved the current
clock time. Both behaviours were wrong because neither was the teacher's choice.

## Restrictions that remain deliberate

- The replacement must be in the future and strictly before the current cycle ends. The cycle
  end is exclusive, because an instant at the boundary belongs to the next cycle.
- It can replace only a missed regular class from that same cycle, and one miss gets at most one
  active make-up.
- It cannot overlap another class in the recurring course.
- It cannot land during leave the teacher has already declared. Marking leave does not excuse
  the original daily classes; this guard only prevents promising a replacement the teacher has
  already said they cannot attend.
- Five make-ups per cycle and the existing forty-total-class ceiling remain.
- Scheduling clears the absence/abuse mark under the existing rule, but scheduling does **not**
  increase delivery. Only a make-up whose materialised session was actually held contributes
  to `ledger.held` and the 25-class refund floor.

## Implementation shape

- `POST /monthly/classes/:id/makeups` accepts the existing absolute `at` field for compatibility
  and also accepts the teacher UI's `localDate` plus `startMinute`. The server converts the
  latter in the recurring class's own IANA time zone, so a laptop in another country cannot
  shift a Nepal-time class.
- The route enforces the current cycle boundary. `addMakeup` separately verifies that the missed
  row belongs to the current cycle, inside the same transaction that creates the replacement.
- The teacher monthly screen now opens an explicit scheduler with the existing Bikram Sambat /
  Gregorian picker and a 24-hour time field. It shows the exact cycle-end deadline and does not
  write anything until the teacher confirms.

Do not bring back a fixed “three days later” default action, do not let a make-up cross cycles,
and do not count a merely planned replacement as delivery.
