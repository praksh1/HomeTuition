#!/bin/bash
# Does the boot guard's hand-written DDL build the same tables as the drizzle schema?
#
# It has to. The API redeploys itself on every push and runs the guard; `db:push` is a command
# the owner runs by hand from his laptop. If the two build different tables, a deploy and a
# push disagree about the monthly tier's shape and nobody finds out until money is wrong.
set -u
cd /home/user/HomeTuition
DB=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)
TBLS="-t teacher_plans -t recurring_sessions -t recurring_days -t recurring_enrollments"
DROP='DROP TABLE IF EXISTS recurring_enrollments, recurring_days, recurring_sessions, teacher_plans CASCADE'

# pg_dump stamps each dump with a random \restrict nonce; it is not schema.
dump() { pg_dump "$DB" --schema-only $TBLS | grep -vE '^\\(restrict|unrestrict)'; }
stop_server() { pkill -f 'api-server/dist/index.mjs' >/dev/null 2>&1; sleep 1; }

# A: built by drizzle-kit push, straight from lib/db/src/schema/*.ts
stop_server
psql "$DB" -q -c "$DROP" >/dev/null 2>&1
timeout 180 pnpm run db:push >/dev/null 2>&1 || { echo "db:push failed"; exit 1; }
dump > /tmp/from-drizzle.sql || { echo "dump A failed"; exit 1; }

# B: built by ensureMonthlyTierTables() at boot, from the hand-written DDL
psql "$DB" -q -c "$DROP" >/dev/null 2>&1
node --env-file-if-exists=.env artifacts/api-server/dist/index.mjs > /tmp/boot.log 2>&1 &
sleep 5
if ! grep -qi "monthly tier tables are present" /tmp/boot.log; then
  echo "BOOT GUARD DID NOT RUN CLEANLY:"; grep -i "monthly" /tmp/boot.log | head -5; exit 1
fi
dump > /tmp/from-guard.sql || { echo "dump B failed"; exit 1; }
stop_server

echo "drizzle: $(wc -l < /tmp/from-drizzle.sql) lines   guard: $(wc -l < /tmp/from-guard.sql) lines"
if diff /tmp/from-drizzle.sql /tmp/from-guard.sql; then
  echo "IDENTICAL"
else
  echo "*** THEY DISAGREE ***"; exit 1
fi
