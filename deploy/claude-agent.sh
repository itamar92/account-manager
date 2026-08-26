#!/usr/bin/env bash
# The one command the app's SSH key is allowed to run on the agent host.
#
# `deploy/README.md` §4a pins this file into `authorized_keys` as a forced command:
#
#   command="/home/aiagent/bin/am-agent",no-port-forwarding,… ssh-ed25519 AAAA… account-manager-agent
#
# sshd then runs *this* whatever the caller asked for, and puts the caller's request in
# SSH_ORIGINAL_COMMAND. Two things follow, and both are the point:
#
#  1. **SSH_ORIGINAL_COMMAND is never executed, only matched.** The app asks for
#     `claude --version` when Settings → סוכן AI presses בדיקת חיבור, and for the analysis
#     command otherwise; anything else a holder of the key might ask for lands in the same
#     two branches. There is no path here that runs a string somebody else wrote.
#  2. **The prompt arrives on stdin**, as `agentClient.ts` sends it — never on a command line.
#
# Without the wrapper the connectivity probe cannot work at all: a bare `command="claude -p …"`
# runs a full analysis with an empty prompt when the app asks for a version, which fails slowly
# and says nothing useful. This is what makes בדיקת חיבור answer in a second.
#
# Installed by `deploy/setup-claude-agent.sh` to /home/aiagent/bin/am-agent, owned by root:
# a copy rather than a path into the git checkout, so that what the key runs changes only when
# somebody deliberately re-runs the installer on the VM, not on the next `git pull`.
set -euo pipefail

die() { echo "am-agent: $*" >&2; exit 1; }

HOME_DIR="${HOME:-/home/aiagent}"

# A forced command runs through the login shell non-interactively, which reads no profile and
# no rc file: nothing has put ~/.local/bin (where the native installer lands) on PATH yet.
PATH="${HOME_DIR}/.local/bin:/usr/local/bin:/usr/bin:/bin"
export PATH

# Where the AI login lives — CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`, or nothing at
# all when the account was logged in interactively and holds credentials in ~/.claude. Optional
# by design: the file is mode 600 and belongs to the agent account, and no credential for the
# model ever exists in the app's container or in deploy/.env.
: "${AM_AGENT_ENV_FILE:=${HOME_DIR}/.config/am-agent/env}"
if [ -r "$AM_AGENT_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$AM_AGENT_ENV_FILE"
  set +a
fi

# Under the app's own 120 s ceiling (AGENT_TIMEOUT_MS), so a run that overruns ends here with
# something to read rather than as a connection the app dropped.
: "${AM_AGENT_TIMEOUT:=110}"
# The advisor's prompts are a few tens of KB of campaign data. A megabyte is not one of them.
: "${AM_AGENT_MAX_PROMPT_BYTES:=1048576}"

request="${SSH_ORIGINAL_COMMAND-}"

# The probe: `agentClient.ts:ping()` sends the first word of the configured command with
# --version. Matched loosely on the suffix so it answers whether that word is `claude` or the
# path to this wrapper.
case "$request" in
  *--version)
    exec claude --version
    ;;
esac

prompt_file="$(mktemp)"
trap 'rm -f "$prompt_file"' EXIT
cat > "$prompt_file"

size="$(wc -c < "$prompt_file")"
[ "$size" -gt 0 ] || die "empty prompt on stdin — nothing to ask"
if [ "$size" -gt "$AM_AGENT_MAX_PROMPT_BYTES" ]; then
  die "prompt is ${size} bytes, over the ${AM_AGENT_MAX_PROMPT_BYTES} limit"
fi

model_args=()
[ -n "${AM_AGENT_MODEL:-}" ] && model_args=(--model "$AM_AGENT_MODEL")

# --tools "" is the security boundary that matters here. The prompt carries campaign names,
# client names and ad copy — text this app collected from Meta and from a browser form — and an
# unattended agent that can read it does not also need Bash and Edit on the VM the app runs on.
# --strict-mcp-config with no --mcp-config means no MCP server is loaded either, so a server
# left in ~/.claude.json by a person's own session cannot join an unattended run.
# --no-session-persistence keeps the advisor from accumulating a transcript per press of the
# button in the agent account's home.
set +e
timeout -k 5 "$AM_AGENT_TIMEOUT" \
  claude -p \
    --output-format json \
    --tools "" \
    --strict-mcp-config \
    --no-session-persistence \
    "${model_args[@]}" \
  < "$prompt_file"
status=$?
set -e

# 124 is timeout's own; say so, because the app can only report what it reads.
[ "$status" -eq 124 ] && echo "am-agent: claude did not answer within ${AM_AGENT_TIMEOUT}s" >&2

exit "$status"
