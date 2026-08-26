#!/usr/bin/env bash
# Provision the AI agent account on the Oracle VM: an unprivileged user, Claude Code installed
# under it, and an SSH key that opens exactly one command — the wrapper beside this file.
#
# Run it on the VM, from the checkout in /opt/account-manager:
#
#   sudo deploy/setup-claude-agent.sh --pubkey ~/am-agent.pub
#
# Idempotent: re-running it reinstalls the wrapper, updates Claude Code and re-checks the key
# restriction without disturbing the agent's login. That is the supported way to update the
# wrapper — the forced command runs the copy in the agent's home, not this file, so a `git pull`
# alone changes nothing about what the app's key can do.
#
# What it deliberately does not do: log the agent in. That step needs a browser and a person,
# and it is the one credential this design keeps off the app's side entirely — see README.md
# §4a for the two ways to do it.
set -euo pipefail

AGENT_USER="aiagent"
PUBKEY_SRC=""
DO_INSTALL=1
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'USAGE'
Usage: sudo deploy/setup-claude-agent.sh [options]

  --pubkey PATH   install this public key with a forced command ("-" reads stdin).
                  Generate it on your own machine, never on the VM:
                    ssh-keygen -t ed25519 -f ~/.ssh/am-agent -C 'account-manager-agent' -N ''
  --user NAME     the agent account to create/use (default: aiagent)
  --skip-install  do not download or update Claude Code
  -h, --help      this text
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --pubkey) PUBKEY_SRC="${2:?--pubkey needs a path or -}"; shift 2 ;;
    --user)   AGENT_USER="${2:?--user needs a name}"; shift 2 ;;
    --skip-install) DO_INSTALL=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "run me with sudo" >&2; exit 1; }
[ -r "${HERE}/claude-agent.sh" ] || { echo "claude-agent.sh not found beside this script" >&2; exit 1; }

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- the account

if id -u "$AGENT_USER" >/dev/null 2>&1; then
  say "user ${AGENT_USER} already exists"
else
  say "creating ${AGENT_USER}"
  # No password: the only way in is the restricted key installed below, and the console.
  adduser --disabled-password --gecos '' "$AGENT_USER"
fi

AGENT_HOME="$(getent passwd "$AGENT_USER" | cut -d: -f6)"
[ -n "$AGENT_HOME" ] && [ -d "$AGENT_HOME" ] || { echo "no home directory for ${AGENT_USER}" >&2; exit 1; }

# Ubuntu creates homes world-readable. Nothing here is anybody else's business.
chmod 750 "$AGENT_HOME"

# ---------------------------------------------------------------- claude code

if [ "$DO_INSTALL" -eq 1 ]; then
  say "installing/updating Claude Code as ${AGENT_USER}"
  # Native installer: one self-updating binary in ~/.local, no Node runtime to keep patched.
  # The Ampere A1 shapes are arm64 and it publishes a linux-arm64 build, so this is the same
  # command on either shape.
  sudo -u "$AGENT_USER" -H bash -c 'curl -fsSL https://claude.ai/install.sh | bash'
fi

CLAUDE_BIN="${AGENT_HOME}/.local/bin/claude"
if [ -x "$CLAUDE_BIN" ]; then
  say "claude: $(sudo -u "$AGENT_USER" -H "$CLAUDE_BIN" --version 2>&1 || echo 'version check failed')"
  # The wrapper passes these on every run. A build that does not know one of them fails the
  # whole advisor with an unknown-flag error, which is worth catching here rather than there.
  help="$(sudo -u "$AGENT_USER" -H "$CLAUDE_BIN" --help 2>/dev/null || true)"
  for flag in --tools --strict-mcp-config --no-session-persistence --output-format; do
    case "$help" in
      *"$flag"*) ;;
      *) echo "WARNING: this claude build does not list ${flag} — check the wrapper's flags" >&2 ;;
    esac
  done
else
  echo "WARNING: no claude binary at ${CLAUDE_BIN} (installed with --skip-install?)" >&2
fi

# ---------------------------------------------------------------- the wrapper

say "installing the forced command to ${AGENT_HOME}/bin/am-agent"
install -d -o root -g root -m 755 "${AGENT_HOME}/bin"
# root-owned and not writable by the agent: the account the app's key opens cannot rewrite the
# single command that key is restricted to.
install -o root -g root -m 755 "${HERE}/claude-agent.sh" "${AGENT_HOME}/bin/am-agent"

