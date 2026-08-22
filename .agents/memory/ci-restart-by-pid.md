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

That last point is the reason the original CI failure here was never diagnosed: it was not
reproducible locally (the old script came up in two seconds), and the evidence had been
discarded. If it recurs, the log will now be in the run.
