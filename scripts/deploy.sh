#!/bin/bash
# FibreFlow Production Deploy Script
# Usage: bash scripts/deploy.sh [commit-hash]
# Must run as: velo user
# NEVER run npm run build manually in prod — use this script only

set -e

DEPLOY_DIR="/home/velo/fibreflow-production"
LOG_FILE="/tmp/ff-deploy-$(date +%Y%m%d-%H%M%S).log"

echo "[$(date)] Starting production deploy..." | tee -a "$LOG_FILE"

if [ "$(whoami)" != "velo" ]; then
  echo "ERROR: Must run as velo user. Use: sudo -u velo bash scripts/deploy.sh" | tee -a "$LOG_FILE"
  exit 1
fi

cd "$DEPLOY_DIR"

# 1. Pull latest
echo "[$(date)] git pull..." | tee -a "$LOG_FILE"
git pull origin master 2>&1 | tee -a "$LOG_FILE"

# 2. Install deps (catches undeclared deps like nodemailer)
echo "[$(date)] npm install..." | tee -a "$LOG_FILE"
npm install 2>&1 | tee -a "$LOG_FILE"

# 3. Clean .next before build (prevents stale cache issues)
echo "[$(date)] Cleaning .next..." | tee -a "$LOG_FILE"
rm -rf .next

# 4. Build
echo "[$(date)] npm run build..." | tee -a "$LOG_FILE"
npm run build 2>&1 | tee -a "$LOG_FILE"

# 5. Verify BUILD_ID exists before restarting service
if [ ! -f ".next/BUILD_ID" ]; then
  echo "ERROR: BUILD_ID missing after build — aborting restart. Prod still on old build." | tee -a "$LOG_FILE"
  exit 1
fi

echo "[$(date)] BUILD_ID: $(cat .next/BUILD_ID)" | tee -a "$LOG_FILE"

# 6. Restart service (systemd handles it)
echo "[$(date)] Restarting service..." | tee -a "$LOG_FILE"
sudo systemctl restart fibreflow-production.service

# 7. Health check
sleep 5
HTTP=$(curl -so /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null)
if [ "$HTTP" = "200" ]; then
  echo "[$(date)] ✅ Deploy complete. HTTP $HTTP" | tee -a "$LOG_FILE"
else
  echo "[$(date)] ❌ Service returned HTTP $HTTP — check logs." | tee -a "$LOG_FILE"
  exit 1
fi

echo "[$(date)] Log: $LOG_FILE"
