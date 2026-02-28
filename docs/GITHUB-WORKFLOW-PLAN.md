# GitHub Workflow Implementation Plan

**For**: Hein & Louis collaboration on FF Project
**Created**: 2025-01-09
**Status**: Ready to implement

---

## Overview

This plan establishes consistent GitHub workflows for both developers using:
- GitHub MCP Server (Claude integration)
- gh CLI automation scripts
- Shared slash commands
- Optional GitHub Actions with Claude

**Goal**: Same context, same standards, same output - regardless of who runs Claude.

---

## Phase 1: GitHub MCP Server Setup

**Effort**: 10 minutes | **Impact**: High | **Priority**: Do first

### Steps

```bash
# 1.1 Verify gh CLI authentication
gh auth status

# If not authenticated:
gh auth login

# 1.2 Add GitHub MCP to project (creates shared .mcp.json)
cd /home/hein/Workspace/FF_Next.js
claude mcp add --transport http github https://api.githubcopilot.com/mcp/ --scope project

# 1.3 Verify it works
claude
> /mcp  # Should show github server listed
> List open PRs in this repo  # Test query
```

### Deliverable

`.mcp.json` in repo root:
```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```

### What This Enables

```
> Analyze @github:issue://42 and implement a fix
> Review @github:pr://123 for security issues
> What PRs are waiting for my review?
> Create a PR linking to issue #42
```

---

## Phase 2: Shared Claude Configuration

**Effort**: 15 minutes | **Impact**: High | **Priority**: Do first

### Steps

```bash
# 2.1 Create directory structure
mkdir -p .claude/{commands,rules,skills}

# 2.2 Create files (see content below)

# 2.3 Commit
git add .claude/ .mcp.json
git commit -m "feat: add shared Claude and GitHub configuration"
git push
```

### File: `.claude/settings.json`

```json
{
  "permissions": {
    "allow": [
      "Bash(gh pr:*)",
      "Bash(gh issue:*)",
      "Bash(gh run:*)",
      "Bash(gh repo:*)",
      "Bash(git:*)",
      "Bash(npm run:*)",
      "Bash(npm test:*)",
      "Bash(npx:*)"
    ]
  }
}
```

### Add to: `CLAUDE.md` (GitHub section)

```markdown
## GitHub Workflow

### Branch Naming
- `feature/description` - New features
- `fix/description` - Bug fixes
- `refactor/description` - Code improvements

### PR Standards
- Title: Conventional commits (feat:, fix:, refactor:)
- Description: What, Why, How
- Always link related issues
- Request review from team member

### Slash Commands
- `/project:pr` - Create PR with standards
- `/project:review` - Review current branch
- `/project:sync` - Morning sync check

### CLI Shortcuts
- `gh-sync` - Morning status check
- `gh-pr` - Create PR
- `gh-review 123` - Quick review
- `gh-team louis` - See teammate's PRs
```

---

## Phase 3: gh CLI Workflow Scripts

**Effort**: 20 minutes | **Impact**: Medium | **Priority**: This week

### File: `scripts/gh-workflows.sh`

```bash
#!/bin/bash
# FF Project - GitHub CLI Workflows
# Source this in your .bashrc or .zshrc

# === DAILY SYNC ===
gh-sync() {
  echo "=== PRs Needing Your Review ==="
  gh pr list --search "review-requested:@me" --json number,title,author \
    --template '{{range .}}#{{.number}} {{.title}} ({{.author.login}}){{"\n"}}{{end}}'

  echo -e "\n=== Your Open PRs ==="
  gh pr list --author @me --state open --json number,title,reviewDecision \
    --template '{{range .}}#{{.number}} {{.title}} [{{.reviewDecision}}]{{"\n"}}{{end}}'

  echo -e "\n=== Failed CI Runs ==="
  gh run list --status failure --limit 3

  echo -e "\n=== Your Assigned Issues ==="
  gh issue list --assignee @me --state open --limit 5
}

# === CREATE PR ===
gh-pr() {
  local title="$1"
  if [ -z "$title" ]; then
    gh pr create --fill --web
  else
    gh pr create --title "$title" --body "$2"
  fi
}

# === QUICK REVIEW ===
gh-review() {
  local pr_num="$1"
  if [ -z "$pr_num" ]; then
    echo "Usage: gh-review <pr-number>"
    return 1
  fi
  echo "=== PR #$pr_num Details ==="
  gh pr view "$pr_num"
  echo -e "\n=== Changes (first 100 lines) ==="
  gh pr diff "$pr_num" --color always | head -100
  echo -e "\n[Run 'gh pr diff $pr_num' for full diff]"
}

# === WATCH CI ===
gh-watch() {
  local run_id="$1"
  if [ -z "$run_id" ]; then
    gh run watch
  else
    gh run watch "$run_id"
  fi
  echo "CI Complete!"
}

# === MERGE PR ===
gh-merge() {
  local pr_num="$1"
  if [ -z "$pr_num" ]; then
    echo "Usage: gh-merge <pr-number>"
    return 1
  fi
  read -p "Approve and merge PR #$pr_num? (y/n) " confirm
  if [ "$confirm" = "y" ]; then
    gh pr review "$pr_num" --approve
    gh pr merge "$pr_num" --squash --delete-branch
  fi
}

# === CHECK TEAMMATE ===
gh-team() {
  local teammate="${1:-louis}"
  echo "=== ${teammate}'s Open PRs ==="
  gh pr list --author "$teammate" --state open
  echo -e "\n=== ${teammate}'s Recent Commits ==="
  git log --author="$teammate" --oneline -5 2>/dev/null || echo "No local commits found"
}

# === QUICK ISSUE ===
gh-issue() {
  local title="$1"
  if [ -z "$title" ]; then
    gh issue create --web
  else
    gh issue create --title "$title" --body "$2"
  fi
}

echo "FF GitHub workflows loaded: gh-sync, gh-pr, gh-review, gh-watch, gh-merge, gh-team, gh-issue"
```

