#!/usr/bin/env bash
#
# ci-nightly-integration.sh
#
# Runs the gated integration + smoke suites that the normal
# `npm run ci` / `ci:quick` path deliberately skips because they hit
# live dependencies:
#
#   1. src/services/attendance/__tests__/reconcileSql.integration.test.ts
#        — live EXPLAIN of every reconcile SQL template against the
#          Supabase schema. Catches schema drift (cf. PR #1400 which
#          shipped a bad JOIN column that only surfaced at cron time).
#
#   2. src/services/tracking/cartrack/__tests__/smoke.test.ts
#        — live round-trip against the Cartrack tenant. Catches
#          credential drift, base-URL changes, or tenant outages.
#
# Scheduled via crontab on the Velocity server at 03:30 SAST (15 min
# after the cartrack-reconcile cron at 03:00). If either suite fails,
# the script exits non-zero — cron's MAILTO / downstream WhatsApp
# alert cron picks up the failure.
#
# Usage (manual):
#   bash scripts/ci-nightly-integration.sh
#
# Usage (cron, installed on velo):
#   30 3 * * * /home/velo/fibreflow-dev/scripts/ci-nightly-integration.sh \
#     >> /home/velo/logs/ci-nightly-integration.log 2>&1
#
# Idempotent + read-only. The integration suite uses EXPLAIN (no
# writes) and the smoke suite issues GET requests only.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Env loading — read the same .env.local the dev service uses so we hit the
# same Supabase instance + Cartrack tenant the nightly reconcile cron does.
# ---------------------------------------------------------------------------

ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.local}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi

TS() { date --iso-8601=seconds; }
log() { printf '[%s] %s\n' "$(TS)" "$*"; }

log "starting nightly integration suite"
log "  DATABASE_URL host: $(echo "${DATABASE_URL:-unset}" | sed -E 's|^[^@]+@([^/]+).*|\1|')"
log "  CARTRACK_BASE_URL: ${CARTRACK_BASE_URL:-unset}"

# Integration test needs a separate env var because vitest.setup.ts
# forcibly overwrites DATABASE_URL to a dummy value.
export SUPABASE_INTEGRATION_TEST=true
export SUPABASE_INTEGRATION_DB_URL="${SUPABASE_INTEGRATION_DB_URL:-${DATABASE_URL:-}}"

# Cartrack smoke needs the live creds to be set AND the gate flipped.
export CARTRACK_SMOKE_TEST=true

FAILED=0

# ---------------------------------------------------------------------------
# 1. reconcile SQL integration suite
# ---------------------------------------------------------------------------

if [ -z "${SUPABASE_INTEGRATION_DB_URL:-}" ]; then
  log "SKIP reconcile integration: SUPABASE_INTEGRATION_DB_URL not set"
else
  log "running reconcile SQL integration suite..."
  if npx vitest run \
       src/services/attendance/__tests__/reconcileSql.integration.test.ts \
       2>&1 | sed "s/^/  [reconcile-sql] /"; then
    log "reconcile integration: PASS"
  else
    log "reconcile integration: FAIL"
    FAILED=1
  fi
fi

# ---------------------------------------------------------------------------
# 2. cartrack smoke
# ---------------------------------------------------------------------------

if [ -z "${CARTRACK_BASE_URL:-}" ] || \
   [ -z "${CARTRACK_API_USER:-}" ] || \
   [ -z "${CARTRACK_API_PASS:-}" ]; then
  log "SKIP cartrack smoke: CARTRACK_BASE_URL / CARTRACK_API_USER / CARTRACK_API_PASS not all set"
else
  log "running cartrack smoke suite..."
  if npx vitest run \
       src/services/tracking/cartrack/__tests__/smoke.test.ts \
       2>&1 | sed "s/^/  [cartrack-smoke] /"; then
    log "cartrack smoke: PASS"
  else
    log "cartrack smoke: FAIL"
    FAILED=1
  fi
fi

# ---------------------------------------------------------------------------
# Exit status — cron MAILTO picks up non-zero. Keep the "done" line so
# the log always has a single-line summary ops can grep for.
# ---------------------------------------------------------------------------

if [ "$FAILED" -eq 0 ]; then
  log "done (all suites passed)"
  exit 0
else
  log "done (one or more suites FAILED — review log above)"
  exit 1
fi
