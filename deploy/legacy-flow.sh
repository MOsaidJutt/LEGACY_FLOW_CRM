#!/usr/bin/env bash
# Legacy Flow service control. Installed on the VPS as /usr/local/bin/legacy-flow
#
#   legacy-flow suspend   stop the app; every visitor gets the notice page (HTTP 503)
#   legacy-flow resume    start the app; the site works again
#   legacy-flow status    show what is running
#   legacy-flow logs      tail the application log
#   legacy-flow update    pull the latest code, rebuild and restart
#
# The state survives reboots: the flag file keeps nginx serving the notice page and
# the saved pm2 state keeps the app stopped. No data is deleted either way.
set -euo pipefail

APP_DIR=/opt/legacy-flow
FLAG="$APP_DIR/.suspended"

reload_nginx() { nginx -t >/dev/null 2>&1 && systemctl reload nginx; }

case "${1:-status}" in
  suspend)
    touch "$FLAG"
    pm2 stop legacy-flow >/dev/null 2>&1 || true
    pm2 save >/dev/null 2>&1 || true
    reload_nginx
    echo "SUSPENDED. The app is stopped and every visitor sees the notice page."
    ;;
  resume)
    rm -f "$FLAG"
    pm2 start "$APP_DIR/deploy/ecosystem.config.cjs" >/dev/null 2>&1 || pm2 restart legacy-flow >/dev/null
    pm2 save >/dev/null 2>&1 || true
    reload_nginx
    sleep 2
    echo "LIVE. Local check: HTTP $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login)"
    ;;
  status)
    if [ -f "$FLAG" ]; then echo "state:   SUSPENDED (notice page)"; else echo "state:   LIVE"; fi
    echo "app:     $(pm2 jlist 2>/dev/null | grep -o '"status":"[a-z]*"' | head -1 | cut -d'"' -f4 || echo unknown)"
    echo "nginx:   $(systemctl is-active nginx)"
    echo "db:      $(systemctl is-active postgresql)"
    echo "public:  HTTP $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/login)"
    ;;
  logs)
    tail -n "${2:-50}" -f /var/log/legacy-flow/out.log
    ;;
  update)
    cd "$APP_DIR"
    git pull --ff-only
    npm ci --no-audit --no-fund
    set -a; . "$APP_DIR/.env.production"; set +a
    npm run db:migrate
    NODE_ENV=production npm run build
    pm2 restart legacy-flow --update-env
    echo "updated."
    ;;
  *)
    echo "usage: legacy-flow {suspend|resume|status|logs|update}" >&2
    exit 64
    ;;
esac