### Setup

```bash
# Add to your shell config
echo "source ~/Workspace/FF_Next.js/scripts/gh-workflows.sh" >> ~/.bashrc
source ~/.bashrc

# Or for zsh
echo "source ~/Workspace/FF_Next.js/scripts/gh-workflows.sh" >> ~/.zshrc
source ~/.zshrc
```

### Usage

| Command | Description |
|---------|-------------|
| `gh-sync` | Morning status check |
| `gh-pr` | Create PR (opens web) |
| `gh-pr "feat: title"` | Create PR with title |
| `gh-review 123` | Quick review PR #123 |
| `gh-watch` | Watch current CI run |
| `gh-merge 123` | Approve and squash merge |
| `gh-team` | See Louis's open PRs |
| `gh-team kai` | See Kai's open PRs |
| `gh-issue` | Create issue (opens web) |

---

## Phase 4: Custom Slash Commands

**Effort**: 15 minutes | **Impact**: High | **Priority**: This week

### File: `.claude/commands/pr.md`

```markdown
Create a pull request for the current branch following team standards.

## Steps

1. Check current state:
   - Run `git status` to verify clean working directory
   - Run `git log main..HEAD --oneline` to see commits
   - Run `git diff main...HEAD --stat` to see changed files

2. Analyze the changes:
   - What feature/fix does this implement?
   - Are there any breaking changes?
   - What should reviewers focus on?

3. Determine PR title:
   - Use conventional commit format: `<type>: <description>`
   - Types: feat, fix, refactor, docs, test, chore

4. Create the PR using gh CLI:
   ```bash
   gh pr create \
     --title "<type>: <description>" \
     --body "## Summary
   <1-3 bullet points explaining the change>

   ## Changes
   - <list key files/components changed>

   ## Testing
   - [ ] Unit tests pass (`npm test`)
   - [ ] Type check passes (`npm run type-check`)
   - [ ] Manual testing completed

   ## Related
   Closes #<issue-number> (if applicable)

   ---
   Generated with Claude Code"
   ```

5. Output the PR URL when complete
```

### File: `.claude/commands/review.md`

```markdown
Review a pull request thoroughly.

## Input
- PR number (ask if not provided)

## Steps

1. Get PR metadata:
   ```bash
   gh pr view <number> --json title,body,author,files,additions,deletions,reviewDecision
   ```

2. Get the full diff:
   ```bash
   gh pr diff <number>
   ```

3. Analyze for:
   - [ ] Code quality and readability
   - [ ] Security concerns (SQL injection, XSS, auth issues)
   - [ ] Error handling completeness
   - [ ] TypeScript types (no `any`, proper interfaces)
   - [ ] Test coverage for new code
   - [ ] Breaking changes to existing functionality
   - [ ] Performance implications

4. Provide structured feedback:
   ```
   ## Review Summary

   **Overall**: [APPROVE / REQUEST CHANGES / COMMENT]

   ### Strengths
   - ...

   ### Issues Found
   - [file:line] Description of issue

   ### Suggestions
   - ...
   ```

5. If approved, offer to run:
   ```bash
   gh pr review <number> --approve --body "LGTM! <summary>"
   ```
```

### File: `.claude/commands/sync.md`

```markdown
Morning sync - check GitHub status and plan the day.

## Steps

1. Check PRs needing your review:
   ```bash
   gh pr list --search "review-requested:@me" --json number,title,author,updatedAt
   ```

2. Check your open PRs:
   ```bash
   gh pr list --author @me --state open --json number,title,reviewDecision,statusCheckRollup
   ```

3. Check failed CI runs:
   ```bash
   gh run list --status failure --limit 5
   ```

4. Check assigned issues:
   ```bash
   gh issue list --assignee @me --state open --json number,title,labels
   ```

5. Summarize in this format:
   ```
   ## Morning Sync

   ### PRs to Review
   - #123 Title (author) - [link]

   ### Your PRs Status
   - #456 Title - Approved, CI passing -> Ready to merge
   - #789 Title - Changes requested -> Needs attention

   ### CI Failures
   - Run #xxx on branch-name - [needs fix]

   ### Today's Issues
   - #111 High priority issue
   - #222 Bug to investigate

   ### Suggested Priority
   1. First thing to tackle
   2. Second priority
   ```
```

