#!/usr/bin/env bash
# =============================================================================
# verify-storage-privacy.sh — prove the private storage prefixes are unreachable
# =============================================================================
# The H&S attachment design stores medical certificates and contractor
# compliance documents under /storage/hs-private/. Those bytes are private for
# exactly one reason: nginx returns 403 for the prefix. The application cannot
# enforce it — VF Storage on :8091 has no auth of its own, and the proxy is
# what stands between an object and the open internet.
#
# So the guarantee is a deploy-time property, not a code property, and it is
# checked here rather than assumed. Run this AFTER reloading nginx and BEFORE
# deploying the app: if the app ships first, medical certificates are public.
#
# Usage:
#   bash scripts/verify-storage-privacy.sh [base-url]
#
# Defaults to https://app.fibreflow.app. Pass a base URL to check another
# environment, e.g. https://dev.fibreflow.app or http://localhost:3000.
#
# Exit codes:
#   0 — every private prefix is refused
#   1 — at least one private prefix is reachable (DO NOT DEPLOY)
#   2 — could not reach the host at all
# =============================================================================

set -euo pipefail

BASE_URL="${1:-https://app.fibreflow.app}"
BASE_URL="${BASE_URL%/}"

# Probe paths point at files that do not exist. A correctly-guarded prefix
# returns 403 before nginx ever asks the storage service, so a nonexistent name
# is enough — and it means this script never needs a real medical certificate
# to test with.
PRIVATE_PREFIXES=(
  "/storage/hs-private/medicals/verify-privacy-probe.pdf"
  "/storage/hs-private/contractor_documents/verify-privacy-probe.pdf"
  "/storage/hs-private/appointment_letters/verify-privacy-probe.pdf"
  # Case variation: the rule is ~* for this reason. Measured against the
  # case-sensitive payslips rule, an uppercase path returns 404 rather than
  # 403 — it misses the regex and is proxied. This probe fails if someone
  # changes ~* back to ~.
  "/storage/HS-PRIVATE/medicals/verify-privacy-probe.pdf"
  # Traversal in from an open prefix. nginx normalises the path before it
  # matches a location, so this must land on the 403 — proving normalisation
  # rather than assuming it.
  "/storage/staff/documents/../hs-private/medicals/verify-privacy-probe.pdf"
  # Control: a prefix already guarded in production. If this one stops
  # returning 403, the script is measuring something other than what it thinks
  # — a green run with every probe passing for an unrelated reason.
  "/storage/staff/payslips/verify-privacy-probe.pdf"
)

echo "Verifying private storage prefixes on ${BASE_URL}"
echo

if ! curl -fsS -o /dev/null --max-time 15 "${BASE_URL}/storage/" 2>/dev/null; then
  # A 404 from /storage/ is fine and expected — it means the proxy answered.
  # Total failure to connect is not, and would make every check below "pass"
  # for the wrong reason.
  if ! curl -sS -o /dev/null --max-time 15 "${BASE_URL}/storage/" 2>/dev/null; then
    echo "ERROR: cannot reach ${BASE_URL} — not verifying anything."
    exit 2
  fi
fi

FAILED=0

for path in "${PRIVATE_PREFIXES[@]}"; do
  # --no-keepalive so each probe is judged on its own response, and an explicit
  # timeout so a hung proxy fails loudly rather than hanging a deploy.
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 --no-keepalive "${BASE_URL}${path}" || echo "000")

  if [[ "$code" == "403" ]]; then
    printf '  \033[32mOK\033[0m    %s  → %s\n' "$code" "$path"
  else
    printf '  \033[31mFAIL\033[0m  %s  → %s\n' "$code" "$path"
    FAILED=1
  fi
done

echo

if [[ "$FAILED" -ne 0 ]]; then
  cat <<'MSG'
FAILED: at least one private prefix is not returning 403.

The nginx rule is missing or has not been reloaded. Until it is, uploaded
medical certificates are readable by anyone holding the URL.

Fix:
  sudo cp docs/VPS/vf-fibreflow.nginx.conf /etc/nginx/sites-enabled/vf-fibreflow
  sudo nginx -t && sudo systemctl reload nginx
  bash scripts/verify-storage-privacy.sh

DO NOT deploy the application until this passes.
MSG
  exit 1
fi

echo "All private storage prefixes are refused (403). Safe to deploy."
