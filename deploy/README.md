# Running Legacy Flow on the VPS

The app lives in `/opt/legacy-flow`, runs under pm2 behind nginx, and stores its data in
PostgreSQL on the same server. Secrets are in `/opt/legacy-flow/.env.production` (chmod 600).

## Day-to-day

```bash
legacy-flow status     # what is running, and whether the site is live or suspended
legacy-flow suspend    # stop the app; every visitor gets the notice page (HTTP 503)
legacy-flow resume     # start the app again
legacy-flow logs       # tail the application log
legacy-flow update     # pull the latest code, rebuild and restart
legacy-flow ssl        # issue the HTTPS certificate (DNS must point here first)
```

Suspend and resume survive a reboot: the flag file `/opt/legacy-flow/.suspended` keeps nginx
serving the notice page, and the saved pm2 state keeps the app stopped. Nothing is deleted,
so resuming brings the site back exactly as it was.

## What is installed

| Piece | Where |
|---|---|
| Application | `/opt/legacy-flow`, pm2 process `legacy-flow` on port 3000 |
| Web server | nginx, site `/etc/nginx/sites-available/legacy-flow` |
| Notice page | `/var/www/legacy-flow-suspended/index.html` |
| Database | PostgreSQL 16, database and role `legacyflow` |
| Backups | `/var/backups/legacy-flow`, nightly at 03:15 UTC, 30 days kept |
| Background jobs | cron calls `/api/cron/tick` every minute |
| Firewall | ufw: SSH, 80, 443 |

## Restoring a backup

```bash
pg_restore --no-owner --no-privileges --dbname "$DATABASE_URL" \
  /var/backups/legacy-flow/legacy-flow-<stamp>.dump
```