### Commit Commands

```bash
git add .claude/commands/
git commit -m "feat: add GitHub slash commands (pr, review, sync)"
git push
```

---

## Phase 5: GitHub Actions Integration (Optional)

> **Status (Feb 2026):** GitHub Actions billing exhausted. All CI workflows disabled
> (renamed to `.yml.disabled`). Only `claude-pr-assistant.yml` remains active
> (triggers on @claude mention only). To re-enable: rename `.yml.disabled` → `.yml`.

**Effort**: 20 minutes | **Impact**: Medium | **Priority**: When billing restored

### File: `.github/workflows/claude-review.yml`

```yaml
name: Claude PR Assistant

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]

jobs:
  claude-response:
    # Only run when @claude is mentioned
    if: contains(github.event.comment.body, '@claude')
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Run Claude
        uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          max_turns: 5
          timeout_minutes: 10
```

### Setup

```bash
# Add your Anthropic API key to repo secrets
gh secret set ANTHROPIC_API_KEY
# Paste your key when prompted

# Commit the workflow
mkdir -p .github/workflows
git add .github/workflows/claude-review.yml
git commit -m "feat: add Claude PR assistant GitHub Action"
git push
```

### Usage in PRs

Comment on any PR or issue:
```
@claude review this PR for security issues
@claude suggest improvements to the error handling here
@claude are there any edge cases I'm missing?
@claude write a test for this function
```

---

## Phase 6: Team Onboarding

**Effort**: 10 minutes | **Impact**: High | **Priority**: After phases 1-4

### Louis Setup (One-time)

```bash
# Pull latest with all configs
cd ~/path/to/FF_Next.js
git pull

# Source the CLI helpers
echo "source ~/path/to/FF_Next.js/scripts/gh-workflows.sh" >> ~/.bashrc
source ~/.bashrc

# Start Claude - MCP loads automatically from .mcp.json
claude

# Verify MCP is connected
> /mcp
# Should show "github" server
```

### Daily Workflow

```bash
# Morning
gh-sync                    # or in Claude: /project:sync

# Working on feature
git checkout -b feature/my-feature
# ... make changes ...
git add . && git commit -m "feat: description"

# Create PR
/project:pr                # or: gh-pr

# Review teammate's PR
/project:review 123        # or: gh-review 123

# After approval
gh-merge 123
```

### Quick Reference Card

| Task | Claude Command | CLI Command |
|------|----------------|-------------|
| Morning check | `/project:sync` | `gh-sync` |
| Create PR | `/project:pr` | `gh-pr` |
| Review PR | `/project:review 123` | `gh-review 123` |
| See teammate | - | `gh-team louis` |
| Watch CI | - | `gh-watch` |
| Merge PR | - | `gh-merge 123` |

---

## Implementation Checklist

### Today (25 min)
- [ ] Phase 1: Add GitHub MCP server
- [ ] Phase 2: Create `.claude/settings.json`
- [ ] Phase 2: Update `CLAUDE.md` with GitHub section
- [ ] Commit and push
- [ ] Notify Louis to pull

### This Week (35 min)
- [ ] Phase 3: Create `scripts/gh-workflows.sh`
- [ ] Phase 3: Both devs source the script
- [ ] Phase 4: Create slash commands
- [ ] Phase 6: Document in CLAUDE.md
- [ ] Test workflow together

### Optional
- [ ] Phase 5: GitHub Actions (when you want async Claude in PRs)

---

## Verification

After setup, both developers should be able to:

```bash
# Same MCP context
claude
> /mcp
# Shows: github server

# Same slash commands
> /project:sync
# Shows GitHub status

# Same CLI tools
gh-sync
# Shows PRs, issues, CI status
```

If both see the same output, you're synchronized!

---

## Troubleshooting

### MCP not loading
```bash
# Check .mcp.json exists and is valid JSON
cat .mcp.json | jq .

# Re-add if needed
claude mcp add --transport http github https://api.githubcopilot.com/mcp/ --scope project
```

### gh CLI not authenticated
```bash
gh auth status
gh auth login  # Re-authenticate if needed
```

### Slash commands not found
```bash
# Verify files exist
ls -la .claude/commands/

# Check they're committed
git status
```

### Shell functions not available
```bash
# Re-source
source ~/Workspace/FF_Next.js/scripts/gh-workflows.sh

# Or restart terminal
```
