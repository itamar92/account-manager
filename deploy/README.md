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

One catch: **exclude `/api/v1`**, or the Morning integration's `X-API-Key` calls
will be intercepted by Access and fail. Add a Bypass policy for that path, or a
service-token policy if you want it authenticated at the edge too.

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

### From Windows

PowerShell strips `''` before `ssh-keygen` sees it, so `-N ''` fails with
*option requires an argument*. Leave the flag off and press Enter twice, or
write the empty argument as `-N '""'`:

```powershell
New-Item -ItemType Directory -Force -Path $HOME\.ssh | Out-Null
ssh-keygen -t ed25519 -f $HOME\.ssh\am-deploy -C "github-actions@account-manager"
Get-Content $HOME\.ssh\am-deploy.pub     # copy this line, paste it on the VM
```

There is no `ssh-copy-id` in Windows OpenSSH, and piping the key over with
`Get-Content | ssh` appends CRLF line endings — copy and paste the line instead.
If ssh refuses the key with *UNPROTECTED PRIVATE KEY FILE*, narrow the ACL:
`icacls $HOME\.ssh\am-deploy /inheritance:r /grant:r "$($env:USERNAME):(R)"`.

`Set-Clipboard` fills the secrets without a round trip through an editor:

```powershell
Get-Content -Raw $HOME\.ssh\am-deploy | Set-Clipboard        # DEPLOY_SSH_KEY
ssh-keyscan -t ed25519,rsa <public-ip> | Set-Clipboard       # DEPLOY_KNOWN_HOSTS
```

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

**If `ssh-keyscan` fails** with `choose_kex: unsupported KEX method
sntrup761x25519-sha512@openssh.com` and prints no keys — Windows OpenSSH against
Ubuntu 24.04 does this, because `ssh-keyscan` takes the server's first-proposed
KEX instead of negotiating one both ends know — read the keys off the VM instead.
It is the better source anyway, being the server's own copy rather than whatever
answered the address:

```bash
cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_rsa_key.pub \
  | sed 's/^/<public-ip> /'
```

Two lines of three fields — host, key type, key — which is the `known_hosts`
format the secret wants. The host must match `DEPLOY_HOST` exactly: an entry for
the IP does not authenticate a connection made to a DNS name, or the reverse.
(Ordinary `ssh` is unaffected by this bug; it negotiates properly.)

No loop and no `$( )` in that pipeline, so it can be handed to the VM from a
PowerShell prompt as one line rather than typed over there:

```powershell
ssh ubuntu@<public-ip> "cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_rsa_key.pub | sed 's/^/<public-ip> /'"
```

More generally: `for … do … done`, `$( )`, `~/` and `cat >>` are bash, and belong
in a session on the VM. PowerShell has its own `for` syntax and expands `$( )`
itself before `ssh` is ever invoked.

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
  The Google refresh token and Morning API secret are both there.
- **The Python `scripts/`** (`collect_bills.py` etc.) are not part of this
  deployment and shouldn't be. They drive Playwright through interactive utility
  logins with 2FA — they belong on your laptop.
- **Egress**: Always Free includes 10 TB/month. Not a consideration here.
- **`docker compose logs -f app`** is the first place to look; the seed and both
  integrations log their configuration status on startup.
