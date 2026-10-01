# Deploying Account Manager to `im-tools.org`

Oracle Cloud Always Free VM running the app in Docker, exposed through a
Cloudflare Tunnel. No open ports, no public IP, no certificate to renew.

```
browser ──https──▶ Cloudflare edge ──tunnel──▶ cloudflared ──▶ app:3000
                    (im-tools.org)              (on the VM, outbound only)
```

## Why this shape

The app is a stateful Node process, not a static site: `better-sqlite3` is a
native module writing a real file in WAL mode, and sessions live in that same
database. It needs a persistent disk and a long-running process, which rules out
Workers/Pages-style hosting without rewriting the data layer onto D1.

The tunnel is what makes the Oracle side easy. OCI has two independent firewalls
— the VCP security list *and* iptables rules baked into the stock Ubuntu image —
and the usual first-deploy failure is opening one but not the other. An
outbound-only tunnel needs neither, and never exposes the VM's IP to scanners.

## 1. Create the VM

Oracle Cloud → Compute → Instances → Create.

- **Shape**: Ampere A1 (`VM.Standard.A1.Flex`), 2 OCPU / 12 GB. Oracle reportedly
  cut the Always Free A1 allowance from 4/24 to 2/12 in June 2026, so ask for
  2/12 — the app needs a fraction of it either way.
- **Image**: Ubuntu 24.04 (ARM64 build — it must match the shape).
- **SSH keys**: upload your public key, or download the generated one *before*
  creating — it cannot be retrieved afterwards.
- **Networking**: assign a public IPv4. The tunnel does not need one — nothing
  inbound ever reaches the app — but you still need a way to SSH in and
  administer the box. Port 22 with key-only auth is the normal answer; the
  alternative (no public IP, reaching it through OCI Bastion or the serial
  console) makes routine maintenance painful for no real gain here.
- If you hit `Out of capacity` (common for A1 in busy regions), either retry on a
  schedule or fall back to the AMD `VM.Standard.E2.1.Micro`. That shape works,
  but at 1 GB RAM you should build the image elsewhere and `docker load` it —
  `vite build` will not fit.

If you already created the instance without a public IP, add one: instance →
Resources → Attached VNICs → the primary VNIC → IPv4 Addresses → **⋮** on the
private IP row → Edit → Public IP Type → Ephemeral.

## 1a. Connect

```bash
ssh -i ~/path/to/private-key ubuntu@<public-ip>
```

`ubuntu` is the default user on Oracle's Ubuntu images. The `10.0.0.x` address
shown alongside is the private IP — reachable only inside the VCN.

