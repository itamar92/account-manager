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

## Notes

- **Secrets live only in `deploy/.env`** on the VM (git-ignored, `chmod 600`).
  The Google refresh token and Morning API secret are both there.
- **The Python `scripts/`** (`collect_bills.py` etc.) are not part of this
  deployment and shouldn't be. They drive Playwright through interactive utility
  logins with 2FA — they belong on your laptop.
- **Egress**: Always Free includes 10 TB/month. Not a consideration here.
- **`docker compose logs -f app`** is the first place to look; the seed and both
  integrations log their configuration status on startup.
