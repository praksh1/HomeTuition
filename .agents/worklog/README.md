# Cross-agent work log

One entry per task, named `YYYY-MM-DD-agent-short-description.md`. Use `codex`, `claude`, or the
human author's name for `agent`. If a task spans days, keep updating its original entry.

Each entry must contain these headings:

```md
# Short task name

- Date:
- Agent:
- Branch:
- Base commit:
- Status: in progress | complete | blocked

## Requested

## Changed

## Decisions and assumptions

## Verification

## Problems and surprises

## Fabrications found

## Deliberately not changed

## Remaining risks / next pickup point
```

Be concrete. List exact files and commands, distinguish a passing automated check from a screen
that was actually rendered, and record a failure even when a workaround later succeeds. Do not
include secrets, access tokens, one-time login codes, or private user data.

**Fabrications found** is its own heading because it is this project's most repeated defect, not
because every task will have one. Sixteen have been found so far — a dashboard reporting "NPR 0k
earned" forever from a column written once at registration, a subscription screen showing three
invented payments, a storefront calling every teacher "Available" from a field nothing writes.
Write "none found" when that is the answer; an empty heading reads as "did not look". The running
table lives in `.agents/backlog/ui-upgrade-progress.md` — add the row there too.

A question that only the owner can answer does not belong in a work log, where it will be read
once and buried. Put it in `HANDOVER.md` §8, which exists for exactly that and is where he looks.

Work logs complement the durable project documents:

- owner decisions still get a focused note in `.agents/memory/` and an index entry;
- live unfinished product work still belongs in `.agents/backlog/`;
- `HANDOVER.md` remains the whole-project summary rather than a commit diary.
