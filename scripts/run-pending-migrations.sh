#!/usr/bin/env bash
# =============================================================================
# run-pending-migrations.sh — Apply new SQL migrations to the target DB
# =============================================================================
# Scans scripts/migrations/sql/*.sql, applies files not yet recorded in the
# schema_migrations tracker table. Safe to run repeatedly — already-applied
# migrations are skipped.
#
# Usage: run from inside a deploy dir (dev or prod), DATABASE_URL in .env.local
#
# Exit codes:
#   0 — up to date, or successfully applied pending migrations
#   1 — one or more migrations failed (deploy should abort)
#   2 — misconfigured (no DATABASE_URL, no migration dir)
# =============================================================================

set -euo pipefail

MIGRATION_DIR="${MIGRATION_DIR:-scripts/migrations/sql}"

# --- Load connection string from .env.local/.env ---
# Prefer MIGRATION_DATABASE_URL (direct, superuser) over DATABASE_URL (pooled, tenant).
# Poolers like Supavisor can reject DDL or block `DROP`/`GRANT` statements —
# migrations must hit Postgres directly.
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

# Use MIGRATION_DATABASE_URL if set, else fall back to DATABASE_URL
PGURL="${MIGRATION_URL:-${DATABASE_URL:-}}"

if [[ -z "$PGURL" ]]; then
  echo "ERROR: MIGRATION_DATABASE_URL or DATABASE_URL must be set"
  exit 2
fi

if [[ ! -d "$MIGRATION_DIR" ]]; then
  echo "No migration dir at $MIGRATION_DIR — skipping"
  exit 0
fi

# --- Ensure tracker table exists ---
psql "$PGURL" -v ON_ERROR_STOP=1 -q << 'SQL' > /dev/null
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL

# --- Find pending migrations ---
APPLIED=$(psql "$PGURL" -t -A -c "SELECT filename FROM schema_migrations ORDER BY filename;" 2>/dev/null | tr '\n' '|' || echo "")

PENDING=()
for sql_file in $(ls "$MIGRATION_DIR"/*.sql 2>/dev/null | sort); do
  fname=$(basename "$sql_file")
  if ! grep -qF "|${fname}|" <<< "|${APPLIED}"; then
    PENDING+=("$sql_file")
  fi
done

if [[ ${#PENDING[@]} -eq 0 ]]; then
  echo "Migrations: up to date (0 pending)"
  exit 0
fi

echo "Migrations: ${#PENDING[@]} pending"

# --- Apply each pending migration in a transaction ---
for sql_file in "${PENDING[@]}"; do
  fname=$(basename "$sql_file")
  echo "  applying $fname..."
  if psql "$PGURL" -v ON_ERROR_STOP=1 -q -1 \
       -c "\i $sql_file" \
       -c "INSERT INTO schema_migrations (filename) VALUES ('$fname');" \
     > /dev/null; then
    echo "    ✓ $fname"
  else
    echo "    ✗ $fname FAILED — aborting"
    exit 1
  fi
done

echo "Migrations: applied ${#PENDING[@]} new"
