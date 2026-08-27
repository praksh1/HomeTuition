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

## Deliberately not changed

## Remaining risks / next pickup point
```

Be concrete. List exact files and commands, distinguish a passing automated check from a screen
that was actually rendered, and record a failure even when a workaround later succeeds. Do not
include secrets, access tokens, one-time login codes, or private user data.

Work logs complement the durable project documents:

- owner decisions still get a focused note in `.agents/memory/` and an index entry;
- live unfinished product work still belongs in `.agents/backlog/`;
- `HANDOVER.md` remains the whole-project summary rather than a commit diary.
