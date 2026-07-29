#!/usr/bin/env bash
# Oracle reclaims Always Free compute instances it considers idle. An app used by
# four people is exactly the profile that trips it, so generate a small, honest
# amount of work: hit the app's own health endpoint and burn a little CPU.
#
# Oracle's documented threshold is roughly: over a 7-day window, CPU below 20%,
# network below 20%, and memory below 20% (memory applies to A1 shapes only).
# This does not try to fake 20% — it keeps the instance off the "no activity at
# all" list while a real reclamation is best avoided by actually using the VM.
#
#   */15 * * * * /opt/account-manager/deploy/keepalive.sh >/dev/null 2>&1

set -euo pipefail

# Through the tunnel rather than localhost, so the cloudflared connection counts
# as network activity too. Falls back to the container if the tunnel is down.
APP_URL="${APP_URL:-https://im-tools.org/api/health}"

curl -fsS --max-time 20 "$APP_URL" >/dev/null \
  || docker compose -f /opt/account-manager/deploy/docker-compose.yml exec -T app \
       node -e "fetch('http://127.0.0.1:3000/api/health')" >/dev/null 2>&1 \
  || true

# ~10 seconds of one core, every 15 minutes.
timeout 10s sh -c 'while :; do :; done' || true
