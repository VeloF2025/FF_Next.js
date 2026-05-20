#!/bin/bash
# Setup Auto-QA systemd timer on Velocity
#
# Calls /api/cron/auto-qa every 5 minutes to process DRs that became
# eligible 30 minutes after WhatsApp receipt.
#
# Run once after deployment:
#   bash scripts/activate/setup-auto-qa-cron.sh [dev|production]
#
# Prerequisites:
#   - CRON_SECRET must be set in the target .env.production
#   - Run as a user with sudo access on Velocity

set -euo pipefail

ENV="${1:-dev}"

if [[ "$ENV" == "production" ]]; then
  APP_URL="https://app.fibreflow.app"
  SERVICE_PREFIX="fibreflow-auto-qa-production"
else
  APP_URL="https://dev.fibreflow.app"
  SERVICE_PREFIX="fibreflow-auto-qa-dev"
fi

ENV_FILE="/home/velo/fibreflow-${ENV}/.env.production"

echo "Setting up auto-QA timer for: $ENV ($APP_URL)"

# Read CRON_SECRET from the env file
CRON_SECRET=$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")

if [[ -z "$CRON_SECRET" ]]; then
  echo "ERROR: CRON_SECRET not found in $ENV_FILE"
  exit 1
fi

echo "CRON_SECRET found (${#CRON_SECRET} chars)"

# Write service unit
sudo tee "/etc/systemd/system/${SERVICE_PREFIX}.service" > /dev/null <<EOF
[Unit]
Description=FibreFlow Auto-QA runner (${ENV})
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/bin/curl -s -X POST \\
  -H "Authorization: Bearer ${CRON_SECRET}" \\
  -H "Content-Type: application/json" \\
  "${APP_URL}/api/cron/auto-qa"
StandardOutput=journal
StandardError=journal
EOF

# Write timer unit
sudo tee "/etc/systemd/system/${SERVICE_PREFIX}.timer" > /dev/null <<EOF
[Unit]
Description=FibreFlow Auto-QA timer — every 5 minutes (${ENV})

[Timer]
OnCalendar=*:0/5
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now "${SERVICE_PREFIX}.timer"

echo ""
echo "Timer started. Status:"
sudo systemctl status "${SERVICE_PREFIX}.timer" --no-pager -l
echo ""
echo "Next run:"
sudo systemctl list-timers "${SERVICE_PREFIX}.timer" --no-pager
