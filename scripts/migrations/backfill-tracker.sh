#!/usr/bin/env bash
# =============================================================================
# backfill-tracker.sh — Reconcile schema_migrations with reality.
# =============================================================================
# When schema_migrations drifts (e.g. migrations were applied directly via
# psql, or the tracker was reset), `run-pending-migrations.sh` re-attempts
# every "missing" file from the start and fails on the first
# non-idempotent statement (CREATE TABLE, CREATE INDEX without IF NOT
# EXISTS, etc.).
#
# This helper:
#   1. Lists every .sql migration on disk under scripts/migrations/sql/
#   2. Compares against the tracker
#   3. Reports the diff (--dry-run by default — no writes)
#   4. With --apply, inserts every missing filename into schema_migrations
#      (does NOT execute any SQL — the assumption is the schema is already
#      where you want it; this just records that fact)
#
# WHEN to use this:
#   - After manually applying a migration via `psql -f ...`
#   - After restoring from a snapshot that included a stale tracker
#   - One-time, to rescue a tracker that's far behind reality
#
# WHEN NOT to use this:
#   - If you have unknown pending migrations — run them properly first
#   - If you don't know whether a migration was applied — verify by hand
#
# Usage:
#   bash scripts/migrations/backfill-tracker.sh             # dry-run
#   bash scripts/migrations/backfill-tracker.sh --apply     # write
#
# Exit codes:
#   0 — up-to-date (tracker matches disk) or successfully backfilled
#   1 — dry-run found drift (informational, exit non-zero so CI flags it)
#   2 — misconfigured (no DATABASE_URL, no migration dir)
# =============================================================================

set -euo pipefail

MIGRATION_DIR="${MIGRATION_DIR:-scripts/migrations/sql}"
APPLY=false

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    --dry-run) APPLY=false ;;
    -h|--help)
      head -40 "$0" | sed 's/^# //; s/^#//'
      exit 0
      ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# --- Load connection string from .env.local/.env (same logic as runner) ---
for env_file in .env.local .env; do
  if [[ -f "$env_file" ]]; then
    if [[ -z "${MIGRATION_URL:-}" ]]; then
      MIGRATION_URL=$(grep -E '^MIGRATION_DATABASE_URL=' "$env_file" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
    fi
    if [[ -z "${DATABASE_URL:-}" ]]; then
      DATABASE_URL=$(grep -E '^DATABASE_URL=' "$env_file" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
    fi
  fi
done

PGURL="${MIGRATION_URL:-${DATABASE_URL:-}}"
if [[ -z "$PGURL" ]]; then
  echo "ERROR: MIGRATION_DATABASE_URL or DATABASE_URL must be set" >&2
  exit 2
fi
if [[ ! -d "$MIGRATION_DIR" ]]; then
  echo "No migration dir at $MIGRATION_DIR" >&2
  exit 2
fi

# --- Ensure tracker exists (idempotent) ---
psql "$PGURL" -v ON_ERROR_STOP=1 -q << 'SQL' > /dev/null
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL

# --- Read both lists ---
# Exclude rollback_*.sql — those are downgrade scripts, NEVER applied
# during a forward run, so they shouldn't appear in schema_migrations
# either.
ON_DISK=$(ls "$MIGRATION_DIR"/*.sql 2>/dev/null | xargs -n1 basename | grep -v '^rollback_' | sort)
APPLIED=$(psql "$PGURL" -t -A -c "SELECT filename FROM schema_migrations ORDER BY filename;" 2>/dev/null)

# --- Diff ---
MISSING=$(comm -23 <(echo "$ON_DISK") <(echo "$APPLIED"))
EXTRA=$(comm -13 <(echo "$ON_DISK") <(echo "$APPLIED"))

if [[ -z "$MISSING" && -z "$EXTRA" ]]; then
  echo "schema_migrations is in sync with $MIGRATION_DIR (nothing to do)"
  exit 0
fi

if [[ -n "$EXTRA" ]]; then
  echo "Tracker has files NOT on disk (probably moved/renamed migrations):"
  echo "$EXTRA" | sed 's/^/  - /'
  echo ""
fi

if [[ -n "$MISSING" ]]; then
  echo "On disk but NOT in tracker (would be re-applied by run-pending-migrations.sh):"
  echo "$MISSING" | sed 's/^/  + /'
  echo ""
fi

if [[ "$APPLY" != "true" ]]; then
  echo "Re-run with --apply to record the on-disk filenames in schema_migrations."
  echo "(This does NOT execute any SQL — it only marks the migrations as applied.)"
  exit 1
fi

# --- Apply: insert missing rows, ON CONFLICT DO NOTHING ---
COUNT=0
while IFS= read -r fname; do
  [[ -z "$fname" ]] && continue
  psql "$PGURL" -v ON_ERROR_STOP=1 -q \
    -c "INSERT INTO schema_migrations (filename) VALUES ('$fname') ON CONFLICT DO NOTHING;" \
    > /dev/null
  echo "  recorded $fname"
  COUNT=$((COUNT + 1))
done <<< "$MISSING"

echo "Backfilled $COUNT row(s) into schema_migrations."
echo "Re-run scripts/run-pending-migrations.sh to confirm 0 pending."
