#!/usr/bin/env bash
#
# Works-QA ⇄ QField ingest cron. Runs on velo (needs docker + MinIO + DATABASE_URL).
# Makes QField field photos flow to the Works-QA dashboard on a schedule instead of
# only when someone runs the extractor by hand — see the design spec
# docs/superpowers/specs/2026-07-14-worksqa-qfield-ingest-automation-design.md.
#
# Four steps (each non-fatal so one failure doesn't skip the rest):
#   1. extract-gpkg-photos.py --all  — GPKG photos → qfield_photo_validations
#      (registered PROJECTS; existing dedup makes it idempotent + clears backlogs).
#   2. works-qa-sync.ts --all-active — qfield_photo_validations → pole_qa_photos
#      (REQUIRED for aliased QField projects, which the dashboard's direct-join
#      branch cannot surface from qfield_photo_validations alone).
#   3. works-qa-vlm-score.ts          — Run VLM on unscored, humanly-undecided pole photos
#      (scores fresh synced photos + backlog; non-fatal so coverage-check still runs).
#   4. works-qa-coverage-check.py    — WARN + WhatsApp when a linked/active project
#      has upstream photos but 0 ingested (the "never silently miss" guarantee).
#
# Suggested crontab (aligns with cron-classify-photos.sh, 4×/day SAST):
#   0 6,10,14,18 * * * /home/velo/fibreflow-dev/scripts/cron/worksqa-qfield-ingest.sh \
#     >> /home/velo/logs/worksqa-qfield-ingest.log 2>&1
#
# Deliberately NOT `set -e`: a failing step logs a WARNING and the run continues.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Guarded reader: always returns 0 so a missing file / no-match never aborts.
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

# VLM_PROXY_SECRET authorises the photo-proxy's `?vlm=true` path, which is the ONLY
# way vLLM can fetch a photo (it GETs image URLs with no headers, so the credential
# has to ride in the query string — see src/lib/vlm/photoProxyAuth.ts).
#
# Step 3 below runs as a plain tsx CLI, NOT inside Next.js, so nothing loads .env.local
# for it: every var it needs must be exported here. Missing this one cost 11 054
# consecutive scoring failures (2026-07-21 → 07-27, scored=0 every run) — the proxy
# fail-closed to 401, vLLM could not read the image, and the error was logged as a
# bare "fetch failed". It is intentionally NOT fatal: steps 1, 2 and 4 do useful work
# without it, and step 3 now aborts with a clear message of its own.
if [ -z "${VLM_PROXY_SECRET:-}" ]; then
  VLM_PROXY_SECRET="$(env_value "$ROOT/.env.local" VLM_PROXY_SECRET)"
  [ -z "$VLM_PROXY_SECRET" ] && VLM_PROXY_SECRET="$(env_value "$ROOT/.env.production" VLM_PROXY_SECRET)"
  [ -z "$VLM_PROXY_SECRET" ] && VLM_PROXY_SECRET="$(env_value "$ROOT/.env" VLM_PROXY_SECRET)"
fi
if [ -n "${VLM_PROXY_SECRET:-}" ]; then
  export VLM_PROXY_SECRET
else
  echo "[$(date '+%F %T %Z')] WARNING: VLM_PROXY_SECRET not resolvable from $ROOT/.env* — VLM scoring will be skipped" >&2
fi

# Python with psycopg2 (system python3 has it on velo); allow override.
PYTHON="${PYTHON:-/usr/bin/python3}"

# tsx runner: cron has a minimal PATH, so prepend the known nvm node bin (matches
# the other FibreFlow tsx crons) then prefer the repo-local tsx, else npx.
NODE_BIN_DIR="${NODE_BIN_DIR:-/home/velo/.nvm/versions/node/v22.21.1/bin}"
[ -d "$NODE_BIN_DIR" ] && export PATH="$NODE_BIN_DIR:$PATH"
run_tsx() {
  if [ -x "$ROOT/node_modules/.bin/tsx" ]; then
    "$ROOT/node_modules/.bin/tsx" "$@"
  else
    npx --yes tsx "$@"
  fi
}

cd "$ROOT"
echo "===== worksqa-qfield-ingest $(date '+%F %T %Z') (root=$ROOT) ====="

echo "[1/4] extract-gpkg-photos.py --all"
"$PYTHON" scripts/extract-gpkg-photos.py --all || echo "  WARNING: extract step failed (continuing)"

echo "[2/4] works-qa-sync.ts --all-active"
run_tsx scripts/works-qa-sync.ts --all-active || echo "  WARNING: works-qa sync step failed (continuing)"

echo "[3/4] works-qa-vlm-score.ts (fresh + up to 500 backlog)"
run_tsx scripts/works-qa-vlm-score.ts --limit 500 --concurrency 4 --fresh-hours 3 \
  || echo "  WARNING: vlm-score step failed (continuing)"

echo "[4/4] works-qa-coverage-check.py"
"$PYTHON" scripts/works-qa-coverage-check.py "$@" || echo "  WARNING: coverage check failed (continuing)"

echo "===== worksqa-qfield-ingest complete $(date '+%F %T %Z') ====="
