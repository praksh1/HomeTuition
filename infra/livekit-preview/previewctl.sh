#!/usr/bin/env bash
# Run from the generated bundle on its dedicated Linux preview VM, not on Railway.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ "$(uname -s)" != Linux || ! -f preview.json ]] || ! grep -q '"environment": "preview"' preview.json; then
  echo 'Not a generated Linux preview installation. Nothing changed.' >&2
  exit 1
fi
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo 'Docker Engine and its Compose plugin must be installed on this preview VM first.' >&2
  exit 1
fi
compose=(docker compose --project-name fadko-livekit-preview --file compose.yaml)
case "${1:-status}" in
  status)
    "${compose[@]}" ps
    if curl -fsS --max-time 4 http://127.0.0.1:7880/ >/dev/null; then
      echo 'Local signalling process responds. This does NOT prove external video or TURN works.'
    else
      echo 'Local signalling is not responding. Run: bash previewctl.sh logs' >&2
      exit 1
    fi
    echo 'Public readiness: run the private probe from your laptop, then a two-device Fadko call.'
    ;;
  start)
    [[ "${2:-}" == '--firewall-reviewed' ]] || {
      echo 'First restrict 7880/5349/2019 at the host AND provider firewall; see README.' >&2
      echo 'Then run: bash previewctl.sh start --firewall-reviewed' >&2
      exit 1
    }
    chmod 600 livekit.yaml railway-staging.env
    "${compose[@]}" config --quiet
    "${compose[@]}" up -d
    echo 'Started PREVIEW only. Railway has not been changed. Now check TLS, credentials and real media.'
    ;;
  stop|restart)
    [[ "${2:-}" == '--no-active-testers' ]] || {
      echo 'This can disconnect preview calls. First end all test classes, then add --no-active-testers.' >&2
      exit 1
    }
    "${compose[@]}" "$1"
    ;;
  logs)
    echo 'Logs can contain participant identities. Review privately; redact before sharing.' >&2
    "${compose[@]}" logs --tail 60 --no-color
    ;;
  *) echo 'Usage: bash previewctl.sh {status|start --firewall-reviewed|stop --no-active-testers|restart --no-active-testers|logs}' >&2; exit 1 ;;
esac