Add swap regardless; SQLite and the Node build are both happier with it:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 2. Install Docker

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker
```

## 3. Create the tunnel

In **Cloudflare Zero Trust → Networks → Tunnels → Create a tunnel** (Cloudflared):

1. Name it `account-manager`. Copy the **token** from the install command shown —
   that single value is all the VM needs.
2. Under **Public Hostnames**, add:
   - Subdomain: *(blank)* · Domain: `im-tools.org` · Path: *(blank)*
   - Service: `HTTP` → `app:3000`

   `app` is the compose service name; cloudflared resolves it on the compose
   network. The DNS record in your zone is created for you — do not add one by
   hand.

## 4. Deploy

```bash
sudo mkdir -p /opt/account-manager && sudo chown $USER /opt/account-manager
git clone https://github.com/itamar92/account-manager.git /opt/account-manager
cd /opt/account-manager/deploy
cp .env.example .env && chmod 600 .env
$EDITOR .env          # TUNNEL_TOKEN + SEED_* are required
docker compose up -d --build
docker compose logs -f
```

The first build compiles `better-sqlite3` from source for ARM64 and takes a few
minutes. On first start the app creates and seeds the database inside the
`am-data` volume, importing `invoices_2026.csv` and the Moonlight data.

`im-tools.org` should now serve the app over HTTPS.

### Set the passwords before you start

`SEED_OWNER_PASSWORD` and `SEED_BAND_PASSWORD` are read **only** when the
database is first created. The app now refuses to start in production if they
are unset, rather than seeding the defaults that are written down in the repo.
To change a password afterwards, do it in the app — editing `.env` later has no
effect.

## 4a. The AI agent (optional)

**Moonlight → יועץ קמפיינים** asks an AI agent whether the band's ad spend was worth it. It
reaches that agent **over SSH**, not over an HTTP API: the agent is a command-line tool on a
machine where it is already logged in, and the app opens a session, writes the prompt to its
stdin and reads the answer back.

The point is the credential. An API key would have to live in `deploy/.env` and be sent on every
call; instead the app holds an SSH key that opens **one fixed command** on an account that can do
nothing else, and the AI login stays on the agent host where a person put it. Skip this whole
section and the tab reports itself as unconfigured — nothing else changes.

The agent can be any machine reachable from the VM. Running it on the VM itself is the simplest
and the only one that is always up, so that is what follows.

```bash
# On your own machine — a key of its own, so it can be revoked without touching anything else.
ssh-keygen -t ed25519 -f ~/.ssh/am-agent -C 'account-manager-agent' -N ''
ssh-keygen -lf ~/.ssh/am-agent.pub          # note the fingerprint
scp ~/.ssh/am-agent.pub ubuntu@<public-ip>:  # the .pub half only — never the other one
```

The VM side is one script, `deploy/setup-claude-agent.sh`:

```bash
# On the VM, from the checkout in step 4.
cd /opt/account-manager
sudo deploy/setup-claude-agent.sh --pubkey ~ubuntu/am-agent.pub
```

It creates the `aiagent` account, installs Claude Code under it, installs the forced command
(below) as `/home/aiagent/bin/am-agent` owned by root, creates the mode-600 env file the login
token goes in, appends the public key restricted to that one command, and prints the host key to
pin. Re-running it is how you update the wrapper or Claude Code later; nothing it does a second
time disturbs the agent's login. `--skip-install` leaves the CLI alone, `--user` puts the agent
somewhere other than `aiagent`.

Doing it by hand is the same three steps: `adduser --disabled-password --gecos '' aiagent`,
`sudo -u aiagent -H bash -c 'curl -fsSL https://claude.ai/install.sh | bash'` — the native
installer, which publishes a linux-arm64 build for the Ampere shapes and updates itself in the
background — and the `command="…"` line from the script in `/home/aiagent/.ssh/authorized_keys`.

### Log the agent in

This is the one step that cannot be scripted, and the credential the whole SSH shape exists to
keep off the app's side. Claude Code needs a Pro, Max, Team or Enterprise plan.

**A token, for a box nobody watches.** On your own machine, where a browser exists:

```bash
claude setup-token          # prints a one-year OAuth token; it is not saved anywhere
```

Then on the VM, uncomment the line in `/home/aiagent/.config/am-agent/env` and paste it in:

```
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat…
```

It expires a year out with nothing to warn you, so put the date in the calendar the app already
syncs. Nothing else on the VM reads that file — the app's container cannot, and neither can the
`ubuntu` account.

**Or interactively, on the VM**, which leaves the credential in `/home/aiagent/.claude` instead:

```bash
sudo -u aiagent -i
claude                      # press c for the URL, open it on your own machine,
                            # paste the code back at "Paste code here if prompted"
