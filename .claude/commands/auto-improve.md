# /auto-improve — FibreFlow Autonomous Improvement Cycle

Execute ONE improvement cycle. Find the highest-impact fix, implement it, validate through full CI gates, ship it. No approval needed.

## Arguments
$ARGUMENTS — Optional focus area (e.g. "lint", "tests", "types"). If empty, auto-detect.

## Phase 0: Setup

```bash
TEST_CMD="npx vitest run"
LINT_CMD="npm run lint"
TYPE_CHECK="npx tsc --noEmit"
CI_GATE="bash scripts/ci-local.sh --quick"
SRC_DIR="src"
EXT="ts"

# Ratchet baselines (from scripts/ci-local.sh — never exceed these)
MAX_LINT_WARNINGS=3790
MAX_LINT_ERRORS=77
MAX_SILENT_CATCHES=91
```

**Worktree required.** All edits must happen in a dedicated worktree, never in the main `/home/hein/Workspace/FF_Next.js` tree:
```bash
git fetch origin master --quiet
git worktree add /home/hein/Workspace/FF_Next.js-<task> -b <branch> origin/master
ln -sf /home/hein/Workspace/FF_Next.js/node_modules /home/hein/Workspace/FF_Next.js-<task>/node_modules
```

## Phase 1: Diagnose (pick the highest-signal problem)

Run these in order, stop at the first actionable signal:

```bash
# 1. Failing tests (highest priority)
npx vitest run 2>&1 | grep "Test Files\|Tests " | tail -2

# 2. Lint errors/warnings vs baseline
npm run lint 2>&1 | grep -P '\d+ problems' | tail -1

# 3. TypeScript errors
npx tsc --noEmit 2>&1 | grep "error TS" | wc -l

# 4. Silent catches above baseline
npx eslint pages/api --ext .ts --rulesdir scripts/eslint-rules --rule '{"no-silent-catch": "warn"}' 2>&1 | grep -c "no-silent-catch" || echo 0

# 5. Tech debt markers
grep -r "TODO\|FIXME\|HACK\|BROKEN" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | head -10

# 6. Files over 300 LOC
find src/ \( -name "*.ts" -o -name "*.tsx" \) | xargs wc -l 2>/dev/null | sort -n | awk '$1>300' | tail -5
```

## Phase 2: Pick ONE improvement

Choose the single highest-impact change in ≤50 lines / ≤3 files. Prioritize:
1. Failing tests — fix the most common error pattern across multiple files
2. Lint errors at or above `MAX_LINT_ERRORS=77` — fix new errors first
3. TypeScript errors — fix the easiest repeating pattern
4. Silent catches — add proper `log.error(...)` calls
5. Files over 300 LOC — extract one large function
6. TODO/FIXME — complete one marked item

## Phase 3: Capture Baseline, Implement & Validate

### Step 3a: Capture BEFORE counts (MANDATORY — do this before touching any files)

```bash
# Capture lint warning count before any changes
LINT_BEFORE=$(npm run lint 2>&1 | grep -oP '\d+ warning' | head -1 | grep -oP '\d+' || echo 9999)
LINT_ERRORS_BEFORE=$(npm run lint 2>&1 | grep -oP '\d+ error' | head -1 | grep -oP '\d+' || echo 9999)

# Capture TypeScript error count before any changes
TYPE_BEFORE=$(npx tsc --noEmit 2>&1 | grep -c "error TS" || echo 9999)

echo "BASELINE: lint_warnings=$LINT_BEFORE lint_errors=$LINT_ERRORS_BEFORE type_errors=$TYPE_BEFORE"
```

These numbers are your gate. **Do not proceed without capturing them.**

### Step 3b: Implement the change

1. Make the change in the worktree (max 3 files, max 50 lines added)

2. Run targeted tests for the changed area first:
   ```bash
   npx vitest run <path-to-related-tests>
   ```

### Step 3c: Capture AFTER counts and enforce the gate

```bash
# Re-run lint and type-check after the change
LINT_AFTER=$(npm run lint 2>&1 | grep -oP '\d+ warning' | head -1 | grep -oP '\d+' || echo 9999)
LINT_ERRORS_AFTER=$(npm run lint 2>&1 | grep -oP '\d+ error' | head -1 | grep -oP '\d+' || echo 9999)
TYPE_AFTER=$(npx tsc --noEmit 2>&1 | grep -c "error TS" || echo 9999)

echo "AFTER:    lint_warnings=$LINT_AFTER lint_errors=$LINT_ERRORS_AFTER type_errors=$TYPE_AFTER"
```

**Enforce the reduction gate — if either check fails, revert immediately:**

