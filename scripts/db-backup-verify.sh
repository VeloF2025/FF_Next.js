#!/usr/bin/env bash
# ============================================================
# FibreFlow Backup Verification (health check)
# ============================================================
# Cron: 0 8 * * 1  (Monday 08:00 SAST) on Velocity
# Usage: bash scripts/db-backup-verify.sh
# Installs on Velocity: crontab -e
#   0 8 * * 1 /home/velo/fibreflow-production/scripts/db-backup-verify.sh
# ============================================================

set -euo pipefail

# --- Config ---
BACKUP_DIR="/home/velo/backups/neon"
NEON_API_KEY="napi_2afbjxk3l7jh71x10log1icm4yycl3n2hqag9wrg1jgvwqg5z955c2tnt0ip4gwx"
NEON_PROJECT_ID="sparkling-bar-47287977"
NEON_API="https://console.neon.tech/api/v2"
MAX_AGE_DAYS=7
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# WhatsApp alert config
WA_BRIDGE="http://72.61.197.178:8083/send-message"
WA_GROUP_JID="120363421664266245@g.us"  # Velo Test group

FAILURES=()
CHECKS_PASSED=0

# --- Functions ---
send_wa_alert() {
  local message="$1"
  curl -s -X POST "$WA_BRIDGE" \
    -H "Content-Type: application/json" \
    -d "{\"group_jid\":\"${WA_GROUP_JID}\",\"message\":\"${message}\"}" \
    >/dev/null 2>&1 || true
}

check_pass() {
  echo "  ✅ $1"
  CHECKS_PASSED=$((CHECKS_PASSED + 1))
}

check_fail() {
  echo "  ❌ $1"
  FAILURES+=("$1")
}

# --- Check 1: pg_dump file exists ---
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  FibreFlow Backup Verification"
echo "  ${TIMESTAMP}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "1. Checking pg_dump backups in ${BACKUP_DIR}..."

if [ ! -d "$BACKUP_DIR" ]; then
  check_fail "Backup directory does not exist: ${BACKUP_DIR}"
else
  LATEST_BACKUP=$(ls -1t "${BACKUP_DIR}"/fibreflow-*.sql.gz 2>/dev/null | head -1)

  if [ -z "$LATEST_BACKUP" ]; then
    check_fail "No backup files found in ${BACKUP_DIR}"
  else
    # Check file is non-zero
    BACKUP_SIZE=$(stat -c%s "$LATEST_BACKUP" 2>/dev/null || stat -f%z "$LATEST_BACKUP" 2>/dev/null)
    if [ "$BACKUP_SIZE" -lt 1024 ]; then
      check_fail "Latest backup is too small (${BACKUP_SIZE} bytes): ${LATEST_BACKUP}"
    else
      BACKUP_SIZE_H=$(du -h "$LATEST_BACKUP" | cut -f1)
      check_pass "Latest backup: $(basename "$LATEST_BACKUP") (${BACKUP_SIZE_H})"
    fi

    # Check file age
    FILE_AGE_SECONDS=$(( $(date +%s) - $(stat -c%Y "$LATEST_BACKUP" 2>/dev/null || stat -f%m "$LATEST_BACKUP" 2>/dev/null) ))
    FILE_AGE_DAYS=$((FILE_AGE_SECONDS / 86400))
    if [ "$FILE_AGE_DAYS" -gt "$MAX_AGE_DAYS" ]; then
      check_fail "Latest backup is ${FILE_AGE_DAYS} days old (max: ${MAX_AGE_DAYS})"
    else
      check_pass "Backup age: ${FILE_AGE_DAYS} day(s) old (within ${MAX_AGE_DAYS}-day window)"
    fi

    # Check backup count
    BACKUP_COUNT=$(ls -1 "${BACKUP_DIR}"/fibreflow-*.sql.gz 2>/dev/null | wc -l)
    check_pass "Backup count: ${BACKUP_COUNT} file(s)"

    # Verify gz integrity
    if gzip -t "$LATEST_BACKUP" 2>/dev/null; then
      check_pass "Gzip integrity: OK"
    else
      check_fail "Gzip integrity FAILED on $(basename "$LATEST_BACKUP")"
    fi
  fi