```

The browser cannot reach the VM's callback server over SSH, which is exactly the case that
paste-the-code flow is for. A login made this way expires too, and warns about it at the start of
an interactive session — which on this account nobody ever starts. That is the argument for the
token.

`ANTHROPIC_API_KEY` also works and bills the API rather than the plan; set it in the same env
file if that is what you want. Do not set it by accident, since it outranks the login.

### What the app's key actually runs

`deploy/claude-agent.sh`, installed as `/home/aiagent/bin/am-agent`. sshd runs it in place of
whatever the caller asked for and puts the request in `SSH_ORIGINAL_COMMAND`, which the wrapper
**matches but never executes** — so the two branches below are the entire surface a holder of
that key has:

- a request ending in `--version` runs `claude --version`. This is the probe behind
  **בדיקת חיבור**, and the reason for the wrapper: pinned directly to `claude -p …`, a version
  check instead spends a full analysis on an empty prompt and answers with a parse error a
  minute later.
- anything else pipes stdin — the prompt, as `agentClient.ts` sends it — into
  `claude -p --output-format json --tools "" --strict-mcp-config --no-session-persistence`.

`--tools ""` is the part worth keeping. The advisor's prompts carry campaign names and ad copy
this app collected from Meta, and an agent summarising that text has no business also holding
Bash and Edit on the VM the app runs on; `--strict-mcp-config` with no config keeps a stray MCP
server out of an unattended run for the same reason. The wrapper also caps the prompt at 1 MB
and stops the run at 110 s, under the app's own 120 s ceiling, so an overrun comes back as a
message rather than as a dropped connection.

It is a **copy**, owned by root: a `git pull` on the VM does not change what the key can run, and
the agent account cannot rewrite its own restriction. `sudo deploy/setup-claude-agent.sh` again
is what installs a new version.

### Point the app at it

`setup-claude-agent.sh` prints the host key at the end; `ssh-keyscan -t ed25519 <the-agent-host>`
is the same thing by hand. The rest is filled in **in the app**, at **Settings → סוכן AI** — no
restart, and no private key in a file on the VM:

| Field | Value |
|-------|-------|
| שרת | `host.docker.internal` when the agent runs on the VM itself — the compose file maps that name to the host gateway |
| פורט | `22` |
| משתמש | `aiagent` |
| מפתח פרטי | the contents of `~/.ssh/am-agent` (the half **without** `.pub`), pasted whole |
| מפתח המארח | the `ssh-keyscan` output above, pasted as-is |
| הפקודה | `claude -p --output-format json` |

Leave הפקודה at its default. With a forced command in place it no longer decides what runs — the
wrapper does — and only its first word still matters, as what the probe asks for a version of.

The key is stored encrypted with `secret.key` (or `APP_SECRET_KEY`) rather than in the database
in the clear, and is never sent back to the browser — after saving, the page identifies it by its
fingerprint. **`secret.key` lives in the `am-data` volume beside the database and is covered by
the backup in §5**; restoring the database without it means pasting the key in again.

Setting `AGENT_SSH_*` in `deploy/.env` still works and is the fallback for any field left empty
in that form — useful for provisioning a VM from a script. `AGENT_SSH_KEY` there takes the whole
private key with its newlines written as `\n`:

```bash
awk 'BEGIN{ORS="\\n"} {print}' ~/.ssh/am-agent      # paste the output as AGENT_SSH_KEY=…
```

Then press **בדיקת חיבור** — on the סוכן AI page itself, or in Settings → חיבורים. It opens the
session and asks the agent its version, which tells you which half is broken far faster than a
failed analysis does. A green result and the tab is live.

Two things worth checking once, because they are the difference between this being safe and being
a shell on your VM handed to a web app:

```bash
ssh -i ~/.ssh/am-agent -o IdentitiesOnly=yes aiagent@<host> 'claude --version'
# → a version string: the probe works

ssh -i ~/.ssh/am-agent -o IdentitiesOnly=yes aiagent@<host> 'whoami' </dev/null
# → "am-agent: empty prompt on stdin". A username here means the forced command is missing
#   and that key is a shell on your VM.
```

and that the host key is actually pinned — with it empty the app refuses to connect in
production rather than trusting whoever answers the address. The סוכן AI page says so in as
many words when it is not.

## 4b. Claude Code for yourself on the VM

Separate from the agent account, and worth having: a `claude` you drive by hand on the box is the
fastest way to read logs, unpick a failed deploy or query the database in place. Install it under
your own account, not `aiagent` — that account's login belongs to the app.

```bash
# As ubuntu, on the VM.
curl -fsSL https://claude.ai/install.sh | bash
exec $SHELL -l          # picks up ~/.local/bin
claude                  # press c for the URL, open it on your machine, paste the code back
```

The A1 shape has RAM to spare for this. The 1 GB `E2.1.Micro` fallback from step 1 does not —
there, work from your laptop instead.

Two things to know before you let it loose in `/opt/account-manager`:

- **The deploy workflow does `git reset --hard`** on that checkout (see *Automatic deploys*).
  Tracked edits made there are dropped on the next deploy without asking. Change code on your
  own machine and push; keep the VM checkout for reading and for `docker compose`.
- **This box holds the live invoicing data.** `--dangerously-skip-permissions` is one keystroke
  away from an unreviewed `docker compose down -v`, which is the database. Not here.

### Give it the app's own data, read-only

The app's MCP server (`/mcp`, `app/README.md`) exposes the whole dataset as read-only tools, so
`claude` on the VM can answer questions against the real numbers instead of you pasting them in.
Create a key in **Settings → מפתחות API**, then:

```bash
claude mcp add --transport http account-manager https://im-tools.org/mcp \
  --header "X-API-Key: am_…" --scope user
