#!/bin/bash
# =============================================================================
# Secret Scanner — blocks newly-added credentials before they reach git/GitHub
# =============================================================================
# Scans ADDED lines only (diff-based) so it never trips on pre-existing content;
# the goal is to stop NEW leaks, not to require a spotless tree. A small set of
# already-burned literal values is additionally blocked tree-wide so they can
# never be reintroduced.
#
# Context: 2026-05-29 — the Postgres superuser password and the `zander`
# SSH/sudo password were committed in plaintext across handoff docs, plans and
# deploy docs, pushed to GitHub, and burned into history. See issue #1830.
#
# Usage:
#   bash scripts/secret-scan.sh --staged              # pre-commit: staged changes
#   bash scripts/secret-scan.sh --range <base> <head> # pre-push: pushed range
#   bash scripts/secret-scan.sh --branch              # CI: diff vs origin/master
#
# Exit 0 = clean, 1 = secret(s) found.
# Bypass (emergency only, never for real secrets): git commit/push --no-verify
# =============================================================================

set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

MODE="${1:---staged}"

# ── Collect the added (+) lines to inspect ───────────────────────────────────
case "$MODE" in
  --staged)
    ADDED=$(git diff --cached --unified=0 2>/dev/null | grep -E '^\+' | grep -vE '^\+\+\+' || true)
    ;;
  --range)
    BASE="${2:-}"; HEAD="${3:-}"
    if [ -z "$BASE" ] || [ -z "$HEAD" ]; then
      echo -e "${RED}secret-scan: --range needs <base> <head>${NC}"; exit 2
    fi
    ADDED=$(git diff "$BASE" "$HEAD" --unified=0 2>/dev/null | grep -E '^\+' | grep -vE '^\+\+\+' || true)
    ;;
  --branch)
    BASE=$(git merge-base origin/master HEAD 2>/dev/null || true)
    if [ -z "$BASE" ]; then
      echo -e "${YELLOW}secret-scan: no merge-base with origin/master — skipping diff scan${NC}"
      ADDED=""
    else
      ADDED=$(git diff "$BASE"..HEAD --unified=0 2>/dev/null | grep -E '^\+' | grep -vE '^\+\+\+' || true)
    fi
    ;;
  *)
    echo -e "${RED}secret-scan: unknown mode '$MODE'${NC}"; exit 2
    ;;
esac

# Lines that look like placeholders / safe references — never a real secret.
PLACEHOLDER='\byour\b|your_|example|placeholder|change[ _-]?me|x{4,}|<[^>]*>|REDACTED|here|dummy|fake|sample|\.\.\.|\\n|\$\{|\$\(|\$[A-Z]|process\.env|env\.|getenv|credentials\.local'

HITS=""
add_hits() { # $1 = grep -E pattern, $2 = label
  local found
  found=$(echo "$ADDED" | grep -nEi "$1" 2>/dev/null | grep -viE "$PLACEHOLDER" || true)
  if [ -n "$found" ]; then
    HITS="${HITS}\n  [${2}]\n$(echo "$found" | sed 's/^/    /')\n"
  fi
}

if [ -n "$ADDED" ]; then
  # PGPASSWORD with a literal value (not $VAR / placeholder)
  add_hits "PGPASSWORD=['\"]?[A-Za-z0-9]{12,}" "hardcoded PGPASSWORD"
  # Sudo password piped to sudo -S
  add_hits "echo +['\"][^'\"\$]{4,}['\"] *\| *sudo -S" "hardcoded sudo password"
  # Long hex secret assigned to a SECRET/PASSWORD/TOKEN/KEY
  add_hits "(SECRET|PASSWORD|PASSWD|TOKEN|API[_-]?KEY)['\"]?\s*[:=]\s*['\"]?[A-Fa-f0-9]{32,}" "hardcoded long-hex secret"
  # AWS access key id
  add_hits "AKIA[0-9A-Z]{16}" "AWS access key id"
  # Private key block (placeholder lines already excluded above)
  add_hits "BEGIN ([A-Z]+ )?PRIVATE KEY" "private key material"
fi

# ── Tree-wide denylist: values already burned — must never reappear anywhere ──
DENYLIST_HITS=$(git grep -nE 'a23f6104debd1d3e88e8f00c0067f22f|zander2026' -- . ':(exclude)scripts/secret-scan.sh' 2>/dev/null || true)
if [ -n "$DENYLIST_HITS" ]; then
  HITS="${HITS}\n  [previously-leaked value reintroduced — see issue #1830]\n$(echo "$DENYLIST_HITS" | sed 's/^/    /')\n"
fi

if [ -n "$HITS" ]; then
  echo -e "${RED}🚫 Secret scan FAILED — credential-like content detected:${NC}"
  echo -e "$HITS"
  echo -e "${YELLOW}Secrets must live only in .claude/credentials.local.md (gitignored) or env files.${NC}"
  echo    "Use a placeholder + reference instead of the literal value, e.g.:"
  echo    "  PGPASSWORD=\"\$PGPASSWORD\" psql ...   # see .claude/credentials.local.md"
  echo    "If a real secret reached git, it is compromised — rotate it (issue #1830)."
  exit 1
fi

echo -e "${GREEN}✅ Secret scan passed — no new credential-like content.${NC}"
exit 0