```bash
# GATE 1: lint warnings must be strictly lower after the change
if [ "$LINT_AFTER" -ge "$LINT_BEFORE" ]; then
  echo "BLOCKED: lint warnings did not reduce ($LINT_BEFORE → $LINT_AFTER)"
  git checkout -- .
  echo "RESULT: NEUTRAL — reverted, no net improvement"
  exit 1
fi

# GATE 2: TypeScript errors must not increase
if [ "$TYPE_AFTER" -gt "$TYPE_BEFORE" ]; then
  echo "BLOCKED: TypeScript errors increased ($TYPE_BEFORE → $TYPE_AFTER)"
  git checkout -- .
  echo "RESULT: REGRESSED — reverted to protect codebase"
  exit 1
fi

echo "GATE PASSED: lint $LINT_BEFORE → $LINT_AFTER (reduced), types $TYPE_BEFORE → $TYPE_AFTER (ok)"
```

**If the gate fails:** stop, report `RESULT: NEUTRAL` or `RESULT: REGRESSED`, and do not open a PR. Cycles that don't reduce lint are not improvements — they are churn.

### Step 3d: Full CI gate

**Run full CI gate — must pass before any commit:**
```bash
bash scripts/ci-local.sh --quick
```
If this fails: **fix the failure or revert entirely.** Never commit past a failing CI gate.

### Step 3e: Full test suite

```bash
npx vitest run 2>&1 | tail -4
```

**Only commit once all gates are green AND lint warnings reduced AND TypeScript errors did not increase.**

## Phase 4: Commit, Push, Open PR

```bash
git add <specific files — never git add -A>
git commit -m "$(cat <<'EOF'
fix/feat/chore(<scope>): <description>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"

git push -u origin <branch>

gh pr create \
  --title "<same as commit subject>" \
  --body "$(cat <<'EOF'
## Summary
- <bullet points>

## CI
- [x] `bash scripts/ci-local.sh --quick` passes
- [x] `npx vitest run` — X passing / Y failing (was A / B)
- [x] Lint warnings: W (was W0) — reduced by (W0 - W)
- [x] TypeScript errors: N (was M) — no regression

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## Phase 5: Measure & Report

```bash
VITEST_OUT=$(npx vitest run 2>&1)
PASS=$(echo "$VITEST_OUT" | grep -oP '\d+ passed' | head -1 | grep -oP '\d+' || echo "?")
FAIL=$(echo "$VITEST_OUT" | grep -oP '\d+ failed' | head -1 | grep -oP '\d+' || echo "0")

LINT_OUT=$(npm run lint 2>&1)
LINT_ERRORS=$(echo "$LINT_OUT" | grep -oP '\d+ error' | head -1 | grep -oP '\d+' || echo "0")
LINT_WARNINGS=$(echo "$LINT_OUT" | grep -oP '\d+ warning' | head -1 | grep -oP '\d+' || echo "0")

TYPE_ERRORS=$(npx tsc --noEmit 2>&1 | grep -c "error TS" || echo 0)

mkdir -p logs/benchmarks
echo "{\"timestamp\":\"$(date -Iseconds)\",\"tests_passing\":$PASS,\"tests_failing\":$FAIL,\"lint_errors\":$LINT_ERRORS,\"lint_warnings\":$LINT_WARNINGS,\"type_errors\":$TYPE_ERRORS}" \
  | tee logs/benchmarks/latest.json >> logs/benchmarks/history.jsonl
```

Output EXACTLY this format:
```
## Iron Assay — FF_Next.js — [timestamp]
CHANGE: [one-line description]
FILES:  [files modified]
TESTS:  [X passing / Y failing] (was [A / B])
LINT:   [E errors / W warnings] (was [E0 / W0]) — delta: [W0-W reduced / BLOCKED]
TYPES:  [N errors] (was [M]) — delta: [M-N reduced / no change / BLOCKED]
CI:     [PASS / FAIL]
RESULT: [IMPROVED / NEUTRAL / REGRESSED]
PR:     [URL or N/A if reverted]
NEXT:   [what the next cycle should tackle]
```

## Hard Rules
- **Worktree always** — never edit `/home/hein/Workspace/FF_Next.js` directly
- **`ci:quick` must pass before every PR** — no exceptions, no shortcuts
- **Never raise the ratchet baselines** (MAX_LINT_WARNINGS, MAX_LINT_ERRORS, MAX_SILENT_CATCHES)
- **Lint warnings MUST be strictly lower after the change** — if not, revert and report NEUTRAL
- **TypeScript errors MUST NOT increase** — if they do, revert and report REGRESSED
- ONE change per cycle, max 3 files, max 50 lines
- Never modify `.env*`, `secrets`, or CI configs unless explicitly specified in $ARGUMENTS
- Never restart services
- Fix or revert — never leave the codebase worse than you found it
- If nothing to improve: `RESULT: CLEAN — no improvements needed`
- Cycles that don't reduce lint are churn — revert them, don't ship them
