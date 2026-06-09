#!/bin/bash
# Setup Auto-Feedback systemd timer on Velocity
#
# Calls /api/cron/auto-feedback every 5 minutes to auto-send QA feedback
# to technicians 30 minutes after auto-QA processes their DR.
#
# Run once after deployment:
#   bash scripts/activate/setup-auto-feedback-cron.sh [dev|production]
#
# Prerequisites:
#   - CRON_SECRET must be set in the target .env.production
#   - Run as a user with sudo access on Velocity

set -euo pipefail

ENV="${1:-dev}"

if [[ "$ENV" == "production" ]]; then
  APP_URL="https://app.fibreflow.app"
  SERVICE_PREFIX="fibreflow-auto-feedback-production"
else
  APP_URL="https://dev.fibreflow.app"
  SERVICE_PREFIX="fibreflow-auto-feedback-dev"
fi

ENV_FILE="/home/velo/fibreflow-${ENV}/.env.production"

echo "Setting up auto-feedback timer for: $ENV ($APP_URL)"

# Read CRON_SECRET from the env file
CRON_SECRET=$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")

if [[ -z "$CRON_SECRET" ]]; then
  echo "ERROR: CRON_SECRET not found in $ENV_FILE"
  exit 1
fi

echo "CRON_SECRET found (${#CRON_SECRET} chars)"

# Write a dedicated env file with strict perms
SECRET_ENV_FILE="/etc/systemd/system/${SERVICE_PREFIX}.env"
sudo install -m 600 -o root -g root /dev/null "$SECRET_ENV_FILE"
printf 'CRON_SECRET=%s\n' "$CRON_SECRET" | sudo tee "$SECRET_ENV_FILE" > /dev/null

# Write service unit
sudo tee "/etc/systemd/system/${SERVICE_PREFIX}.service" > /dev/null <<EOF
[Unit]
Description=FibreFlow Auto-Feedback sender (${ENV})
After=network.target

[Service]
Type=oneshot
EnvironmentFile=${SECRET_ENV_FILE}
ExecStart=/usr/bin/curl -sS --fail -X POST \
  -H "Authorization: Bearer \${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  "${APP_URL}/api/cron/auto-feedback"
StandardOutput=journal
StandardError=journal
EOF

# Write timer unit
sudo tee "/etc/systemd/system/${SERVICE_PREFIX}.timer" > /dev/null <<EOF
[Unit]
Description=FibreFlow Auto-Feedback timer — every 5 minutes (${ENV})

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
