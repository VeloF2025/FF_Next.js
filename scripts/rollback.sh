#!/bin/bash
# Emergency rollback script for FibreFlow Production
# Restores last known good build

set -e

DEPLOY_DIR=/home/velo/fibreflow-production
LOG_DIR=$DEPLOY_DIR/logs
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠️${NC} $*"; }
error() { echo -e "${RED}[$(date +%H:%M:%S)] ✗${NC} $*"; exit 1; }

cd $DEPLOY_DIR

# Find most recent backup
LATEST_BACKUP=$(ls -t .next-backup-* 2>/dev/null | head -1)

if [ -z "$LATEST_BACKUP" ]; then
    error "No backup found! Cannot rollback."
fi

warn "ROLLBACK: Will restore $LATEST_BACKUP"
warn "Current .next will be moved to .next-failed-$TIMESTAMP"

read -p "Continue? (yes/no): " -r
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    error "Rollback cancelled"
fi

# Backup failed build
if [ -d .next ]; then
    log "Preserving failed build..."
    mv .next .next-failed-$TIMESTAMP
fi

# Restore backup
log "Restoring $LATEST_BACKUP..."
cp -r $LATEST_BACKUP .next

# Verify restoration
if [ ! -f .next/BUILD_ID ]; then
    error "Restored build is invalid!"
fi

# Restart service
log "Restarting service..."
echo 'velo2026' | sudo -S systemctl restart fibreflow-production

sleep 5

# Verify
if ! systemctl is-active --quiet fibreflow-production; then
    error "Service failed to start after rollback!"
fi

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/)
if [ "$HTTP_CODE" != "200" ]; then
    error "Health check failed! HTTP $HTTP_CODE"
fi

log "✅ Rollback successful!"
echo "$TIMESTAMP | ROLLBACK to $LATEST_BACKUP | SUCCESS" >> $LOG_DIR/deploy-history.log

# Notify Mission Control
curl -s -X POST http://localhost:3847/api/message \
    -H "Content-Type: application/json" \
    -d "{\"from\":\"Forge\",\"to\":\"all\",\"type\":\"alert\",\"message\":\"⏮️ Production rolled back to $LATEST_BACKUP\"}" >/dev/null

exit 0
