#!/usr/bin/env bash
# Back up the SQLite database to Cloudflare R2.
#
# Uses sqlite3's online .backup rather than copying the file, because the
# database runs in WAL mode — a plain cp can capture a main file whose most
# recent commits still live in the -wal, producing a backup that silently
# loses them.
#
# Runs as root (the docker volume is root-owned), so install it in root's
# crontab:
#
#   sudo apt-get install -y sqlite3 rclone
#   sudo rclone config     # remote "r2", type s3, provider Cloudflare
#   sudo crontab -e
#   0 3 * * * /opt/account-manager/deploy/backup.sh >> /var/log/am-backup.log 2>&1

set -euo pipefail

RCLONE_REMOTE="${RCLONE_REMOTE:-r2}"
R2_BUCKET="${R2_BUCKET:-account-manager-backups}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"
VOLUME="${VOLUME:-deploy_am-data}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# Ask docker where the volume actually lives rather than hardcoding a path
# under /var/lib/docker, which is not guaranteed.
MOUNT="$(docker volume inspect --format '{{ .Mountpoint }}' "$VOLUME")"
DB="${MOUNT}/account-manager.db"

[ -f "$DB" ] || { echo "[backup] no database at $DB" >&2; exit 1; }

sqlite3 "$DB" ".backup '${WORKDIR}/account-manager.db'"

# Prove the copy is a valid database before it goes anywhere. A backup that is
# only discovered to be corrupt at restore time is not a backup.
sqlite3 "${WORKDIR}/account-manager.db" 'PRAGMA integrity_check;' | grep -qx 'ok'

gzip -9 "${WORKDIR}/account-manager.db"
gzip -t "${WORKDIR}/account-manager.db.gz"

rclone copyto \
  "${WORKDIR}/account-manager.db.gz" \
  "${RCLONE_REMOTE}:${R2_BUCKET}/account-manager-${STAMP}.db.gz"

# R2's free tier is 10 GB. This database is a few MB, but unbounded daily
# backups still add up over years.
rclone delete --min-age "${RETAIN_DAYS}d" "${RCLONE_REMOTE}:${R2_BUCKET}"

echo "[backup] ${STAMP} ok"
