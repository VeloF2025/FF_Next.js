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
    # Both ends must resolve BEFORE the diff runs. `git diff` on an unknown ref
    # prints to stderr and produces no stdout, which `2>/dev/null ... || true`
    # then turned into an empty ADDED and a green "scan passed" -- a scan that
    # covered nothing reporting success. GitHub sends the all-zero SHA as
    # `before` on a branch's first push, so this was reachable, not theoretical.
    for ref in "$BASE" "$HEAD"; do
      if ! git rev-parse --verify --quiet "${ref}^{commit}" >/dev/null 2>&1; then
        echo -e "${RED}secret-scan: cannot resolve '${ref}' — refusing to report a clean scan.${NC}"
        exit 2
      fi
    done
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
              ':(exclude):/scripts/secret-scan.sh' ':(exclude):/*.lock' \
              ':(exclude):/*lock.json' ':(exclude):/node_modules/**' 2>/dev/null \
            | sed 's/^/+/' || true)
    ;;
  --branch)
    # Fails CLOSED. This mode previously warned and exited 0 when it could not
    # find a base, which was survivable while it ran only from ci-local.sh (where
    # origin/master always exists) but is not survivable as a CI gate: a runner
    # that failed to fetch the base branch would report a clean scan over an
    # empty diff, and the gate would be exactly the paper guarantee this replaced.
    if ! git rev-parse --verify --quiet origin/master >/dev/null 2>&1; then
      echo -e "${RED}secret-scan: origin/master is not available — nothing was scanned.${NC}"
      echo    "Fetch it first (git fetch origin master). Refusing to report a clean scan."
      exit 2
    fi
    BASE=$(git merge-base origin/master HEAD 2>/dev/null || true)
    if [ -z "$BASE" ]; then
      echo -e "${RED}secret-scan: no merge-base with origin/master — nothing was scanned.${NC}"
      echo    "Refusing to report a clean scan over an empty diff."
      exit 2
    fi
    ADDED=$(git diff "$BASE"..HEAD --unified=0 2>/dev/null | grep -E '^\+' | grep -vE '^\+\+\+' || true)
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
# `\btest[-_]` is anchored to an ASSIGNMENT so it can only match inside a KEY.
# Unanchored it was applied to the whole matched span, which includes the VALUE,
# so any secret whose value merely began with the four characters t-e-s-t-dash
# whitelisted itself. That is the same "the filter can see the value" bug the
# comment below records for the whole-line form, one level in. A key such as
# TEST_PASSWORD still matches the term and stays exempt.
#
# (Deliberately described rather than shown: an assignment-shaped example here
# is itself caught by the rule below, as this file's own gate demonstrated.)
#
# `:pass@` / `:password@` cover the documented placeholder connection URI
# (`postgresql://user:pass@host`), which the URI rule would otherwise flag.
PLACEHOLDER='\byour\b|your_|example|placeholder|change[ _-]?me|x{4,}|<[^>]*>|REDACTED|\bhere\b|dummy|fake|sample|\.\.\.|\\n|\$\{|\$\(|=[[:space:]]*['"'"'"]?\$|process\.env|env\.|getenv|credentials\.local|\btest[-_][A-Za-z0-9_]*[[:space:]]*[:=]|\bmock|\bstub|:pass(word)?@|:secret@'

