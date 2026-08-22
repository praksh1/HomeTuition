# Restarting the API in CI

Two suites restart the API mid-run to prove something survives it: `board-persistence` and
`thread-tests`. Both take a `RESTART_CMD`.

**Kill it by its recorded id, never with `pkill -f`.** The start step writes `$!` to
`/tmp/api.pid` and the restart script kills that. `pkill -f 'artifacts/api-server/dist/index.mjs'`
matches *any* process whose command line contains that string — including the shell running a
script that merely mentions it. In this container that shell is the agent's own, and the tool
call dies with exit 144 before printing anything. It is the same trap as
`.agents/memory/` already records for local use; CI is not exempt.

**Wait for the port, do not sleep a second and hope.** A replacement that dies instantly with
`EADDRINUSE` looks identical to one that never started: thirty seconds of a health loop and no
explanation.

**Never run the restart with `stdio: "ignore"`.** The thread suite did, and when the restart
failed in CI it threw away the one thing that would have said why — the script prints the API's
log before giving up, and none of it reached the run. It captures and prints the output now.

**And `cd` to the repo root first.** `pnpm --filter` runs the test with its working directory
set to the *package*, so a relative `node artifacts/api-server/dist/index.mjs` resolves to
`artifacts/api-server/artifacts/api-server/dist/index.mjs` and node exits before binding
anything. The `board-persistence` step had `cd "$GITHUB_WORKSPACE"` from the start and worked;
the one written later did not and failed three runs in a row.

That last point is what the discarded output was hiding. The cause was in the very first
failing log the whole time, one line long — and it took three runs to see because the script's
output was thrown away and the local reproduction ran from the repo root, where the relative
path happens to work. Reproduce a CI failure with **CI's working directory**, not just CI's
command.