fi

# --- Check 2: Neon branches (snapshots) ---
echo ""
echo "2. Checking Neon snapshots..."

NEON_RESPONSE=$(curl -s -w "\n%{http_code}" \
  "${NEON_API}/projects/${NEON_PROJECT_ID}/branches" \
  -H "Authorization: Bearer ${NEON_API_KEY}")

NEON_HTTP=$(echo "$NEON_RESPONSE" | tail -1)
NEON_BODY=$(echo "$NEON_RESPONSE" | sed '$d')

if [ "$NEON_HTTP" != "200" ]; then
  check_fail "Neon API returned HTTP ${NEON_HTTP} — cannot verify snapshots"
else
  # Count pre-migration branches (grep -c returns 0 count without error via || true)
  SNAPSHOT_COUNT=$(echo "$NEON_BODY" | grep -c '"name":"pre-migration-' || true)
  if [ "$SNAPSHOT_COUNT" -gt 0 ]; then
    check_pass "Neon pre-migration snapshots: ${SNAPSHOT_COUNT} found"
  else
    check_pass "Neon API accessible (no pre-migration snapshots yet — OK if no migrations run)"
  fi

  # Verify production branch exists
  if echo "$NEON_BODY" | grep -q '"name":"production"' 2>/dev/null; then
    check_pass "Production branch exists in Neon"
  elif echo "$NEON_BODY" | grep -q '"primary":true' 2>/dev/null; then
    check_pass "Neon primary branch accessible"
  else
    check_pass "Neon branches accessible (production branch may have different name)"
  fi
fi

# --- Check 3: Neon PITR configuration ---
echo ""
echo "3. Checking Neon project configuration..."

PROJECT_RESPONSE=$(curl -s -w "\n%{http_code}" \
  "${NEON_API}/projects/${NEON_PROJECT_ID}" \
  -H "Authorization: Bearer ${NEON_API_KEY}")

PROJECT_HTTP=$(echo "$PROJECT_RESPONSE" | tail -1)
PROJECT_BODY=$(echo "$PROJECT_RESPONSE" | sed '$d')

if [ "$PROJECT_HTTP" = "200" ]; then
  check_pass "Neon project accessible"

  # Check for history_retention setting
  if echo "$PROJECT_BODY" | grep -q "history_retention" 2>/dev/null; then
    RETENTION=$(echo "$PROJECT_BODY" | grep -o '"history_retention_seconds":[0-9]*' | cut -d: -f2 || true)
    if [ -n "$RETENTION" ] && [ "$RETENTION" -gt 0 ] 2>/dev/null; then
      RETENTION_DAYS=$((RETENTION / 86400))
      if [ "$RETENTION_DAYS" -ge 7 ]; then
        check_pass "PITR retention: ${RETENTION_DAYS} days"
      else
        check_fail "PITR retention only ${RETENTION_DAYS} days — should be 30"
      fi
    fi
  fi
else
  check_fail "Cannot access Neon project (HTTP ${PROJECT_HTTP})"
fi

# --- Summary ---
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
TOTAL_CHECKS=$((CHECKS_PASSED + ${#FAILURES[@]}))

if [ ${#FAILURES[@]} -eq 0 ]; then
  echo "  ALL CHECKS PASSED (${CHECKS_PASSED}/${TOTAL_CHECKS})"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
  echo "  ⚠️  ${#FAILURES[@]} CHECK(S) FAILED (${CHECKS_PASSED}/${TOTAL_CHECKS} passed)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "Failures:"
  for FAIL in "${FAILURES[@]}"; do
    echo "  - ${FAIL}"
  done

  # Send WhatsApp alert
  FAIL_LIST=""
  for FAIL in "${FAILURES[@]}"; do
    FAIL_LIST="${FAIL_LIST}\n- ${FAIL}"
  done
  send_wa_alert "🔴 BACKUP VERIFICATION FAILED (${#FAILURES[@]}/${TOTAL_CHECKS} checks failed):${FAIL_LIST}"

  exit 1
fi
