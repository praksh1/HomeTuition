# A cited curriculum or exam board is disclosed the same way, whatever its source

**Rule.** When a Learning Program cites a reference — a curriculum name, an exam board, a text —
the details page shows the name verbatim and adds the same non-endorsement sentence for every
value of `referenceSource`:

> "This is the curriculum or reference named in the program. Fadko has not independently
> verified or endorsed it."

**Why.** The database enum has three values (`official`, `teacher_supplied`, `none`) but Fadko
has no endorsement or verification process. Two shortcuts were rejected:

- **Calling every citation "teacher supplied"** — including citations the enum marked `official`.
  A false provenance claim: it tells the student a teacher wrote something the platform
  actually recorded as coming from an authoritative source.
- **Calling an `official` reference "official"** — the app would be claiming a review process
  that does not exist.

The neutral wording is honest for all three cases and stays honest once such a process exists
(the sentence can be tightened then, and only then).

**Where enforced.** `artifacts/sikshya/utils/programDiscovery.ts` → `referenceBlock()`. Test
coverage in `programDiscovery.test.ts` (both `teacher_supplied` and `official` receive the same
sentence) and in the rendered `scripts/program-discover/run.mjs` (details page renders it at
both source values). The `ProgramView` doc-comment says the same.

**History.** Original Phase 2B commit said "The teacher supplied this citation. Fadko does not
check or endorse the curriculum, exam board, or book." for every source. Codex correction round
1, item 6 — 8 Sep 2026 — rejected that as false provenance; the neutral form is what shipped
in the correction round.
