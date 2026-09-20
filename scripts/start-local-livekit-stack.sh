#!/usr/bin/env bash
# Replace the shared CI API with a deterministic LiveKit-backed one.
#
# The rendered floor journey uses the real built app, so the API must keep the same 8080 address
# baked into that bundle. The media journey starts its own isolated API and SFU and stops them on
# exit; without this handoff the next journey quietly reconnects to the original Daily API and
# reports that the speaking floor is unavailable. This script records exact process ids and never
# kills by matching a command line.
set -euo pipefail

root="${GITHUB_WORKSPACE:-$(git rev-parse --show-toplevel)}"
cd "$root"

api_port="${LIVEKIT_TEST_API_PORT:-8080}"
livekit_port="${LIVEKIT_TEST_PORT:-7880}"
binary="${LIVEKIT_SERVER_BIN:-}"
database_url="${DATABASE_URL:-${PGURL:-}}"
session_secret="${SESSION_SECRET:-livekit-ci-only-not-a-real-secret}"
api_key="devkey"
api_secret="secret"

if [[ -z "$binary" || ! -x "$binary" ]]; then
  echo "::error title=LiveKit test server missing::LIVEKIT_SERVER_BIN does not name an executable."
  exit 1
fi
if [[ -z "$database_url" ]]; then
  echo "::error title=Test database missing::Set DATABASE_URL or PGURL before starting the LiveKit stack."
  exit 1
fi

cleanup_new_stack() {
  if [[ -f /tmp/floor-livekit-api.pid ]]; then
    kill "$(cat /tmp/floor-livekit-api.pid)" 2>/dev/null || true
  fi
  if [[ -f /tmp/floor-livekit.pid ]]; then
    kill "$(cat /tmp/floor-livekit.pid)" 2>/dev/null || true
  fi
}
trap cleanup_new_stack ERR INT TERM

# Stop only the API whose pid the workflow recorded. If the port stays occupied, fail with the
# precise condition rather than starting a second server and later blaming LiveKit.
if [[ -f /tmp/api.pid ]]; then
  kill "$(cat /tmp/api.pid)" 2>/dev/null || true
fi
for _ in $(seq 1 40); do
  if ! curl -sf --max-time 1 "http://127.0.0.1:${api_port}/api/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
if curl -sf --max-time 1 "http://127.0.0.1:${api_port}/api/healthz" >/dev/null 2>&1; then
  echo "::error title=Old test API still running::Port ${api_port} is still serving the previous provider."
  exit 1
fi

nohup env LIVEKIT_KEYS="${api_key}: ${api_secret}" \
  "$binary" --dev --bind 127.0.0.1 > /tmp/floor-livekit.log 2>&1 &
echo $! > /tmp/floor-livekit.pid

livekit_up=false
for _ in $(seq 1 60); do
  if curl -sS --max-time 1 "http://127.0.0.1:${livekit_port}/" >/dev/null 2>&1; then
    livekit_up=true
    break
  fi
  sleep 0.25
done
if [[ "$livekit_up" != true ]]; then
  echo "::error title=Local LiveKit did not start::Nothing answered on port ${livekit_port}."
  cat /tmp/floor-livekit.log
  exit 1
fi

nohup env \
  PORT="$api_port" \
  NODE_ENV=test \
  WS_HEARTBEAT_MS=3000 \
  DATABASE_URL="$database_url" \
  SESSION_SECRET="$session_secret" \
  VIDEO_PROVIDER=livekit \
  LIVEKIT_API_KEY="$api_key" \
  LIVEKIT_API_SECRET="$api_secret" \
  LIVEKIT_URL="ws://127.0.0.1:${livekit_port}" \
  node artifacts/api-server/dist/index.mjs > /tmp/floor-livekit-api.log 2>&1 &
echo $! > /tmp/floor-livekit-api.pid
cp /tmp/floor-livekit-api.pid /tmp/api.pid

api_up=false
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${api_port}/api/healthz" >/dev/null 2>&1; then
    api_up=true
    break
  fi
  sleep 0.25
done
if [[ "$api_up" != true ]]; then
  echo "::error title=LiveKit test API did not start::The replacement API never became healthy."
  cat /tmp/floor-livekit-api.log
  exit 1
fi

trap - ERR INT TERM
echo "LiveKit test stack is ready: API ${api_port}, SFU ${livekit_port}."
