#!/usr/bin/env bash
# One-off: clear EAN-poisoned UPS serials and resync from OneMap.
#
# Problem: 116 DRs have ups_serial_scanned = '4897119170702' (the Gizzu EAN-13
# barcode, not the serial). The bad value originated in 1Map's br_ser field
# (field techs scanned the EAN). For some DRs 1Map has since been corrected;
# this script re-pulls the current value from OneMap and writes back only when
# it matches the Gizzu shape (GU18W + 10-16 alphanumeric chars).
#
# Run on Velocity: bash scripts/backfill-ups-ean-poisoned.sh
#
# Expected output: per-DR line showing OneMap value and action taken
# (RESTORED <serial> | STILL_BAD | UNKNOWN).
#
# Idempotent: rerunning is safe — only touches rows that are currently the EAN
# or NULL.

set -euo pipefail

PGPASSWORD=ff_x8Km2pQr9vLn
PSQL="psql -h localhost -p 5437 -U fibreflow_user -d fibreflow -At"
ONEMAP="${ONEMAP_HOST:-http://localhost:8003}"
EAN='4897119170702'

export PGPASSWORD

mapfile -t DROPS < <($PSQL -c "SELECT drop_number FROM dr_photo_unified_reviews WHERE ups_serial_scanned = '$EAN' ORDER BY drop_number;")

echo "Found ${#DROPS[@]} DRs poisoned with EAN $EAN"
restored=0
still_bad=0
unknown=0

for dr in "${DROPS[@]}"; do
  resp=$(curl -s -m 10 "${ONEMAP}/api/record/${dr}" || echo '{}')
  ups=$(printf '%s' "$resp" | python3 -c 'import sys,json; print((json.load(sys.stdin).get("ups_serial") or ""))' 2>/dev/null || echo '')

  if [[ "$ups" =~ ^GU18W[A-Z0-9]{10,16}$ ]]; then
    $PSQL -c "UPDATE dr_photo_unified_reviews SET ups_serial_scanned = '$ups', updated_at = NOW() WHERE drop_number = '$dr' AND ups_serial_scanned = '$EAN';" >/dev/null
    echo "${dr}  RESTORED  ${ups}"
    restored=$((restored + 1))
  elif [[ "$ups" == "$EAN" ]]; then
    $PSQL -c "UPDATE dr_photo_unified_reviews SET ups_serial_scanned = NULL, updated_at = NOW() WHERE drop_number = '$dr' AND ups_serial_scanned = '$EAN';" >/dev/null
    echo "${dr}  STILL_BAD (NULLed locally; 1Map still has EAN)"
    still_bad=$((still_bad + 1))
  else
    $PSQL -c "UPDATE dr_photo_unified_reviews SET ups_serial_scanned = NULL, updated_at = NOW() WHERE drop_number = '$dr' AND ups_serial_scanned = '$EAN';" >/dev/null
    echo "${dr}  UNKNOWN  (OneMap returned: '${ups}'; NULLed locally)"
    unknown=$((unknown + 1))
  fi
done

echo "---"
echo "restored=$restored  still_bad=$still_bad  unknown=$unknown  total=${#DROPS[@]}"
