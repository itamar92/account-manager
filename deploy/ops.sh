#!/usr/bin/env bash
# The one command the app's "server" SSH key can run: restart or redeploy the app from the UI.
#
# Installed by `deploy/setup-ops.sh` as /usr/local/sbin/am-ops, owned by root, and reached as
#
#   authorized_keys (amops):  command="/usr/bin/sudo -n /usr/local/sbin/am-ops",no-pty,… ssh-ed25519 …
#   sudoers:                  amops ALL=(root) NOPASSWD: /usr/local/sbin/am-ops ""
#
# Same shape as claude-agent.sh: sshd puts whatever the caller asked for in SSH_ORIGINAL_COMMAND,
# and this script **matches it against a fixed list and never executes it**. A holder of the key
# can do exactly what the buttons in Settings → שרת do, and nothing else:
#
#   status    what is running, the last job and how it ended, the checkout's commit
#   logs      the last lines of the app container's log
#   restart   `docker compose restart app`
#   redeploy  the latest `master`, then `docker compose up -d --build` — the same steps as
#             .github/workflows/deploy.yml, so the button and the workflow leave the VM alike
#
# restart and redeploy restart the very container that asked for them, which would cut the SSH
# session and — through SIGHUP — the job with it. So both are started detached (setsid) and this
# script returns at once; the UI follows the job through `status`. A lock keeps two jobs from
# running at the same time, which matters because the button is the kind people press twice.
#
# It is a copy, owned by root: a `git pull` (including the one `redeploy` does) never changes what
# the key can run. Re-run `sudo deploy/setup-ops.sh` to install a new version.
set -euo pipefail

CONF=/etc/am-ops.conf
STATE_DIR=/var/lib/am-ops
LOG="${STATE_DIR}/job.log"
LOCK="${STATE_DIR}/job.lock"

die() { echo "am-ops: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "must run as root (through sudo)"
[ -r "$CONF" ] || die "${CONF} missing — run deploy/setup-ops.sh"
# shellcheck disable=SC1090
. "$CONF"
: "${AM_DIR:?AM_DIR not set in ${CONF}}"
: "${AM_BRANCH:=master}"
[ -d "${AM_DIR}/.git" ] || die "${AM_DIR} is not a git checkout"
COMPOSE_FILE="${AM_DIR}/deploy/docker-compose.yml"
[ -r "$COMPOSE_FILE" ] || die "no ${COMPOSE_FILE}"

install -d -m 700 "$STATE_DIR"

# The checkout belongs to whoever cloned it (ubuntu, normally). git runs as that user, so a pull
# from here never leaves root-owned files in a tree somebody else has to work in.
OWNER="$(stat -c %U "$AM_DIR")"
as_owner() { sudo -u "$OWNER" -H "$@"; }

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

state() { cat "${STATE_DIR}/$1" 2>/dev/null || true; }

job_running() {
  # The detached job holds the lock for as long as it runs. If we can take it, nothing is running.
  exec 9>"$LOCK"
  if flock -n 9; then
    flock -u 9
    return 1
  fi
  return 0
}

print_status() {
  local running=0
  job_running && running=1
  echo "running=${running}"
  echo "action=$(state action)"
  echo "started=$(state started)"
  echo "finished=$(state finished)"
  echo "exit=$(state exit)"
  echo "commit=$(as_owner git -C "$AM_DIR" rev-parse --short HEAD 2>/dev/null || true)"
  echo "branch=$(as_owner git -C "$AM_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  echo "subject=$(as_owner git -C "$AM_DIR" log -1 --format=%s 2>/dev/null | tr -d '\r' | cut -c1-120 || true)"
  echo "---"
  tail -n 60 "$LOG" 2>/dev/null || true
}

# Runs one of the two jobs detached from this SSH session, under the lock.
start_job() {
  local action="$1"
  # Taken here and inherited by the detached job, which holds it until it exits — so there is no
  # gap between "nothing is running" and "the job has started" for a second press to slip into.
  exec 9>"$LOCK"
  if ! flock -n 9; then
    local current
    current="$(state action)"
    die "${current:-a job} is already running — wait for it to finish"
  fi
  printf '%s\n' "$action" > "${STATE_DIR}/action"
  date -Is > "${STATE_DIR}/started"
  : > "${STATE_DIR}/finished"
  : > "${STATE_DIR}/exit"
  : > "$LOG"

  # env -u: the job must not see the caller's request, or it would read it as its own.
  env -u SSH_ORIGINAL_COMMAND setsid -f bash "$0" "__job_${action}" </dev/null >>"$LOG" 2>&1
  echo "started=${action}"
}

do_restart() {
  compose restart app
}

do_redeploy() {
  # As the deploy workflow does: master as GitHub has it. reset --hard drops tracked edits made on
  # the VM and leaves untracked files (deploy/.env, deploy/ops-key/) alone.
  echo "-- git fetch origin ${AM_BRANCH} (${OWNER})"
  as_owner git -C "$AM_DIR" fetch --prune origin "$AM_BRANCH" \
    || { echo "git fetch failed — nothing was rebuilt"; return 1; }
  as_owner git -C "$AM_DIR" checkout -q "$AM_BRANCH" || return 1
  as_owner git -C "$AM_DIR" reset -q --hard "origin/${AM_BRANCH}" || return 1
  as_owner git -C "$AM_DIR" log -1 --oneline
  GIT_SHA="$(as_owner git -C "$AM_DIR" rev-parse --short HEAD)" || return 1
  export GIT_SHA
  echo "-- docker compose up -d --build (${GIT_SHA})"
  compose up -d --build || { echo "build/up failed — the previous container is still running"; return 1; }
  echo "-- pruning dangling images"
  docker image prune -f >/dev/null || true
}

run_job() {
  local action="$1"
  # fd 9 is the lock start_job took; keeping it open is what keeps it held.
  # Give the app a moment to answer the request that started this before its container goes.
  sleep 3
  local status=0
  echo "== $(date -Is) ${action} =="
  # Each step is checked by hand: `set -e` does not apply inside a function called from `||`.
  case "$action" in
    restart) do_restart || status=$? ;;
    redeploy) do_redeploy || status=$? ;;
  esac
  echo "== $(date -Is) done, exit ${status} =="
  printf '%s\n' "$status" > "${STATE_DIR}/exit"
  date -Is > "${STATE_DIR}/finished"
  exit "$status"
}

request="${SSH_ORIGINAL_COMMAND-${1-}}"

case "$request" in
  status)   print_status ;;
  logs)     compose logs --no-color --tail 200 app 2>&1 ;;
  restart)  start_job restart ;;
  redeploy) start_job redeploy ;;
  # Only ever reached through start_job's own setsid above, which runs this file as root already.
  __job_restart)  [ -z "${SSH_ORIGINAL_COMMAND-}" ] || die "not allowed"; run_job restart ;;
  __job_redeploy) [ -z "${SSH_ORIGINAL_COMMAND-}" ] || die "not allowed"; run_job redeploy ;;
  *) die "unknown request '${request:0:40}' — allowed: status, logs, restart, redeploy" ;;
esac