HITS=""
add_hits() { # $1 = pattern, $2 = label, $3 = "cs" for case-SENSITIVE, $4 = extra
             #      regex the MATCHED span must also satisfy
  # $4 exists for rules whose shape is common in ordinary code. The colon rule
  # matches `key: 'value'`, which is also an error-message map, a JSON schema
  # example and a type annotation. Requiring a digit somewhere in the span
  # separates `password: 'Incorrect password.'` from a real credential without
  # needing a dictionary. ERE has no lookahead, so this cannot be folded into
  # the pattern itself.
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
  local nums require="${4:-}"
  if [ -n "$require" ]; then
    # `grep -no` emits `<lineno>:<matched text>`, so testing the whole line
    # would let the LINE NUMBER satisfy a digit requirement and the filter would
    # never reject anything. Strip the prefix and test only the match.
    nums=$(echo "$ADDED" | grep -noE $iflag "$1" 2>/dev/null | grep -viE "$PLACEHOLDER" \
           | awk -v re="$require" '{ t=$0; sub(/^[0-9]+:/,"",t); if (t ~ re) print }' \
           | cut -d: -f1 | sort -un | tr '\n' ' ')
  else
    nums=$(echo "$ADDED" | grep -noE $iflag "$1" 2>/dev/null | grep -viE "$PLACEHOLDER" \
           | cut -d: -f1 | sort -un | tr '\n' ' ')
  fi
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
  # The prefix class includes `.` so a match starts at `process.env.DB_PASSWORD`
  # rather than at `DB_PASSWORD`. Without it the match-scoped placeholder can no
  # longer see the `process\.env` term, and all 47 existing
  # `process.env.<CRED> = '<value>'` test fixtures across 18 files would block
  # pre-commit on unrelated PRs.
  add_hits "[A-Za-z0-9_.]*(PASSWORD|PASSWD|PASS|PWD|SECRET|TOKEN|(API|SECRET|PRIVATE|SIGNING|ENCRYPTION|MASTER|ACCESS|AUTH|CLIENT)[_-]?KEY)\b['\"]?[[:space:]]*=[[:space:]]*['\"][^'\"[:space:]\$][^'\"[:space:]]{5,}" "hardcoded password/secret literal"
  # Unquoted shell/.env assignment, e.g. an `export FOO_TOKEN=<value>` line.
  # Deliberately narrow -- an UPPERCASE name and NO whitespace around `=`. That
  # is the .env/export idiom, and it excludes ordinary code assignments like
  # `const token = parse(...)` or `this.password = config.password`, which a
  # general unquoted rule swept up by the hundreds.
  # 12-char minimum (vs 6 when quoted): an unquoted ALL_CAPS assignment is also
  # how prose refers to a flag, so a short English word like
  # `CORTEX_FORWARD_TOKEN=enabled` inside a test title tripped it. Real unquoted
  # env secrets are long; the quoted rule still catches short ones.
  add_hits "(^|[+:[:space:]])[A-Z0-9_]*(PASSWORD|PASSWD|PASS|PWD|SECRET|TOKEN|(API|SECRET|PRIVATE|SIGNING|ENCRYPTION|MASTER|ACCESS|AUTH|CLIENT)[_-]?KEY)=[^'\"[:space:]\$][^'\"[:space:]]{11,}" "hardcoded secret in env-style assignment" cs
  # Credential embedded in a connection URI: scheme://user:secret@host
  #
  # THE shape that matters. Issue #1830 — the leak this scanner exists to
  # prevent — was a Postgres connection URI, and CLAUDE.md documents the
  # `psql "postgresql://…"` form. Every rule above needs a credential keyword
  # next to an `=`; a URI has neither, so none of them matched it.
  #
  # The 6-char minimum on the password segment is what excludes the documented
  # placeholder `postgresql://user:pass@host` without needing to enumerate
  # placeholder words; `${VAR}` and `<your-password>` are caught by the
  # PLACEHOLDER filter. The host must start with a word character so an email
  # address in prose cannot masquerade as a URI authority.
  add_hits "[a-z][a-z0-9+.-]{1,14}://[A-Za-z0-9_.%+-]+:[^@[:space:]/'\"]{6,}@[A-Za-z0-9_.-]" "credential in connection URI"
  # Credential-named key assigned with a COLON — YAML, JSON, docker-compose.
  #
  # Kept as its own rule rather than adding `:` to the `=` rule above, whose
  # comment records that allowing `:` there "pulled in hundreds of false
  # positives from lockfiles and JSON config". The difference is that this one
  # requires the key to END with a credential word (trailing \b) AND the value
  # to be a quoted 6+ character run, which no lockfile integrity/resolved field
  # satisfies.
  # The digit requirement is what makes this rule usable. Without it it fires on
  # `'auth/wrong-password': 'Incorrect password.'` (an error map) and
  # `"password": "string"` (a schema example) — both measured in this tree.
  # Machine-generated credentials essentially always carry a digit; the `=` rule
  # above is unchanged and still catches a digit-less quoted secret.
  # `(^|[^A-Za-z])` before the keyword, NOT the `=` rule's `[A-Za-z0-9_.-]*`.
  # That prefix lets letters run straight into the keyword, so `minipass` — a
  # real npm package appearing 29 times across package-lock.json and bun.lock —
  # matched PASS and every lockfile update would have tripped the gate. A
  # non-letter boundary still admits `DB_PASSWORD`, `db_pass` and `"password"`,
  # because `_`, `-`, `.` and quotes are all non-letters.
  add_hits "(^|[^A-Za-z])(PASSWORD|PASSWD|PASS|PWD|SECRET|TOKEN|(API|SECRET|PRIVATE|SIGNING|ENCRYPTION|MASTER|ACCESS|AUTH|CLIENT)[_-]?KEY)\b['\"]?[[:space:]]*:[[:space:]]*['\"][^'\"[:space:]\$][^'\"[:space:]]{5,}" "hardcoded credential in colon assignment" "" "[0-9]"
  # Lowercase unquoted env assignment — `db_pass=<value>`.
  #
  # The uppercase rule above is deliberately case-SENSITIVE (under -i its
  # `[A-Z]` class also matches lowercase and fired on JSX props like
  # `showConfirmPassword={...}`), so it cannot simply be relaxed. This is the
  # lowercase twin, equally case-sensitive, with the same 12-char minimum that
  # keeps prose like `cortex_token=enabled` out.
  add_hits "(^|[+:[:space:]])[a-z0-9_.-]*(password|passwd|pass|pwd|secret|token)=[^'\"[:space:]\$][^'\"[:space:]]{11,}" "hardcoded secret in env-style assignment" cs
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
