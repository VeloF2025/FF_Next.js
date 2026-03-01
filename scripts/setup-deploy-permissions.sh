#!/bin/bash
# =============================================================================
# setup-deploy-permissions.sh — One-time setup for passwordless deploys
# =============================================================================
# Run ONCE with: sudo bash scripts/setup-deploy-permissions.sh
#
# Creates:
#   /usr/local/bin/fibreflow-fix-next  — ownership fixer script
#   /etc/sudoers.d/fibreflow-deploy    — passwordless sudoers rules
#
# After this, deploy-local.sh works without password prompts.
# =============================================================================

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: Run with sudo:  sudo bash scripts/setup-deploy-permissions.sh"
  exit 1
fi

echo "=== Setting up FibreFlow deploy permissions ==="

# --- 1. Create ownership fixer script ---
cat > /usr/local/bin/fibreflow-fix-next << 'SCRIPT'
#!/bin/bash
# Fix .next ownership for FibreFlow deploy dirs.
# Only operates on known safe paths.

set -euo pipefail

ALLOWED_DIRS=(
  "/home/velo/fibreflow-dev"
  "/home/velo/fibreflow-staging"
  "/home/velo/fibreflow-production"
)

DIR="${1:-}"

if [[ -z "$DIR" ]]; then
  echo "Usage: fibreflow-fix-next <deploy-dir>"
  exit 1
fi

# Validate path is in allowed list
VALID=false
for allowed in "${ALLOWED_DIRS[@]}"; do
  if [[ "$DIR" == "$allowed" ]]; then
    VALID=true
    break
  fi
done

if [[ "$VALID" != true ]]; then
  echo "ERROR: $DIR is not an allowed deploy directory"
  exit 1
fi

# Fix .next ownership if it exists
if [[ -d "$DIR/.next" ]]; then
  chown -R velo:velo "$DIR/.next"
  echo "Fixed ownership: $DIR/.next"
fi

# Fix any .next-backup-* ownership
for backup in "$DIR"/.next-backup-*; do
  if [[ -d "$backup" ]]; then
    chown -R velo:velo "$backup"
  fi
done

# Fix node_modules/.cache if needed
if [[ -d "$DIR/node_modules/.cache" ]]; then
  chown -R velo:velo "$DIR/node_modules/.cache"
fi
SCRIPT

chmod 755 /usr/local/bin/fibreflow-fix-next
echo "  Created /usr/local/bin/fibreflow-fix-next"

# --- 2. Create sudoers drop-in ---
cat > /etc/sudoers.d/fibreflow-deploy << 'SUDOERS'
# FibreFlow deploy permissions for hein
# Allows passwordless ownership fix and service management

# Ownership fixer (constrained to known deploy dirs)
hein ALL=(root) NOPASSWD: /usr/local/bin/fibreflow-fix-next *

# Service stop (needed for clean builds)
hein ALL=(root) NOPASSWD: /usr/bin/systemctl stop fibreflow-dev.service
hein ALL=(root) NOPASSWD: /usr/bin/systemctl stop fibreflow.service
hein ALL=(root) NOPASSWD: /usr/bin/systemctl stop fibreflow-production.service

# Service start
hein ALL=(root) NOPASSWD: /usr/bin/systemctl start fibreflow-dev.service
hein ALL=(root) NOPASSWD: /usr/bin/systemctl start fibreflow.service
hein ALL=(root) NOPASSWD: /usr/bin/systemctl start fibreflow-production.service
SUDOERS

chmod 440 /etc/sudoers.d/fibreflow-deploy

# Validate sudoers syntax
if visudo -c -f /etc/sudoers.d/fibreflow-deploy 2>/dev/null; then
  echo "  Created /etc/sudoers.d/fibreflow-deploy (validated)"
else
  echo "ERROR: Invalid sudoers syntax — removing file"
  rm -f /etc/sudoers.d/fibreflow-deploy
  exit 1
fi

# --- 3. Fix current ownership on all deploy dirs ---
echo ""
echo "Fixing current ownership on all deploy dirs..."
for dir in /home/velo/fibreflow-dev /home/velo/fibreflow-staging /home/velo/fibreflow-production; do
  if [[ -d "$dir/.next" ]]; then
    chown -R velo:velo "$dir/.next"
    echo "  Fixed: $dir/.next"
  fi
  for backup in "$dir"/.next-backup-*; do
    if [[ -d "$backup" ]]; then
      chown -R velo:velo "$backup"
    fi
  done
done

echo ""
echo "=== Setup complete ==="
echo "deploy-local.sh will now work without password prompts."
echo "Test: sudo /usr/local/bin/fibreflow-fix-next /home/velo/fibreflow-dev"
