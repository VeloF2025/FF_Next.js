#!/bin/bash
# Cron wrapper: sync SharePoint photos to local storage
#
# Resolves its own repo root instead of hardcoding one. The previous
# `cd /home/hein/Workspace/FF_Next.js` meant this always ran the WORKSPACE checkout,
# whichever copy cron invoked — and that tree drifts. On 2026-07-28 it sat 20+ commits
# behind master, so a sibling cron kept running pre-fix code 6x/day for hours after the
# fix was deployed. Deploy dirs are kept current by scripts/deploy-local.sh; a developer
# working tree is not, so a cron must never be pinned to one.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"
/usr/bin/node scripts/sync-photos-to-local.js --limit 500