claude              # /mcp shows the server as connected, or names the HTTP status if not
```

The URL is the public one even from the VM: the container publishes no port, so `im-tools.org`
through the tunnel is the only way in. The key lands in `~/.claude.json` in the clear — revoke it
in the same settings page if the account is ever compromised, and give the VM its own key so
revoking it costs nothing elsewhere.

If Cloudflare Access is in front (§7), `/mcp` needs the bypass policy described there. Without it
Access answers with a 302 to its login page and the server shows as `failed` with an HTML parse
error rather than a clean 401.

## 5. Backups

The whole application state is one file in the `am-data` volume. Losing the VM
without a backup loses your invoicing history.

```bash
sudo apt-get install -y sqlite3 rclone
sudo rclone config     # name: r2, type: s3, provider: Cloudflare,
                       # endpoint: https://<account-id>.r2.cloudflarestorage.com
```

Create an R2 bucket (`account-manager-backups`) and an R2 API token, then:

```bash
chmod +x /opt/account-manager/deploy/backup.sh
sudo crontab -e
# 0 3 * * * /opt/account-manager/deploy/backup.sh >> /var/log/am-backup.log 2>&1
```

Root's crontab, because the docker volume is root-owned.

`backup.sh` uses sqlite3's online `.backup` rather than copying the file —
under WAL a plain `cp` can produce a backup missing recent commits — and runs
`PRAGMA integrity_check` on the result before uploading, so a corrupt copy
fails the job instead of quietly replacing a good backup. R2's free tier is
10 GB with no egress charge; this database is a few MB.

Restore:

```bash
rclone copyto r2:account-manager-backups/account-manager-<stamp>.db.gz /tmp/am.db.gz
gunzip /tmp/am.db.gz
docker compose stop app
docker run --rm -v deploy_am-data:/data -v /tmp:/in alpine \
  sh -c 'rm -f /data/account-manager.db*; cp /in/am.db /data/account-manager.db'
