#!/usr/bin/env bash
#
# Nightly wrapper for scripts/sync-qfield-status-to-ff.py — mirrors the QField
# civil-audit pole "Status" into poles.field_status for the Works QA PON-overview
# funnel (planned → planted → QA'd).
#
# Installed on velo as a crontab entry (~00:45 SAST, after the 23:15 OES→QField
# sync settles). Lives in the repo so it deploys to both fibreflow-dev and
# fibreflow-production; the cron invokes the dev-dir copy. It resolves DATABASE_URL
# from the deploy dir it lives in, so it is dir-agnostic (dev or prod).
#
# DATABASE_URL resolution order (first hit wins, never clobbers an inherited value):
#   inherited $DATABASE_URL → .env.local → .env.production → .env
# The python script reads DATABASE_URL from the environment; it is exported here.
#
set -euo pipefail

# Deploy-dir root = two levels up from scripts/cron/.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Guarded reader: always returns 0 (empty or value) so a missing file / no-match
# grep never aborts under `set -e`. See feedback_cron_dburl_env_layout.
env_value() { { [ -f "$1" ] && grep "^$2=" "$1" | head -1 | cut -d= -f2- | tr -d "\"'"; } || true; }

if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="$(env_value "$ROOT/.env.local" DATABASE_URL)"
  [ -z "$DATABASE_URL" ] && DATABASE_URL="$(env_value "$ROOT/.env.production" DATABASE_URL)"
  [ -z "$DATABASE_URL" ] && DATABASE_URL="$(env_value "$ROOT/.env" DATABASE_URL)"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[$(date '+%F %T %Z')] ERROR: DATABASE_URL not resolvable from $ROOT/.env*" >&2
  exit 1
fi
export DATABASE_URL

echo "===== sync-qfield-status $(date '+%F %T %Z') (root=$ROOT) ====="
cd "$ROOT"
exec /usr/bin/python3 scripts/sync-qfield-status-to-ff.py "$@"
