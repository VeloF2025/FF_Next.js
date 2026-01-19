#!/bin/bash
#
# QField OES Sync Wrapper Script
# Called by FibreFlow API for SSE-compatible output
#
# Environment variables:
#   QFIELD_PROJECT_ID - Optional project filter (not currently used)
#   SYNC_MODE - 'full' or 'delta' (default: delta)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Activate virtual environment if exists
if [ -f "/opt/qfield-sync/venv/bin/activate" ]; then
    source /opt/qfield-sync/venv/bin/activate
fi

echo "=============================================="
echo "QField OES Sync"
echo "Started: $(date)"
echo "=============================================="

# Determine sync mode
SYNC_ARGS=""
if [ "$SYNC_MODE" = "full" ]; then
    SYNC_ARGS="--full"
    echo "Mode: FULL SYNC"
else
    echo "Mode: DELTA SYNC"
fi

# Always generate GeoPackage
SYNC_ARGS="$SYNC_ARGS --gpkg"

# Run sync
python3 sync_oes_to_qfield.py $SYNC_ARGS

echo "=============================================="
echo "Sync Complete: $(date)"
echo "=============================================="