docker compose start app
```

Removing the `-wal` and `-shm` files matters — a stale WAL alongside a restored
database is how a restore quietly half-works.

## 6. Keep the instance from being reclaimed

Oracle reclaims Always Free instances it judges idle. `keepalive.sh` pings the
health endpoint through the tunnel and burns a little CPU every 15 minutes:

```bash
chmod +x /opt/account-manager/deploy/keepalive.sh
crontab -e
# */15 * * * * /opt/account-manager/deploy/keepalive.sh >/dev/null 2>&1
```

## 7. Optional: put Cloudflare Access in front

This app holds your invoicing data behind one password. Zero Trust → Access →
Applications, self-hosted, `im-tools.org`, policy `emails: itamar92@gmail.com` +
the band addresses. Free up to 50 users.

One catch: **exclude `/api/v1` and `/mcp`**, or the `X-API-Key` calls behind them —
the Morning integration and the MCP server that Claude Desktop connects to — will
be intercepted by Access and fail. Add a Bypass policy for those paths, or a
service-token policy if you want them authenticated at the edge too.

**Clients' quote links need the same.** A client opening a quote from WhatsApp or an email has
no Access login, so add a Bypass policy for `/q/*`, `/api/public/*` and `/assets/*` (the page's
script and styles). The alternative is a second public hostname on the same tunnel, such as
`quotes.im-tools.org`, left outside Access, with `PUBLIC_BASE_URL=https://quotes.im-tools.org` in
`.env` so the links the app writes point there.

The symptom is specific and worth recognising: Access answers an unauthenticated
request with a **302 to its login page**, so the caller sees HTML where it expected
JSON rather than a clean 401. In Claude Desktop that surfaces as the connector
failing to start with a parse error, not as an auth error.

## Updating

```bash
cd /opt/account-manager && git pull
cd deploy && docker compose up -d --build
```

The database is in a named volume, untouched by rebuilds.

## Automatic deploys

`.github/workflows/deploy.yml` runs exactly that update over SSH when `master`
changes something the image is built from — `app/`, `deploy/`, `invoices_2026.csv`
or the workflows themselves. A commit touching only the Python scripts, the JSON
ledgers or the docs does not redeploy. **Run workflow** on the Actions tab
redeploys the current `master` on demand.

It typechecks and builds the commit first (the same job every pull request runs),
then on the VM resets to that exact commit — not to whatever `master` has become —
rebuilds, and waits for the container's own healthcheck. A container that never
reports healthy fails the run with the last 80 log lines, so a bad deploy is loud
rather than silent. `reset --hard` drops *tracked* local edits on the VM and
leaves untracked files alone, so `deploy/.env` survives.

### The four secrets

A deploy key first — its own key, not your personal one, so it can be revoked
without locking you out.

**Run these on your own machine, not on the VM** — all three are client-side, and
a private key has no business living on the server it unlocks. `<public-ip>` is
the VM's from step 1.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/am-deploy -C 'github-actions@account-manager' -N ''

# Logs in with your existing access and appends the new public key over there.
# Add -o IdentityFile=~/path/to/oracle-key if that access is not a default key.
ssh-copy-id -i ~/.ssh/am-deploy.pub ubuntu@<public-ip>

# Asks the VM for its host keys and prints them — copy the output into the
# DEPLOY_KNOWN_HOSTS secret. Do not redirect it into your own known_hosts.
ssh-keyscan -t ed25519,rsa <public-ip>
```

No `ssh-copy-id` on your platform? The same thing by hand — **as one command, from
your machine**. The `< ~/.ssh/am-deploy.pub` on the last line is what feeds the
`cat`; run the quoted part on the VM instead and it hangs waiting for you to type
the key in.

```bash
ssh -i ~/path/to/oracle-key ubuntu@<public-ip> \
  'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys' \
  < ~/.ssh/am-deploy.pub
```

Or, if you already have a session open on the VM, paste the key over there.
`cat ~/.ssh/am-deploy.pub` on your machine prints one line; on the VM:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo 'ssh-ed25519 AAAA… github-actions@account-manager' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
tail -2 ~/.ssh/authorized_keys        # the new line, and your existing one still there
```

Keep the quotes and keep it on one line — a line break in the middle of the key
makes it invalid. The **public** key only: `~/.ssh/am-deploy` without the `.pub`
is the private half, and it belongs in the `DEPLOY_SSH_KEY` secret and nowhere
else, least of all on the machine it unlocks.

Then check the new key opens the door the way the workflow will use it:

```bash
ssh -i ~/.ssh/am-deploy -o IdentitiesOnly=yes ubuntu@<public-ip> 'whoami; id -nG; docker compose version'
```

`ubuntu`, a group list containing `docker`, a compose version, and no prompt. A
passphrase prompt means the key needs regenerating with `-N ''` — nothing can
type one in Actions.

`ssh-keyscan` pins whatever answers it, so on a box you already trust a session
to, it is worth confirming what you pinned: run
`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the VM and check the
fingerprint against `ssh-keygen -lf -` fed the keyscan output.

Then in **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|--------|-------|
| `DEPLOY_HOST` | the VM's public IP (or a DNS name pointing at it) |
| `DEPLOY_SSH_KEY` | the whole of `~/.ssh/am-deploy` — the **private** key, `BEGIN`/`END` lines included. It must have no passphrase; nothing can type one |
| `DEPLOY_KNOWN_HOSTS` | the `ssh-keyscan` output, verbatim |
| `DEPLOY_USER` | *optional* — defaults to `ubuntu` |

`DEPLOY_KNOWN_HOSTS` is what makes this safe to run unattended: the host keys are
pinned, so a hijacked DNS record or a changed IP gets a refused connection instead
of the deploy key. `StrictHostKeyChecking=no` would hand the key to whoever
answered. If you rebuild the VM, re-run `ssh-keyscan` and update the secret.

The user needs to be in the `docker` group (step 2 does that) and
`/opt/account-manager` must already be the clone from step 4 — the workflow
updates a checkout, it does not create one.

To require a human click before each deploy, add a required reviewer to the
`production` environment under **Settings → Environments**; the workflow already
deploys into it.

## Notes

- **Secrets live only in `deploy/.env`** on the VM (git-ignored, `chmod 600`).
  The Google refresh token and Morning API secret are both there. The one
  exception is the agent's AI login, which lives in
  `/home/aiagent/.config/am-agent/env` (mode 600, and unreadable by the app's
  container) — §4a says why it is kept over there.
- **The Python `scripts/`** (`collect_bills.py` etc.) are not part of this
  deployment and shouldn't be. They drive Playwright through interactive utility
  logins with 2FA — they belong on your laptop.
- **Egress**: Always Free includes 10 TB/month. Not a consideration here.
- **`docker compose logs -f app`** is the first place to look; the seed and both
  integrations log their configuration status on startup.
