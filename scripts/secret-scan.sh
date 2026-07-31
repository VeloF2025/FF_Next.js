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
#   bash scripts/secret-scan.sh --tree                # audit: scan ALL tracked files
#
# --tree is an audit, deliberately NOT wired into the hooks or CI: the repo
# has pre-existing hits, so gating on it would block every commit until they
# are all cleaned up. Run it when auditing, not on every push.
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
  --tree)
    # Every tracked line, formatted like diff output so the rules below apply
    # unchanged. Lockfiles and vendored trees are excluded as pure noise.
    # `-n` and the filename are kept so a hit names its real file:line -- an
    # audit that cannot say WHERE is not actionable. `:/` anchors the pathspec
    # at the repo root, so running this from a subdirectory scans everything
    # rather than silently narrowing to the subtree. `-I` skips binaries.
    ADDED=$(git grep -nI '' -- ':/' \
              ':(exclude)scripts/secret-scan.sh' ':(exclude)*.lock' \
              ':(exclude)*lock.json' ':(exclude)node_modules/**' 2>/dev/null \
            | sed 's/^/+/' || true)
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
# NOTE: this list is applied case-INSENSITIVELY, so every term must be safe
# under -i. `\$[A-Z]` was not: it matched the `$w` inside a real password
# ("P@ss$w0rd123") and whitelisted it. It is now anchored to the assignment,
# which is what it was always meant to express -- "the value IS a variable
# reference". `here` is likewise anchored so it cannot match inside a value.
PLACEHOLDER='\byour\b|your_|example|placeholder|change[ _-]?me|x{4,}|<[^>]*>|REDACTED|\bhere\b|dummy|fake|sample|\.\.\.|\\n|\$\{|\$\(|=[[:space:]]*['"'"'"]?\$|process\.env|env\.|getenv|credentials\.local|\btest[-_]|\bmock|\bstub'

HITS=""
add_hits() { # $1 = grep -E pattern, $2 = label, $3 = "cs" for case-SENSITIVE
  # Rules that lean on [A-Z] MUST pass "cs": under -i, `[A-Z]` also matches
  # lowercase, which made an uppercase-only env rule fire on JSX props like
  # `showConfirmPassword={...}`. The placeholder filter stays case-insensitive.
  local found iflag="-i"
  [ "${3:-}" = "cs" ] && iflag=""
  # The placeholder test is applied to the MATCHED text, never the whole line.
  # Whole-line matching meant an unrelated trailing comment could whitelist a
  # real secret earlier on the same line -- e.g.
  #   API_TOKEN="<live value>"   # used against test-env
  # was silently suppressed by the `test-` term.
  # `grep -no` yields `<lineno>:<matched text>`, so the placeholder filter runs
  # against the MATCH while the line number is retained. Done in a fixed number
  # of passes rather than a subshell per hit -- the per-hit form was correct but
  # spawned processes per match, which made --tree unusable on a 2M-line tree.
  local nums
  nums=$(echo "$ADDED" | grep -noE $iflag "$1" 2>/dev/null | grep -viE "$PLACEHOLDER" \
         | cut -d: -f1 | sort -un | tr '\n' ' ')
  [ -z "$nums" ] && return 0
  found=$(echo "$ADDED" | awk -v want="$nums" \
            'BEGIN{n=split(want,a," ");for(i=1;i<=n;i++)s[a[i]]=1} s[NR]{print NR":"$0}')
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
  # Credential-named variable assigned a plaintext literal.
  # The long-hex rule above only catches machine-generated secrets; a
  # human-memorable password (`SUDO_PASS="..."`, `this.password = "..."`)
  # matched none of the rules and sat in four tracked scripts for months.
  # See PR #2332. `=` only, deliberately: allowing `:` as well pulled in
  # hundreds of false positives from lockfiles and JSON config.
  # No LEADING \b: `_` is a word character, so `\bPASS\b` cannot match inside
  # `SUDO_PASS` -- which is exactly how the leak went unseen. The TRAILING \b
  # stays, forcing the keyword to end the identifier, which keeps enum values
  # like PASSPORT / PASSED / BYPASS_PERMISSIONS out.
  #
  # KEY is only recognised behind a credential-bearing prefix (API/SECRET/
  # PRIVATE/...). A bare `KEY` matched React `key={...}` props and SQL
  # `parent_key = parent.key` across the tree.
  # `$` is rejected only as the FIRST character (a variable reference); a `$`
  # inside the value is legitimate in a real password like "P@ss$w0rd123".
  add_hits "[A-Za-z0-9_]*(PASSWORD|PASSWD|PASS|PWD|SECRET|TOKEN|(API|SECRET|PRIVATE|SIGNING|ENCRYPTION|MASTER|ACCESS|AUTH|CLIENT)[_-]?KEY)\b['\"]?[[:space:]]*=[[:space:]]*['\"][^'\"[:space:]\$][^'\"[:space:]]{5,}" "hardcoded password/secret literal"
  # Unquoted shell/.env assignment, e.g. an `export FOO_TOKEN=<value>` line.
  # Deliberately narrow -- an UPPERCASE name and NO whitespace around `=`. That
  # is the .env/export idiom, and it excludes ordinary code assignments like
  # `const token = parse(...)` or `this.password = config.password`, which a
  # general unquoted rule swept up by the hundreds.
  add_hits "(^|[+:[:space:]])[A-Z0-9_]*(PASSWORD|PASSWD|PASS|PWD|SECRET|TOKEN|(API|SECRET|PRIVATE|SIGNING|ENCRYPTION|MASTER|ACCESS|AUTH|CLIENT)[_-]?KEY)=[^'\"[:space:]\$][^'\"[:space:]]{5,}" "hardcoded secret in env-style assignment" cs
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
