#!/bin/bash
#
# Do `db:push` and the boot guard agree about the monthly tier's tables?
#
# They have to. The API redeploys itself on every push and runs the guard; `db:push` is a
# command the owner runs by hand from his laptop. Those two are never in step, so if they build
# different tables a deploy and a push disagree about the shape of the thing money is counted
# in, and nobody finds out until a number is wrong.
#
# `compare.sh` next to this one builds the four monthly tables *each way* and diffs them. That
# only works for tables the guard creates. This one covers the rest — the tables the guard only
# adds columns to (refunds, teacher_plans, session_messages) plus the homework tables — by
# pushing first and then running the guard: the guard must find nothing left to do.
#
# Usage: artifacts/api-server/scripts/monthly-schema/agree.sh
set -u
cd "$(dirname "$0")/../../../.." || exit 1

DB=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)
TABLES="-t teacher_plans -t recurring_sessions -t recurring_days -t recurring_enrollments \
        -t refunds -t session_messages -t homework -t homework_submissions"

# pg_dump stamps each dump with a random nonce; it is not schema.
dump() { pg_dump "$DB" --schema-only $TABLES | grep -vE '^\\(restrict|unrestrict)'; }

# Kill by pid found with ps, never `pkill -f`: that pattern lands in the calling shell's own
# argv and kills the caller. See .agents/memory/ci-restart-by-pid.md.
restart_api() {
  ps -eo pid,cmd | grep "[d]ist/index\.mjs" | awk '{print $1}' | xargs -r kill 2>/dev/null
  sleep 2
  : > /tmp/api.log
  node --env-file-if-exists=.env artifacts/api-server/dist/index.mjs > /tmp/api.log 2>&1 &
  sleep 6
}

echo "pushing the schema..."
timeout 240 pnpm run db:push >/dev/null 2>&1 || { echo "db:push failed"; exit 1; }
dump > /tmp/after-push.sql

echo "booting the API so its guards run..."
restart_api
for guard in "monthly tier tables are present" \
             "monthly enforcement columns are present" \
             "monthly portal tables are present"; do
  grep -q "$guard" /tmp/api.log || { echo "a boot guard did not run: $guard"; tail -5 /tmp/api.log; exit 1; }
done
dump > /tmp/after-guard.sql

echo "push: $(wc -l < /tmp/after-push.sql) lines   guard: $(wc -l < /tmp/after-guard.sql) lines"
if diff /tmp/after-push.sql /tmp/after-guard.sql; then
  echo "IDENTICAL — the boot guard finds nothing db:push has not already done"
else
  echo "*** THEY DISAGREE — change one, change the other ***"
  exit 1
fi
