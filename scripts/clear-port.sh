#!/bin/bash
# =============================================================================
# clear-port.sh — Port Conflict Detection & Cleanup for FibreFlow
# =============================================================================
# Detects and kills orphan processes holding FibreFlow ports before service start.
# Safe to run before any deployment or manual restart.
#
# Usage:
#   bash scripts/clear-port.sh              # checks all FF ports (3000, 3005, 3006)
#   bash scripts/clear-port.sh 3000         # check + clear specific port
#   bash scripts/clear-port.sh --kill       # auto-kill orphans (no prompt)
#   bash scripts/clear-port.sh 3000 --kill  # auto-kill port 3000
#
# Exit code: 0 = ports clear, 1 = ports still occupied after cleanup
# =============================================================================

AUTO_KILL=false
SPECIFIC_PORT=""

for arg in "$@"; do
  case $arg in
    --kill) AUTO_KILL=true ;;
    [0-9]*) SPECIFIC_PORT=$arg ;;
  esac
done

# FibreFlow service → port mapping
declare -A PORT_TO_SVC
PORT_TO_SVC[3000]="fibreflow-production"
PORT_TO_SVC[3005]="fibreflow-dev"
PORT_TO_SVC[3006]="fibreflow"

if [ -n "$SPECIFIC_PORT" ]; then
  PORTS=("$SPECIFIC_PORT")
else
  PORTS=(3000 3005 3006)
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

CLEARED=0
OCCUPIED=0
ALREADY_FREE=0

echo "============================================="
echo "  FibreFlow Port Conflict Detector"
echo "  $(date '+%Y-%m-%d %H:%M %Z')"
echo "============================================="

for PORT in "${PORTS[@]}"; do
  SVC="${PORT_TO_SVC[$PORT]:-unknown}"
  echo -e "\n${BLUE}▶ Port $PORT ($SVC)${NC}"

  # Get all PIDs on this port
  PIDS=$(lsof -ti :$PORT 2>/dev/null || true)

  if [ -z "$PIDS" ]; then
    echo -e "${GREEN}  ✅ Free${NC}"
    ALREADY_FREE=$((ALREADY_FREE+1))
    continue
  fi

  # Get the expected PID from systemd
  EXPECTED_PID=$(systemctl show "$SVC" --property=MainPID 2>/dev/null | cut -d= -f2)

  ORPHANS=()
  for PID in $PIDS; do
    PROC_INFO=$(ps -p "$PID" -o pid,user,stat,cmd --no-headers 2>/dev/null || echo "$PID unknown ? unknown")

    if [ -n "$EXPECTED_PID" ] && [ "$PID" = "$EXPECTED_PID" ] && [ "$EXPECTED_PID" != "0" ]; then
      echo -e "${GREEN}  ✅ PID $PID — expected ($SVC managed)${NC}"
      echo "     $PROC_INFO"
    else
      echo -e "${YELLOW}  ⚠️  PID $PID — ORPHAN${NC}"
      echo "     $PROC_INFO"
      ORPHANS+=("$PID")
    fi
  done

  if [ ${#ORPHANS[@]} -eq 0 ]; then
    echo -e "${GREEN}  ✅ No orphans on port $PORT${NC}"
    ALREADY_FREE=$((ALREADY_FREE+1))
    continue
  fi

  # Kill orphans
  if [ "$AUTO_KILL" = true ]; then
    KILL_IT=true
  else
    echo ""
    read -r -p "  Kill ${#ORPHANS[@]} orphan(s) on port $PORT? [y/N] " CONFIRM
    KILL_IT=false
    [[ "$CONFIRM" =~ ^[Yy]$ ]] && KILL_IT=true
  fi

  if [ "$KILL_IT" = true ]; then
    for PID in "${ORPHANS[@]}"; do
      if kill -TERM "$PID" 2>/dev/null; then
        echo -e "${GREEN}  ✅ Killed PID $PID (SIGTERM)${NC}"
      else
        # Try SIGKILL if SIGTERM fails
        if kill -KILL "$PID" 2>/dev/null; then
          echo -e "${YELLOW}  ⚠️  Force-killed PID $PID (SIGKILL)${NC}"
        else
          echo -e "${RED}  ❌ Could not kill PID $PID — may need sudo${NC}"
        fi
      fi
    done

    # Verify port is now free
    sleep 1
    REMAINING=$(lsof -ti :$PORT 2>/dev/null || true)
    if [ -z "$REMAINING" ]; then
      echo -e "${GREEN}  ✅ Port $PORT is now free${NC}"
      CLEARED=$((CLEARED+1))
    else
      echo -e "${RED}  ❌ Port $PORT still occupied by: $REMAINING${NC}"
      OCCUPIED=$((OCCUPIED+1))
    fi
  else
    echo -e "${YELLOW}  ⏭  Skipped — port $PORT still has orphans${NC}"
    OCCUPIED=$((OCCUPIED+1))
  fi
done

# --- SUMMARY ---
echo ""
echo "============================================="
echo "  SUMMARY"
echo "============================================="
echo "  Already free: $ALREADY_FREE"
echo "  Cleared:      $CLEARED"
echo "  Still occupied: $OCCUPIED"
echo ""

if [ "$OCCUPIED" -gt 0 ]; then
  echo -e "${RED}  ❌ Some ports still occupied — service restart may fail.${NC}"
  echo "     Try running with --kill flag or resolve manually."
  exit 1
else
  echo -e "${GREEN}  ✅ All checked ports are clear — safe to start services.${NC}"
  exit 0
fi
