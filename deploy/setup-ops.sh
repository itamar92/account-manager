#!/usr/bin/env bash
# One-time setup for Settings → שרת: lets the app restart or redeploy itself from the UI, so a
# routine update no longer needs an SSH session to the VM.
#
# Run it on the VM, from the checkout:
#
#   cd /opt/account-manager && sudo deploy/setup-ops.sh
#   cd deploy && docker compose up -d       # picks up the key mount (once)
#
# What it sets up — the same "a key that opens one command" shape as setup-claude-agent.sh:
#
#   - an `amops` account with no password and no shell use: its only key is forced to
#     `sudo -n /usr/local/sbin/am-ops`, and sudoers lets it run that one root-owned script
#   - /usr/local/sbin/am-ops (deploy/ops.sh, copied, owned by root) — status / logs / restart /
#     redeploy, matched from SSH_ORIGINAL_COMMAND and never executed
#   - a fresh ed25519 key pair, generated here, with the private half and the pinned host key in
#     deploy/ops-key/ (git-ignored), which docker-compose.yml mounts read-only into the app
#
# Nothing to paste anywhere: the app finds the key and the host key in the mount by itself.
# Idempotent — re-running it updates the script and keeps the existing key (--new-key rotates it).
set -euo pipefail

OPS_USER="amops"
NEW_KEY=0
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
AM_DIR="$(cd -- "${HERE}/.." && pwd)"
KEY_DIR="${HERE}/ops-key"
# The app container runs as `node`, uid 1000 in the official image.
APP_UID="${APP_UID:-1000}"

while [ $# -gt 0 ]; do
  case "$1" in
    --new-key) NEW_KEY=1; shift ;;
    --user) OPS_USER="${2:?--user needs a name}"; shift 2 ;;
    -h|--help)
      echo "Usage: sudo deploy/setup-ops.sh [--new-key] [--user NAME]"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "run me with sudo" >&2; exit 1; }
[ -r "${HERE}/ops.sh" ] || { echo "ops.sh not found beside this script" >&2; exit 1; }
[ -d "${AM_DIR}/.git" ] || { echo "${AM_DIR} is not a git checkout" >&2; exit 1; }
command -v docker >/dev/null || { echo "docker is not installed" >&2; exit 1; }

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- the account

if id -u "$OPS_USER" >/dev/null 2>&1; then
  say "user ${OPS_USER} already exists"
else
  say "creating ${OPS_USER}"
  adduser --disabled-password --gecos '' "$OPS_USER"
fi
OPS_HOME="$(getent passwd "$OPS_USER" | cut -d: -f6)"
chmod 750 "$OPS_HOME"

# ---------------------------------------------------------------- the script

say "installing /usr/local/sbin/am-ops"
install -o root -g root -m 755 "${HERE}/ops.sh" /usr/local/sbin/am-ops
# AM_BRANCH: what «עדכון ופריסה מחדש» deploys. master, as .github/workflows/deploy.yml does.
printf 'AM_DIR=%q\nAM_BRANCH=%q\n' "$AM_DIR" "${AM_BRANCH:-master}" > /etc/am-ops.conf
chmod 644 /etc/am-ops.conf

say "sudoers rule"
SUDOERS=/etc/sudoers.d/am-ops
TMP="$(mktemp)"
cat > "$TMP" <<SUDO
# Settings → שרת in the app: ${OPS_USER} may run am-ops, with no arguments, and nothing else.
# The request travels in SSH_ORIGINAL_COMMAND, which am-ops matches against a fixed list.
Defaults!/usr/local/sbin/am-ops env_keep += "SSH_ORIGINAL_COMMAND"
${OPS_USER} ALL=(root) NOPASSWD: /usr/local/sbin/am-ops ""
SUDO
visudo -cf "$TMP" >/dev/null || { echo "generated sudoers rule failed visudo" >&2; rm -f "$TMP"; exit 1; }
install -o root -g root -m 440 "$TMP" "$SUDOERS"
rm -f "$TMP"

# ---------------------------------------------------------------- the key

install -d -o "$APP_UID" -g "$APP_UID" -m 700 "$KEY_DIR"
if [ "$NEW_KEY" -eq 1 ] || [ ! -f "${KEY_DIR}/id_ed25519" ]; then
  say "generating a new key pair in ${KEY_DIR}"
  rm -f "${KEY_DIR}/id_ed25519" "${KEY_DIR}/id_ed25519.pub"
  ssh-keygen -q -t ed25519 -N '' -C 'account-manager-ops' -f "${KEY_DIR}/id_ed25519"
else
  say "keeping the existing key in ${KEY_DIR}"
fi
chown "$APP_UID:$APP_UID" "${KEY_DIR}/id_ed25519" "${KEY_DIR}/id_ed25519.pub"
chmod 600 "${KEY_DIR}/id_ed25519"

say "authorized_keys for ${OPS_USER} (forced command)"
install -d -o "$OPS_USER" -g "$OPS_USER" -m 700 "${OPS_HOME}/.ssh"
RESTRICTION='command="/usr/bin/sudo -n /usr/local/sbin/am-ops",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty'
# The whole file is rewritten: this account exists for this one key and should hold no other.
printf '%s %s\n' "$RESTRICTION" "$(cat "${KEY_DIR}/id_ed25519.pub")" > "${OPS_HOME}/.ssh/authorized_keys"
chown "$OPS_USER:$OPS_USER" "${OPS_HOME}/.ssh/authorized_keys"
chmod 600 "${OPS_HOME}/.ssh/authorized_keys"

say "pinning this host's key"
ssh-keyscan -t ed25519 127.0.0.1 2>/dev/null | awk '{print $2, $3}' > "${KEY_DIR}/host_key"
[ -s "${KEY_DIR}/host_key" ] || { echo "ssh-keyscan returned nothing — is sshd running?" >&2; exit 1; }
chown "$APP_UID:$APP_UID" "${KEY_DIR}/host_key"
chmod 644 "${KEY_DIR}/host_key"

# ---------------------------------------------------------------- prove it

say "checking the key opens am-ops and nothing else"
check() {
  ssh -i "${KEY_DIR}/id_ed25519" -o IdentitiesOnly=yes -o BatchMode=yes \
      -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
      "${OPS_USER}@127.0.0.1" "$1" </dev/null 2>&1 || true
}
if check status | grep -q '^running='; then
  echo "  status: ok"
else
  echo "WARNING: 'status' did not answer as expected:" >&2; check status >&2
fi
if check whoami | grep -q "unknown request"; then
  echo "  whoami: refused, as it should be"
else
  echo "WARNING: 'whoami' was not refused — the forced command is not in effect" >&2
fi

cat <<NEXT

Done. One more step, once:

  cd ${HERE} && docker compose up -d

That recreates the app container with ${KEY_DIR} mounted at /run/am-ops. After that,
Settings → שרת in the app has the restart and redeploy buttons.

NEXT
