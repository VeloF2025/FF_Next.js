# FibreFlow Development Workflow Guide

A comprehensive end-to-end guide for developing features, enhancing existing functionality, and debugging in the FibreFlow codebase.

---

## Table of Contents

1. [Overview](#overview)
2. [Phase 1: Requirements & Planning](#phase-1-requirements--planning)
3. [Phase 2: Module Context](#phase-2-module-context)
4. [Phase 3: Test-Driven Development](#phase-3-test-driven-development)
5. [Phase 4: Implementation](#phase-4-implementation)
6. [Phase 5: Validation & Quality](#phase-5-validation--quality)
7. [Phase 6: Pull Request](#phase-6-pull-request)
8. [Phase 7: Review & Merge](#phase-7-review--merge)
9. [Debugging Workflow](#debugging-workflow)
10. [Quick Reference](#quick-reference)

---

## Overview

### Development Principles

| Principle | Description |
|-----------|-------------|
| **Spec First** | Always start with clear requirements |
| **Test First** | Write tests before implementation (TDD) |
| **Module Aware** | Load context for the module you're working on |
| **Quality Gates** | Validate before committing |
| **Documentation** | Update relevant docs as you go |

### Branch Strategy

```
master (production — all environments)
  └── feature/your-feature (work branch)
  └── fix/your-fix (bug fix branch)
```

> **Note:** We work directly off `master` — there is no `develop` branch.

---

## Phase 1: Requirements & Planning

### 1.1 Define the Requirement

Before writing any code, ensure you have a clear specification:

**For New Features:**
- User story or feature request
- Acceptance criteria
- UI/UX mockups (if applicable)
- API contract (if applicable)

**For Enhancements:**
- Current behavior description
- Desired behavior changes
- Impact assessment on existing functionality

**For Bug Fixes:**
- Steps to reproduce
- Expected vs actual behavior
- Error logs or screenshots

### 1.2 Create a Branch

```bash
# Ensure you're on latest master
git checkout master
git pull origin master

# Create feature branch
git checkout -b feature/descriptive-name

# Or for bugs
git checkout -b fix/issue-description
```

### 1.3 Plan the Implementation

For non-trivial tasks, use Claude's plan mode:

```
"Plan the implementation for [feature description]"
```

Claude will:
1. Explore the codebase to understand existing patterns
2. Identify affected files and modules
3. Design an implementation approach
4. Present the plan for your approval

---

## Phase 2: Module Context

### 2.1 Load Module Context

Before modifying any module, load its context to understand:
- Dependencies (internal and external)
- Database tables and queries
- API endpoints
- Services and methods
- Existing patterns and gotchas

**Module profiles are located at:** `.claude/modules/{module-name}.md`

```
"Load context for the ticketing module"
```

Or read directly:
```bash
cat .claude/modules/ticketing.md
```

### 2.2 Check Module Index

For a quick overview of all modules:

```bash
cat .claude/modules/_index.yaml
```

Key information available:
- Module categories (core, procurement, monitoring, etc.)
- Database table mapping
- Isolation status (which modules can be safely modified)

### 2.3 Understand Dependencies

Before making changes, know what depends on your module:

**Fully Isolated (safe to modify):**
- wa-monitor

**Mostly Isolated:**
- foto-review
- ticketing

**Tightly Coupled (modify with care):**
- workflow
- installations
- projects

---

## Phase 3: Test-Driven Development

### 3.1 Create Test Specification

Before writing code, create a test spec:

```bash
# Use the TDD command
/tdd spec "feature-name"
```

Or create manually using the template:

```bash
cp tests/specs/_TEMPLATE.spec.md tests/specs/your-feature.spec.md
```

### 3.2 Test Spec Structure

```markdown
# Feature: [Name]

## Requirements
- [ ] Requirement 1
- [ ] Requirement 2

## Test Cases

### Unit Tests
| ID | Description | Input | Expected Output |
|----|-------------|-------|-----------------|
| U1 | Test case 1 | {...} | {...} |

### Integration Tests
| ID | Description | Setup | Steps | Expected |
|----|-------------|-------|-------|----------|
| I1 | Test case 1 | ... | ... | ... |

### Edge Cases
- Edge case 1
- Edge case 2

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
```

### 3.3 Generate Tests from Spec

```bash
/tdd generate tests/specs/your-feature.spec.md
```

This creates:
- Unit tests in `tests/unit/`
- Integration tests in `tests/integration/`
- E2E tests in `tests/e2e/` (if applicable)

### 3.4 Run Tests (They Should Fail)

```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/unit/your-feature.test.ts

# Run with coverage
npm test -- --coverage
```

**Expected:** Tests fail because implementation doesn't exist yet.

---

## Phase 4: Implementation

### 4.1 Follow Module Patterns

Each module has established patterns. Follow them:

```
src/modules/{module-name}/
├── types/          # TypeScript interfaces
├── services/       # Business logic
├── components/     # UI components
├── hooks/          # React hooks
└── utils/          # Helper functions
```

### 4.2 Implementation Guidelines

**Code Quality Standards:**
- Files < 300 lines
- Components < 200 lines
- 100% TypeScript coverage
- No `console.log` - use proper logger
- No empty catch blocks
- Proper error handling

**Database Operations:**
- Use parameterized queries (prevent SQL injection)
- Use Neon serverless client
- Follow existing query patterns in the module

**API Endpoints:**
- Use `apiResponse` helper from `@/lib/apiResponse`
- Follow REST conventions
- Validate input with Zod

### 4.3 Hooks That Run During Development

**Pre-commit Validation** (`.claude/hooks/pre-commit.ts`):
- Checks for `console.log` statements
- Validates TypeScript types
- Ensures test coverage

**TDD Reminder** (`.claude/hooks/tdd-reminder.ts`):
- Reminds to write tests when editing `src/` files
- Warns if no corresponding test file exists

### 4.4 Run Tests Incrementally

As you implement, run tests frequently:

```bash
# Watch mode - reruns on file changes
npm test -- --watch

# Run specific test
npm test -- -t "should create ticket"
```

**Goal:** Make tests pass one by one.

---

## Phase 5: Validation & Quality

### 5.1 Run Full Test Suite

```bash
npm test
```

All tests must pass.

### 5.2 Type Check

```bash
npm run type-check
```

No TypeScript errors allowed.

### 5.3 Lint Check

```bash
npm run lint
```

Fix any linting errors.

### 5.4 Build Verification

```bash
npm run build
```

Ensure the project builds without errors.

### 5.5 TDD Compliance Check

```bash
/tdd validate
```

Verifies:
- Test spec exists
- Tests were written before implementation
- All acceptance criteria have tests
- Coverage meets threshold

### 5.6 Manual Testing

```bash
# Start local server
npm run build && PORT=3005 npm start

# Access at http://localhost:3005
```

Test the feature manually in the browser.

---

## Phase 6: Pull Request

### 6.1 Commit Changes

```bash
# Stage changes
git add .

# Commit with descriptive message
git commit -m "feat: add ticket verification workflow

- Add 12-step verification checklist
- Implement QA readiness service
- Add verification UI components
- Include unit and integration tests

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

**Commit Message Format:**
- `feat:` - New feature
- `fix:` - Bug fix
- `refactor:` - Code refactoring
- `docs:` - Documentation
- `test:` - Tests
- `chore:` - Maintenance

### 6.2 Push Branch

```bash
git push origin feature/your-feature
```

### 6.3 Create Pull Request

**Option A: Using CLI helper**
```bash
source scripts/gh-workflows.sh
ff-pr "Add ticket verification workflow"
```

**Option B: Using slash command**
```
/pr
```

**Option C: Using gh directly**
```bash
gh pr create --fill
```

### 6.4 PR Description Template

```markdown
## Summary
Brief description of what this PR does.

## Changes
- Change 1
- Change 2
- Change 3

## Test Plan
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed
- [ ] Type check passes
- [ ] Lint passes

## Screenshots (if UI changes)
[Add screenshots]

## Related Issues
Closes #123
```

---

## Phase 7: Review & Merge

### 7.1 Request Review

```bash
# Request specific reviewer
gh pr edit --add-reviewer username

# Or use CLI helper
ff-review 30  # PR number
```

### 7.2 Address Review Comments

If changes are requested:

```bash
# Make changes
git add .
git commit -m "fix: address review comments"
git push
```

### 7.3 CI Checks

CI runs locally via `scripts/ci-local.sh` (GitHub Actions disabled Apr 2026):

```bash
npm run ci:quick      # Lint gates only (mandatory before PR)
npm run ci            # Full: lint + tests + build
```

Lint ratchet baselines block any regression: 77 errors, 3765 warnings, 88 silent catches.
The `/pr` command and `deploy-local.sh` both enforce these gates automatically.

### 7.4 Merge to Master

Once approved:

```bash
# Merge via CLI
gh pr merge --merge

# Or use helper
ff-merge 30
```

### 7.5 Deploy to Dev Environment

After merging to master:

```bash
# Local on Velocity (no SSH needed)
sudo -u velo bash -c 'cd /home/velo/fibreflow-dev && git pull origin master && npm run build'
sudo systemctl restart fibreflow-dev.service
```

Or use the deploy script:
```bash
bash scripts/deploy-gate.sh dev
```

### 7.6 Verify on Dev

Test the feature on https://dev.fibreflow.app

### 7.7 Promote to Staging & Production (After Hours Only)

```bash
# Promote dev → staging (requires Hein's approval)
bash scripts/promote.sh dev staging

# Promote staging → production (requires Hein's approval)
bash scripts/promote.sh staging production
```

---

## Debugging Workflow

### 1. Reproduce the Issue

```bash
# Check logs (local on Velocity)
journalctl -u fibreflow-production -n 100 --no-pager
```

### 2. Load Module Context

```
"Load context for the [affected module] module"
```

### 3. Identify Root Cause

Use the module profile to understand:
- What services are involved
- What database tables are affected
- What API endpoints are called
- Known gotchas

### 4. Write a Failing Test

```bash
# Create test that reproduces the bug
npm test -- -t "should not crash when..."
```

### 5. Fix and Verify

```bash
# Make the fix
# Run the test
npm test -- -t "should not crash when..."

# Run full suite
npm test
```

### 6. Create Fix PR

Follow the standard PR workflow with:
- `fix:` commit prefix
- Reference to issue number
- Test that proves the fix

---

## Quick Reference

### Daily Workflow Commands

```bash
# Morning sync - see PRs and issues
source scripts/gh-workflows.sh
ff-sync

# Or use slash command
/sync
```

### Common Slash Commands

| Command | Description |
|---------|-------------|
| `/pr` | Create a pull request |
| `/review 123` | Review PR #123 |
| `/sync` | Morning sync status |
| `/tdd spec X` | Create test spec for feature X |
| `/tdd validate` | Validate TDD compliance |

### CLI Helpers (after sourcing gh-workflows.sh)

| Command | Description |
|---------|-------------|
| `ff-sync` | Daily status sync |
| `ff-pr "title"` | Create PR with title |
| `ff-review 123` | Review PR |
| `ff-merge 123` | Merge PR |
| `ff-help` | Show all commands |

### Quality Commands

```bash
npm test              # Run tests
npm run type-check    # TypeScript check
npm run lint          # Linting
npm run build         # Build verification
```

### Module Locations

```
.claude/modules/_index.yaml     # Module index
.claude/modules/{name}.md       # Individual profiles
src/modules/{name}/             # Module source code
tests/specs/{name}.spec.md      # Test specifications
```

### Key Files

| File | Purpose |
|------|---------|
| `CLAUDE.md` | AI assistant context |
| `.claude/expertise.yaml` | FF patterns and anti-patterns |
| `.claude/protocols/*.md` | Quality protocols |
| `docs/DATABASE_TABLES.md` | Database schema |

---

## Checklist: New Feature

- [ ] Requirement defined
- [ ] Branch created from develop
- [ ] Module context loaded
- [ ] Test spec created
- [ ] Tests generated (failing)
- [ ] Implementation complete
- [ ] Tests passing
- [ ] Type check passing
- [ ] Lint passing
- [ ] Build passing
- [ ] Manual testing done
- [ ] PR created
- [ ] Code review passed
- [ ] Merged to master
- [ ] Deployed to dev (verified)
- [ ] Promoted to staging (after hours, with approval)
- [ ] Promoted to production (after hours, with approval)

---

## Checklist: Bug Fix

- [ ] Issue reproduced
- [ ] Module context loaded
- [ ] Failing test written
- [ ] Fix implemented
- [ ] Test passing
- [ ] No regression (full test suite)
- [ ] PR created with issue reference
- [ ] Code review passed
- [ ] Merged and deployed

---

*Last updated: 2026-02-28*
