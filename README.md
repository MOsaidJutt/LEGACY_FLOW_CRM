# Legacy Flow

Calling CRM for Lone Star Legacy, built by Nuvforge. Next.js 16 (App Router, TypeScript), Drizzle ORM, PostgreSQL (Neon in production, embedded PGlite for local development), Tailwind CSS 4.

## What is in it

| Area | Where |
| --- | --- |
| Sign-in, sessions, roles and permissions | `src/lib/auth`, `src/proxy.ts`, Admin > Users / Roles |
| Lead import (dynamic Excel columns, duplicates, missing data, U.S. phone format, error report) | `src/lib/leads/import.ts`, Management > Imports |
| Lead requests with 5-minute auto-assignment, locking, logout return, manual assign/transfer/release | `src/lib/leads/assignment.ts`, Management > Lead requests / Leads |
| Agent calling workspace, dispositions, callbacks, do-not-call protection | `src/lib/leads/calls.ts`, `src/app/(app)/agent` |
| Dialer (clipboard fallback, click-to-call URL, VC Dialer API slot + webhook) | `src/lib/dialer`, `src/app/api/dialer/webhook`, Admin > Dialer |
| Activity monitoring (screen, active, idle after 5 min, breaks) and the Windows desktop agent | `src/lib/monitoring`, `public/desktop-agent`, Admin > Workstations |
| Management dashboard, agent drill-down, attendance and punctuality | `src/app/(app)/manage`, `src/lib/metrics.ts`, `src/lib/attendance.ts` |
| Reports (daily, weekly, 15-day, monthly, custom, punctuality, lead source), Excel and PDF, saved and approved copies, Management Scores | `src/lib/reports.ts`, Management > Reports / Performance |
| HR portal (profiles, documents, history, leave, holidays) | `src/app/(app)/hr` |
| Messages, groups, announcements, notifications | `src/lib/messages.ts`, `src/app/(app)/messages` |
| Audit log | `src/lib/audit.ts`, Admin > Audit log |

## Local development

```bash
npm install
npm run setup          # migrations + base data into ./.data/pglite (prints the first admin password)
npm run db:demo        # optional: demo agents (password LegacyFlow-2026) and 360 sample leads
npm run dev            # http://localhost:3000
```

PGlite allows one process at a time: stop `npm run dev` before running `db:*` scripts. With `DATABASE_URL` set in `.env.local` everything runs against that Postgres instead.

Schema changes: edit `src/db/schema.ts`, run `npm run db:generate`, commit the new file in `drizzle/`, then `npm run db:migrate`.

## Environment

See `.env.example`. Both production hosts must share the same `DATABASE_URL`, `CRON_SECRET` and `APP_URL`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon connection string (pooled `-pooler` host for the app). Required in production. |
| `CRON_SECRET` | Bearer token for `/api/cron/tick`. |
| `APP_URL` | Public URL, used in notifications, the dialer webhook address and desktop agent commands. |
| `DIALER_WEBHOOK_SECRET` | Bearer token VC Dialer must send to `/api/dialer/webhook`. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | First admin created by `npm run db:seed`. |

## Production

The app is stateless: sessions, files and background state live in the database, so any number of hosts can serve it at once against the same Neon database.

### Primary: VPS

```bash
# Ubuntu 24.04, Node 20+ (Node 24 recommended), nginx, certbot, pm2, postgresql-client-17
git clone <repo> /opt/legacy-flow && cd /opt/legacy-flow
cp .env.example .env.production   # fill in DATABASE_URL, CRON_SECRET, APP_URL, DIALER_WEBHOOK_SECRET
set -a; source .env.production; set +a
npm ci && npm run db:migrate && npm run db:seed && npm run build
pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup
# nginx: deploy/nginx.conf, then certbot --nginx -d <domain>
```

Crontab on the VPS:

```cron
* * * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/tick > /dev/null
15 3 * * * /opt/legacy-flow/deploy/backup.sh >> /var/log/legacy-flow/backup.log 2>&1
```

### Secondary: serverless Next.js platform

Deploy the same repository with the same environment variables (Node runtime, default build command `next build`). Point a second hostname at it and use DNS failover or a health-checked load balancer in front of both hosts. The 5-minute auto-assignment also runs on every browser heartbeat, so it keeps working even if the VPS cron is down; for full redundancy add a second external scheduler that calls `/api/cron/tick` every minute on the secondary hostname (jobs are idempotent and lock rows, so double calls are harmless).

Uploads go through route handlers; keep lead files under the platform's request-size limit (typically 4.5 MB) or upload large files through the VPS hostname.

### Updates

```bash
git pull && npm ci && npm run db:migrate && npm run build && pm2 reload legacy-flow
```

Run migrations once (from the VPS) before deploying the secondary.

## Backups

- Neon keeps point-in-time history for the configured retention window.
- `deploy/backup.sh` takes a nightly `pg_dump` to the separate backup server and keeps 30 days. Restore with `pg_restore` into an empty database, then point `DATABASE_URL` at it.

## Security notes

- Passwords are bcrypt-hashed; session tokens are random 256-bit values stored only as SHA-256 hashes; cookies are httpOnly, SameSite=Lax and Secure in production.
- Every page, route handler and server action re-checks the session and permission server-side; `src/proxy.ts` is only a redirect shortcut.
- Sign-in is rate-limited per email (8 failures per 15 minutes) and every sign-in, failure and change is written to the audit log.
- HR documents and message attachments are only served after a permission / membership check, with `Content-Disposition: attachment`.
