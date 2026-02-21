#!/bin/bash
# Cron job: classify new unassigned QA photos via VLM
# Runs on Velocity where MinIO + VLM are local.
# Schedule: 3x daily (6am, 12pm, 6pm SAST)
#
# Crontab entry (add with: crontab -e):
#   0 6,12,18 * * * /home/velo/fibreflow-production/scripts/cron-classify-photos.sh >> /var/log/vlm-classify-cron.log 2>&1
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON="${SCRIPT_DIR}/../.venv/bin/python3"
CLASSIFY="${SCRIPT_DIR}/classify-qa-photos-vlm.py"

# Use system python if no venv
if [ ! -f "$PYTHON" ]; then
    PYTHON="python3"
fi

# DB URL from environment or production default
DB_URL="${DATABASE_URL:-postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech:5432/neondb?sslmode=require}"

echo ""
echo "========================================"
echo "  VLM Photo Classify Cron — $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "========================================"

# Classify up to 2000 new photos per run (both sources)
$PYTHON "$CLASSIFY" \
    --project all \
    --source all \
    --limit 2000 \
    --local-minio \
    --db-url "$DB_URL"

echo ""
echo "  Cron complete: $(date '+%H:%M:%S')"
echo "========================================"
