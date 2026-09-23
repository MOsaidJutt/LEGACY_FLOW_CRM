#!/usr/bin/env bash
# Nightly logical backup of the Neon database to the backup server (30-day retention).
# crontab on the VPS:   15 3 * * *  /opt/legacy-flow/deploy/backup.sh >> /var/log/legacy-flow/backup.log 2>&1
# Needs: postgresql-client (pg_dump 17), ssh key access to the backup server.
set -euo pipefail

source /opt/legacy-flow/.env.production          # provides DATABASE_URL (use the direct, non-pooler host)
BACKUP_HOST="${BACKUP_HOST:-backup@backup.example.com}"
BACKUP_DIR="${BACKUP_DIR:-/srv/backups/legacy-flow}"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
FILE="/tmp/legacy-flow-${STAMP}.dump"

pg_dump --format=custom --no-owner --no-privileges "${DATABASE_URL}" --file "${FILE}"
scp -q "${FILE}" "${BACKUP_HOST}:${BACKUP_DIR}/"
rm -f "${FILE}"
ssh "${BACKUP_HOST}" "find '${BACKUP_DIR}' -name 'legacy-flow-*.dump' -mtime +30 -delete"
echo "${STAMP} backup ok"

# Restore (into an empty database):
#   pg_restore --no-owner --no-privileges --dbname "<target url>" legacy-flow-<stamp>.dump
