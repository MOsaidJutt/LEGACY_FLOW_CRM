#!/usr/bin/env bash
# Nightly logical backup of the Legacy Flow database (30-day retention).
# crontab on the VPS:   15 3 * * *  /opt/legacy-flow/deploy/backup.sh >> /var/log/legacy-flow/backup.log 2>&1
# Needs: postgresql-client. Set BACKUP_HOST in the environment to also copy each dump off the server.
set -euo pipefail

set -a
source /opt/legacy-flow/.env.production          # provides DATABASE_URL
set +a
BACKUP_DIR="${BACKUP_DIR:-/var/backups/legacy-flow}"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
FILE="${BACKUP_DIR}/legacy-flow-${STAMP}.dump"

mkdir -p "${BACKUP_DIR}"
pg_dump --format=custom --no-owner --no-privileges "${DATABASE_URL}" --file "${FILE}"

# Optional off-server copy (the backup server that comes with the Monthly Service Plan).
if [ -n "${BACKUP_HOST:-}" ]; then
    scp -q "${FILE}" "${BACKUP_HOST}:${REMOTE_BACKUP_DIR:-/srv/backups/legacy-flow}/"
    ssh "${BACKUP_HOST}" "find '${REMOTE_BACKUP_DIR:-/srv/backups/legacy-flow}' -name 'legacy-flow-*.dump' -mtime +30 -delete"
fi

find "${BACKUP_DIR}" -name 'legacy-flow-*.dump' -mtime +30 -delete
echo "${STAMP} backup ok ($(du -h "${FILE}" | cut -f1))"

# Restore (into an empty database):
#   pg_restore --no-owner --no-privileges --dbname "<target url>" legacy-flow-<stamp>.dump
