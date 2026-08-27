# Cross-agent work logs

## Owner decision — 27 August 2026

The owner moves this project between Claude Code and Codex and wants either agent to be able to
continue without reconstructing the previous agent's chat.

Every task therefore gets a Markdown entry in `.agents/worklog/`. The entry is part of the work,
not optional housekeeping, and must say:

- what the owner asked for and the branch/base commit used;
- which files changed and why;
- decisions and assumptions, especially anything visible to a user;
- what was deliberately not changed and why;
- every verification command actually run and its result;
- failures, unavailable tools, surprises, and workarounds;
- unresolved risks and the exact next action for whoever picks it up.

Update the entry while working. Do not rewrite a failed attempt into a clean retrospective: the
failure is often the part the next agent needs. Never put secrets, tokens, one-time login codes,
or private user data in a work log.

The directory's `README.md` owns the filename and entry format. Product decisions still belong
in their own memory note and the memory index; a work log records that the decision was applied,
but does not replace the durable decision note.
