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
# `grep | head | cut | tr` returns non-zero when the var is absent in the env
# file (no match). Under `set -euo pipefail` that kills the entire script
# silently — masking real bugs and producing zero diagnostic output. Append
# `|| true` so a missing var leaves the destination unset (handled below)
# instead of aborting the deploy. Observed on production where
# MIGRATION_DATABASE_URL lives in `.env` only, not `.env.local`.
for env_file in .env.local .env; do
  if [[ -f "$env_file" ]]; then
    if [[ -z "${MIGRATION_URL:-}" ]]; then
      MIGRATION_URL=$(grep -E '^MIGRATION_DATABASE_URL=' "$env_file" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)
    fi
    if [[ -z "${DATABASE_URL:-}" ]]; then
      DATABASE_URL=$(grep -E '^DATABASE_URL=' "$env_file" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)
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
  # Skip rollback scripts — they are downgrade tools, applied manually
  # if needed, never auto-run during a forward deploy.
  if [[ "$fname" == rollback_* ]]; then
    continue
  fi
  if ! grep -qF "|${fname}|" <<< "|${APPLIED}"; then
    PENDING+=("$sql_file")
  fi
done

if [[ ${#PENDING[@]} -eq 0 ]]; then
  echo "Migrations: up to date (0 pending)"
  exit 0
fi

echo "Migrations: ${#PENDING[@]} pending"

applied_count=0
reconciled_count=0
deferred_count=0

# --- Apply each pending migration in a transaction ---
for sql_file in "${PENDING[@]}"; do
  fname=$(basename "$sql_file")

  # Self-heal out-of-band drift before re-running.
  # A migration applied outside this runner (e.g. manual psql during dev) records
  # itself in the legacy `migrations` table via the file's own
  # `INSERT INTO migrations (version, name, ...)`, but never lands in
  # schema_migrations. The runner then sees it as pending and re-runs it; that
  # non-idempotent INSERT collides on `migrations_version_key` and aborts the
  # whole deploy.
  #
  # Only treat a file as already-applied on an EXACT identity match — version AND
  # name — against `migrations`. Version alone is unsafe: many files share a
  # numeric prefix (e.g. 343_*), so version-only matching could silently skip a
  # genuinely-unapplied file. `migrations.name` formatting is inconsistent (some
  # rows use spaces, some underscores), so compare on a normalised name. On any
  # non-match we fall through and apply — a real version collision then aborts
  # loudly (correct), never a silent skip.
  version="${fname%%_*}"
  barename="${fname#*_}"; barename="${barename%.sql}"
  if [[ "$version" =~ ^[0-9]+$ && -n "$barename" ]]; then
    match=$(psql "$PGURL" -t -A \
      -c "SELECT 1 FROM migrations WHERE version = '$version' AND lower(replace(name, ' ', '_')) = lower(replace('$barename', ' ', '_')) LIMIT 1;" \
      2>/dev/null || echo "")
    if [[ "$match" == "1" ]]; then
      psql "$PGURL" -q -c "INSERT INTO schema_migrations (filename) VALUES ('$fname') ON CONFLICT (filename) DO NOTHING;" > /dev/null 2>&1 || true
      echo "  reconciled $fname (already applied via migrations table — recorded, not re-run)"
      reconciled_count=$((reconciled_count + 1))
      continue
    fi
  fi

  echo "  applying $fname..."
  # Capture output + exit code without tripping `set -e` on a failing migration:
  # `var=$(failing_cmd)` would abort here, so guard the substitution with `|| rc=$?`.
  apply_rc=0
  apply_out=$(psql "$PGURL" -v ON_ERROR_STOP=1 -q -1 \
       -c "\i $sql_file" \
       -c "INSERT INTO schema_migrations (filename) VALUES ('$fname') ON CONFLICT (filename) DO NOTHING;" \
     2>&1) || apply_rc=$?
  if [[ "$apply_rc" -eq 0 ]]; then
    echo "    ✓ $fname"
    applied_count=$((applied_count + 1))
  elif grep -q '__sprint_e_cutover_gate__' <<< "$apply_out"; then
    # Intentionally-gated migration: it RAISEs (and rolls back its own txn, so
    # nothing is recorded) until the __sprint_e_cutover_gate__ marker table
    # exists — the Sprint E cutover safety contract. Treat as DEFERRED, not
    # failed: leave it pending and continue to later migrations so an unrelated
    # deploy isn't blocked by a not-yet-due cutover migration. It re-evaluates
    # on every deploy and applies automatically once the gate is in place.
    echo "    ⏸ $fname deferred — gate not yet met (left pending)"
    deferred_count=$((deferred_count + 1))
    continue
  else
    echo "    ✗ $fname FAILED — aborting"
    echo "$apply_out" | sed 's/^/      /'
    exit 1
  fi
done

summary="Migrations: applied $applied_count new"
[[ "$reconciled_count" -gt 0 ]] && summary="$summary, reconciled $reconciled_count already-applied"
[[ "$deferred_count" -gt 0 ]] && summary="$summary, deferred $deferred_count gated"
echo "$summary"
