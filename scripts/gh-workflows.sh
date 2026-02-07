#!/bin/bash
# FF Project - GitHub CLI Workflows
# Source this in your .bashrc or .zshrc:
#   source ~/Workspace/FF_Next.js/scripts/gh-workflows.sh

# === DAILY SYNC ===
ff-sync() {
  echo "=== FF Daily Sync ==="
  echo ""

  echo "PRs Needing Your Review:"
  gh pr list --search "review-requested:@me" --json number,title,author \
    --template '{{range .}}  #{{.number}} {{.title}} ({{.author.login}}){{"\n"}}{{end}}'

  echo ""
  echo "Your Open PRs:"
  gh pr list --author @me --state open --json number,title,reviewDecision \
    --template '{{range .}}  #{{.number}} {{.title}} [{{.reviewDecision}}]{{"\n"}}{{end}}'

  echo ""
  echo "Failed CI Runs:"
  gh run list --status failure --limit 3 2>/dev/null || echo "  No failed runs"

  echo ""
  echo "Your Assigned Issues:"
  gh issue list --assignee @me --state open --limit 5 2>/dev/null || echo "  No assigned issues"

  echo ""
  echo "=== End Sync ==="
}

# === CREATE PR ===
ff-pr() {
  local title="$1"
  local body="$2"

  if [ -z "$title" ]; then
    # Interactive mode - opens web
    gh pr create --fill --web
  else
    # Generate body if not provided
    if [ -z "$body" ]; then
      local branch=$(git branch --show-current)
      local commits=$(git log main..HEAD --oneline 2>/dev/null || git log develop..HEAD --oneline)

      body="## Summary
${title}

## Changes
\`\`\`
${commits}
\`\`\`

## Testing
- [ ] Unit tests pass (\`npm test\`)
- [ ] Type check passes (\`npm run type-check\`)
- [ ] Manual testing completed

## TDD Compliance
- [ ] Test spec created before implementation
- [ ] All new code has corresponding tests

---
Generated with Claude Code"
    fi

    gh pr create --title "$title" --body "$body"
  fi
}

# === QUICK REVIEW ===
ff-review() {
  local pr_num="$1"
  if [ -z "$pr_num" ]; then
    echo "Usage: ff-review <pr-number>"
    return 1
  fi

  echo "=== PR #$pr_num Details ==="
  gh pr view "$pr_num"

  echo ""
  echo "=== Changes (first 100 lines) ==="
  gh pr diff "$pr_num" --color always | head -100

  echo ""
  echo "[Run 'gh pr diff $pr_num' for full diff]"
  echo "[Run 'gh pr checkout $pr_num' to test locally]"
}

# === WATCH CI ===
ff-watch() {
  local run_id="$1"
  if [ -z "$run_id" ]; then
    gh run watch
  else
    gh run watch "$run_id"
  fi
  echo "CI Complete!"
}

# === MERGE PR ===
ff-merge() {
  local pr_num="$1"
  if [ -z "$pr_num" ]; then
    echo "Usage: ff-merge <pr-number>"
    return 1
  fi

  echo "PR #$pr_num:"
  gh pr view "$pr_num" --json title,reviewDecision,statusCheckRollup \
    --template 'Title: {{.title}}
Review: {{.reviewDecision}}
CI: {{range .statusCheckRollup}}{{.name}}: {{.conclusion}} {{end}}'

  echo ""
  read -p "Approve and merge PR #$pr_num? (y/n) " confirm
  if [ "$confirm" = "y" ]; then
    gh pr review "$pr_num" --approve
    gh pr merge "$pr_num" --squash --delete-branch
    echo "PR #$pr_num merged!"
  fi
}

# === CHECK TEAMMATE ===
ff-team() {
  local teammate="${1:-louis}"
  echo "=== ${teammate}'s Open PRs ==="
  gh pr list --author "$teammate" --state open

  echo ""
  echo "=== ${teammate}'s Recent Commits ==="
  git log --author="$teammate" --oneline -5 2>/dev/null || echo "No local commits found"
}

# === CREATE ISSUE ===
ff-issue() {
  local title="$1"
  if [ -z "$title" ]; then
    gh issue create --web
  else
    gh issue create --title "$title" --body "$2"
  fi
}

# === TDD VALIDATION ===
ff-tdd-check() {
  echo "=== TDD Compliance Check ==="

  # Get changed files compared to main/develop
  local base_branch="main"
  git rev-parse --verify main >/dev/null 2>&1 || base_branch="develop"

  local changed_src=$(git diff --name-only "$base_branch" | grep "^src/modules/" | grep -v ".test.ts" | grep -v "__tests__")

  if [ -z "$changed_src" ]; then
    echo "No module changes detected."
    return 0
  fi

  echo "Changed source files:"
  echo "$changed_src"
  echo ""

  local missing_tests=0
  for file in $changed_src; do
    # Extract module name
    local module=$(echo "$file" | sed 's|src/modules/\([^/]*\)/.*|\1|')
    local test_dir="tests/unit/modules/$module"
    local inline_test_dir="src/modules/$module/__tests__"

    if [ ! -d "$test_dir" ] && [ ! -d "$inline_test_dir" ]; then
      echo "[MISSING] No tests for module: $module"
      missing_tests=$((missing_tests + 1))
    fi
  done

  echo ""
  if [ $missing_tests -gt 0 ]; then
    echo "[WARN] $missing_tests modules without tests"
    echo "Create tests before PR: /tdd generate"
    return 1
  else
    echo "[PASS] All changed modules have test directories"
  fi
}

# === FEATURE BRANCH ===
ff-feature() {
  local name="$1"
  if [ -z "$name" ]; then
    echo "Usage: ff-feature <feature-name>"
    echo "Creates: feature/<feature-name> branch from develop"
    return 1
  fi

  git checkout develop
  git pull origin develop
  git checkout -b "feature/$name"
  echo "Created and switched to: feature/$name"
}

# === FIX BRANCH ===
ff-fix() {
  local name="$1"
  if [ -z "$name" ]; then
    echo "Usage: ff-fix <fix-name>"
    echo "Creates: fix/<fix-name> branch from develop"
    return 1
  fi

  git checkout develop
  git pull origin develop
  git checkout -b "fix/$name"
  echo "Created and switched to: fix/$name"
}

# === STAGING DEPLOY ===
ff-deploy() {
  local branch="${1:-master}"
  local deploy_dir="/home/louis/apps/fibreflow"

  echo "=== FF Staging Deployment ==="
  echo "Target: https://vf.fibreflow.app"
  echo "Branch: $branch"
  echo ""

  # Step 1: Build (as hein)
  sshpass -p "$HEIN_SSH_PASSWORD" ssh -o StrictHostKeyChecking=no hein@100.96.203.105 "cd $deploy_dir && \
    echo '📦 Stashing changes...' && git stash --include-untracked && \
    echo '📥 Fetching...' && git fetch origin && \
    echo '🔀 Checking out $branch...' && git checkout $branch && git pull origin $branch && \
    echo '📦 Installing...' && npm install && \
    echo '🔨 Building...' && npm run build && \
    echo '✅ Build complete!' && git log -1 --oneline"

  # Step 2: Restart (as velo)
  echo "🔄 Restarting service..."
  sshpass -p "$VELO_SSH_PASSWORD" ssh -o StrictHostKeyChecking=no velo@100.96.203.105 \
    "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart fibreflow.service"
  sleep 3

  echo ""
  local status=$(curl -s -o /dev/null -w "%{http_code}" https://vf.fibreflow.app)
  if [ "$status" = "200" ]; then
    echo "🌐 vf.fibreflow.app: OK (HTTP $status)"
  else
    echo "⚠️ vf.fibreflow.app: HTTP $status"
  fi
}

# === STAGING STATUS ===
ff-deploy-status() {
  echo "=== FF Staging Status ==="
  sshpass -p "$HEIN_SSH_PASSWORD" ssh -o StrictHostKeyChecking=no hein@100.96.203.105 \
    "cd /home/louis/apps/fibreflow && echo 'Branch:' && git branch --show-current && echo 'Commit:' && git log -1 --oneline"

  echo ""
  echo "Service: $(sshpass -p "$HEIN_SSH_PASSWORD" ssh -o StrictHostKeyChecking=no hein@100.96.203.105 'systemctl is-active fibreflow.service')"

  local status=$(curl -s -o /dev/null -w "%{http_code}" https://vf.fibreflow.app)
  echo "HTTP: $status"
}

# === STAGING LOGS ===
ff-deploy-logs() {
  local lines="${1:-50}"
  echo "=== FF Staging Logs (last $lines lines) ==="
  sshpass -p "$VELO_SSH_PASSWORD" ssh -o StrictHostKeyChecking=no velo@100.96.203.105 \
    "echo '$VELO_SSH_PASSWORD' | sudo -S journalctl -u fibreflow.service -n $lines"
}

# === HELP ===
ff-help() {
  echo "FF GitHub Workflow Commands"
  echo "============================"
  echo ""
  echo "Daily:"
  echo "  ff-sync              Morning status check"
  echo ""
  echo "Branches:"
  echo "  ff-feature <name>    Create feature branch from develop"
  echo "  ff-fix <name>        Create fix branch from develop"
  echo ""
  echo "Pull Requests:"
  echo "  ff-pr                Create PR (opens web)"
  echo "  ff-pr \"title\"        Create PR with title"
  echo "  ff-review <num>      Quick review PR"
  echo "  ff-merge <num>       Approve and merge PR"
  echo ""
  echo "CI/Issues:"
  echo "  ff-watch             Watch current CI run"
  echo "  ff-issue             Create issue (opens web)"
  echo ""
  echo "Team:"
  echo "  ff-team              See Louis's PRs"
  echo "  ff-team <name>       See teammate's PRs"
  echo ""
  echo "TDD:"
  echo "  ff-tdd-check         Validate TDD compliance"
  echo ""
  echo "Staging (vf.fibreflow.app):"
  echo "  ff-deploy            Deploy master to staging"
  echo "  ff-deploy <branch>   Deploy specific branch"
  echo "  ff-deploy-status     Check staging status"
  echo "  ff-deploy-logs       View service logs"
  echo ""
}

echo "FF GitHub workflows loaded. Run 'ff-help' for commands."