say "preparing ${AGENT_HOME}/.config/am-agent/env"
install -d -o "$AGENT_USER" -g "$AGENT_USER" -m 700 "${AGENT_HOME}/.config" "${AGENT_HOME}/.config/am-agent"
ENV_FILE="${AGENT_HOME}/.config/am-agent/env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'ENVTMPL'
# Read by ~/bin/am-agent on every run. Mode 600, and the only place on this VM that holds a
# credential for the model.
#
# Leave everything commented out if you logged the account in interactively instead
# (`sudo -u aiagent -i` then `claude`) — that writes ~/.claude/.credentials.json and the
# wrapper needs nothing here.
#
# For an unattended box, a one-year token is steadier than a login that expires without
# warning anyone. Generate it on your own machine, where a browser exists:
#
#   claude setup-token
#
#CLAUDE_CODE_OAUTH_TOKEN=

# Optional. Unset means whatever the account's plan defaults to.
#AM_AGENT_MODEL=

# Seconds. Keep it under the app's AGENT_TIMEOUT_MS (120000 by default).
#AM_AGENT_TIMEOUT=110
ENVTMPL
  chown "$AGENT_USER:$AGENT_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  say "env file already exists — left alone"
  chmod 600 "$ENV_FILE"
fi

# ---------------------------------------------------------------- the key

RESTRICTION='command="'"${AGENT_HOME}"'/bin/am-agent",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty'
AUTH_KEYS="${AGENT_HOME}/.ssh/authorized_keys"

if [ -n "$PUBKEY_SRC" ]; then
  if [ "$PUBKEY_SRC" = "-" ]; then
    PUBKEY="$(cat)"
  else
    [ -r "$PUBKEY_SRC" ] || { echo "cannot read ${PUBKEY_SRC}" >&2; exit 1; }
    PUBKEY="$(cat "$PUBKEY_SRC")"
  fi
  PUBKEY="$(printf '%s' "$PUBKEY" | tr -d '\r' | head -n 1)"

  case "$PUBKEY" in
    ssh-*|ecdsa-*|sk-*) ;;
    *"PRIVATE KEY"*) echo "that is a PRIVATE key — pass the .pub half" >&2; exit 1 ;;
    *) echo "does not look like a public key: ${PUBKEY:0:40}…" >&2; exit 1 ;;
  esac

  install -d -o "$AGENT_USER" -g "$AGENT_USER" -m 700 "${AGENT_HOME}/.ssh"
  touch "$AUTH_KEYS"
  chown "$AGENT_USER:$AGENT_USER" "$AUTH_KEYS"
  chmod 600 "$AUTH_KEYS"

  KEY_BODY="$(printf '%s' "$PUBKEY" | awk '{print $2}')"
  if grep -qF -- "$KEY_BODY" "$AUTH_KEYS"; then
    say "key already present — rewriting its restriction"
    grep -vF -- "$KEY_BODY" "$AUTH_KEYS" > "${AUTH_KEYS}.new" || true
    mv "${AUTH_KEYS}.new" "$AUTH_KEYS"
    chown "$AGENT_USER:$AGENT_USER" "$AUTH_KEYS"
    chmod 600 "$AUTH_KEYS"
  fi
  printf '%s %s\n' "$RESTRICTION" "$PUBKEY" >> "$AUTH_KEYS"
  say "installed, restricted to ${AGENT_HOME}/bin/am-agent"
  ssh-keygen -lf /dev/stdin <<< "$PUBKEY" || true
else
  say "no --pubkey given — skipping authorized_keys"
  if [ -f "$AUTH_KEYS" ] && awk 'NF && $1 !~ /^#/ && $1 !~ /^command=/ { bad = 1 } END { exit !bad }' "$AUTH_KEYS"; then
    echo "WARNING: ${AUTH_KEYS} holds a key with no forced command — that key opens a shell" >&2
  fi
fi

# ---------------------------------------------------------------- what is left

say "host keys — paste into Settings → סוכן AI → מפתח המארח"
ssh-keyscan -t ed25519 127.0.0.1 2>/dev/null | sed 's/^127.0.0.1/host.docker.internal/' || true

cat <<NEXT

Left to do, in this order:

  1. Log the agent in, once, if you have not:
       sudo -u ${AGENT_USER} -i        # then run: claude   (paste the code back from a browser)
     or put a token from \`claude setup-token\` into ${ENV_FILE}.

  2. Prove the key does what it says — from the machine holding the private half:
       ssh -i ~/.ssh/am-agent -o IdentitiesOnly=yes ${AGENT_USER}@<host> 'claude --version'
         → a version string: the probe behind בדיקת חיבור works.
       ssh -i ~/.ssh/am-agent -o IdentitiesOnly=yes ${AGENT_USER}@<host> 'whoami' </dev/null
         → "am-agent: empty prompt on stdin". A username here means the forced command is
           missing and that key is a shell on this VM.

  3. Fill in Settings → סוכן AI in the app (host host.docker.internal, port 22,
     user ${AGENT_USER}, the private key, the host key above), then press בדיקת חיבור.

NEXT
