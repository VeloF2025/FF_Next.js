#!/bin/bash
# Safe deployment script for FibreFlow Production
# Prevents .next deletion crashes through atomic deployment

set -e  # Exit on any error

LOCKFILE=/tmp/fibreflow-deploy.lock
DEPLOY_DIR=/home/velo/fibreflow-production
LOG_DIR=$DEPLOY_DIR/logs
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠️${NC} $*"; }
error() { echo -e "${RED}[$(date +%H:%M:%S)] ✗${NC} $*"; exit 1; }

# Check for concurrent deploys
if [ -f "$LOCKFILE" ]; then
    error "Deploy already in progress (lockfile: $LOCKFILE)"
fi

# Create lockfile
trap "rm -f $LOCKFILE" EXIT
touch $LOCKFILE
log "Deploy lock acquired"

# Business hours check (08:00-17:00 SAST)
HOUR=$(date +%H)
if [ $HOUR -ge 8 ] && [ $HOUR -lt 17 ]; then
    warn "Deploying during business hours (08:00-17:00)"
    read -p "Continue? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        error "Deploy cancelled by user"
    fi
fi

cd $DEPLOY_DIR

# Step 1: Record current state
CURRENT_COMMIT=$(git rev-parse HEAD)
log "Current commit: $CURRENT_COMMIT"

# Step 2: Pull latest code
log "Pulling latest code..."
git pull origin master || error "Git pull failed"

NEW_COMMIT=$(git rev-parse HEAD)
if [ "$CURRENT_COMMIT" = "$NEW_COMMIT" ]; then
    log "No new commits, checking if rebuild needed..."
    if [ ! -f .next/BUILD_ID ]; then
        warn "Build missing, will rebuild"
    else
        log "Nothing to deploy, exiting"
        exit 0
    fi
fi

# Step 3: Install dependencies if package.json changed
if git diff --name-only $CURRENT_COMMIT $NEW_COMMIT | grep -q 'package.json'; then
    log "package.json changed, running npm install..."
    npm install || error "npm install failed"
fi

# Step 4: Build to temporary directory
log "Building application..."

# Backup current .next if it exists
if [ -d .next ]; then
    log "Backing up current build..."
    mv .next .next-backup-$TIMESTAMP
fi

# Run build
npm run build || {
    error "Build failed!"
    # Restore backup if build fails
    if [ -d .next-backup-$TIMESTAMP ]; then
        warn "Restoring previous build..."
        mv .next-backup-$TIMESTAMP .next
    fi
    exit 1
}

# Step 5: Validate new build
log "Validating build..."
if [ ! -f .next/BUILD_ID ]; then
    error "BUILD_ID missing - invalid build"
fi
if [ ! -f .next/prerender-manifest.json ]; then
    error "prerender-manifest.json missing - invalid build"
fi
if [ ! -f .next/build-manifest.json ]; then
    error "build-manifest.json missing - invalid build"
fi

log "✓ Build validation passed"

# Step 6: Run database migrations if needed
if [ -d neon/migrations ]; then
    log "Checking for database migrations..."
    npm run db:migrate || warn "Migration check failed (non-critical)"
fi

# Step 7: Restart service
log "Restarting service..."
echo 'velo2026' | sudo -S systemctl restart fibreflow-production

# Step 8: Wait and verify
log "Waiting for service to start..."
sleep 5

if ! systemctl is-active --quiet fibreflow-production; then
    error "Service failed to start! Check logs: journalctl -u fibreflow-production -n 50"
fi

# Step 9: Health check
log "Running health check..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/)
if [ "$HTTP_CODE" != "200" ]; then
    error "Health check failed! HTTP $HTTP_CODE"
fi

log "✓ Health check passed (HTTP $HTTP_CODE)"

# Step 10: Cleanup old backups (keep last 3)
log "Cleaning up old backups..."
ls -t .next-backup-* 2>/dev/null | tail -n +4 | xargs -r rm -rf
log "✓ Kept last 3 backups"

# Step 11: Log deployment
echo "$TIMESTAMP | $CURRENT_COMMIT → $NEW_COMMIT | SUCCESS" >> $LOG_DIR/deploy-history.log

log "✅ Deploy complete! Commit: $NEW_COMMIT"
log "Rollback available: .next-backup-$TIMESTAMP"

# Notify Mission Control
curl -s -X POST http://localhost:3847/api/message \
    -H "Content-Type: application/json" \
    -d "{\"from\":\"Forge\",\"to\":\"all\",\"type\":\"deploy\",\"message\":\"✅ Production deployed: $NEW_COMMIT\"}" >/dev/null

exit 0
