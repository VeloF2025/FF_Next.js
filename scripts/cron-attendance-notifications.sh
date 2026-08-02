#!/usr/bin/env bash
# Idempotent attendance notification launcher. This change does not install or
# enable cron/systemd scheduling; that remains an operations approval step.
set -euo pipefail

PHASE="${1:-}"
case "$PHASE" in
  morning|clockout|digest|weekly) ;;
  *) echo "Usage: $0 morning|clockout|digest|weekly" >&2; exit 2 ;;
esac

DEPLOY_ENV="${FF_ATTENDANCE_DEPLOY_ENV:-local}"
case "$DEPLOY_ENV" in
  production)
    PROJECT_DIR="/home/velo/fibreflow-production"
    DEFAULT_ENV_FILE="$PROJECT_DIR/.env.local"
    DEFAULT_LOCK_FILE="/home/velo/logs/attendance-notifications-${PHASE}.lock"
    ;;
  dev)
    PROJECT_DIR="/home/velo/fibreflow-dev"
    DEFAULT_ENV_FILE="$PROJECT_DIR/.env.local"
    DEFAULT_LOCK_FILE="/home/velo/logs/attendance-notifications-${PHASE}-dev.lock"
    ;;
  local)
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
    DEFAULT_ENV_FILE="$PROJECT_DIR/.env.local"
    DEFAULT_LOCK_FILE="/tmp/fibreflow-attendance-notifications-$(id -u)-${PHASE}.lock"
    ;;
  *) echo "Invalid FF_ATTENDANCE_DEPLOY_ENV" >&2; exit 2 ;;
esac

ENV_FILE="${FF_ATTENDANCE_ENV_FILE:-$DEFAULT_ENV_FILE}"
TSX_BIN="${FF_ATTENDANCE_TSX_BIN:-$PROJECT_DIR/node_modules/.bin/tsx}"
LOCK_FILE="${FF_ATTENDANCE_LOCK_FILE:-$DEFAULT_LOCK_FILE}"
ENTRY="$PROJECT_DIR/scripts/cron/attendance-notifications.ts"

for path in "$PROJECT_DIR" "$ENV_FILE" "$TSX_BIN" "$LOCK_FILE" "$ENTRY"; do
  case "$path" in /*) ;; *) echo "Attendance notification paths must be absolute" >&2; exit 2 ;; esac
done
if [[ ! -r "$ENV_FILE" || ! -x "$TSX_BIN" || ! -r "$ENTRY" ]]; then
  echo "Attendance notification runtime is unavailable" >&2
  exit 2
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Attendance notification phase ${PHASE} is already running"
  exit 0
fi

cd "$PROJECT_DIR"
export FF_ATTENDANCE_ENV_FILE="$ENV_FILE"
exec "$TSX_BIN" "$ENTRY" "--phase=$PHASE"
