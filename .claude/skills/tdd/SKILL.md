---
name: tdd
description: Test-Driven Development workflow for FibreFlow. Enforces spec, test, then code order. USE WHEN user says '/tdd', 'implement', 'add feature', 'create new', or references a PRD/spec/issue for implementation.
disable-model-invocation: true
---


# TDD - Test-Driven Development Skill

## USE WHEN

- User wants to add a new feature
- User mentions "implement", "add feature", "create new"
- User references a PRD, spec, or GitHub issue for implementation
- Before ANY feature code is written
- `/tdd` command is invoked

## WORKFLOW

### Command: `/tdd spec <feature-name>`

Creates a test specification from a PRD or requirements.

**Steps:**
1. Locate the source document:
   - `docs/specs/{feature}.md`
   - GitHub issue (fetch with `gh issue view`)
   - User-provided requirements

2. Extract testable requirements:
   - Identify acceptance criteria
   - List edge cases
   - Define error scenarios

3. Generate test specification:
   ```markdown
   # Test Specification: {Feature}

   ## Source
   - Document: {source}
   - Date: {date}

   ## Unit Tests
   | ID | Description | Input | Expected |
   |----|-------------|-------|----------|
   | UT-001 | ... | ... | ... |

   ## Integration Tests
   | ID | Description | Components | Expected |
   |----|-------------|------------|----------|
   | IT-001 | ... | ... | ... |

   ## E2E Tests
   | ID | Flow | Steps | Expected |
   |----|------|-------|----------|
   | E2E-001 | ... | ... | ... |
   ```

4. Save to `tests/specs/{feature}.spec.md`

### Command: `/tdd generate <spec-file>`

Generates test file skeletons from a specification.

**Steps:**
1. Read the spec file
2. Generate test files:
   - `tests/unit/modules/{module}/{feature}.test.ts`
   - `tests/integration/api/{feature}.test.ts` (if API involved)

3. Create failing tests (Red phase):
   ```typescript
   import { describe, it, expect } from 'vitest';

   describe('{Feature}', () => {
     // UT-001: {Description}
     it('should {expected behavior}', () => {
       // Arrange
       // Act
       // Assert
       expect.fail('Test not implemented - write feature code');
     });
   });
   ```

### Command: `/tdd validate`

Validates TDD compliance before PR.

**Checks:**
1. New src/ files have corresponding test files
2. Test coverage meets threshold (80%+)
3. No trivial tests (DGTS compliance)
4. Spec exists for new features

**Output:**
```
TDD Validation Report
=====================
Feature files: 5
Test files: 4
Coverage: 82%

[PASS] All new code has tests
[PASS] Coverage above threshold
[WARN] Missing spec for: ticketing/newService.ts

Ready for PR: YES (with warnings)
```

### Command: `/tdd implement <spec-file>`

Full TDD implementation workflow.

**Phases:**

1. **RED** - Create failing tests
   ```bash
   # Generate tests from spec
   /tdd generate tests/specs/feature.spec.md

   # Run tests (should fail)
   npm test -- --grep "Feature"
   ```

2. **GREEN** - Implement minimum code
   ```
   Now implement the feature code to make tests pass.
   - Focus on passing tests, not perfect code
   - One test at a time
   - Minimal implementation
   ```

3. **REFACTOR** - Improve code quality
   ```
   All tests pass. Now refactor:
   - Extract common patterns
   - Improve naming
   - Add documentation
   - Ensure Zero Tolerance compliance
   ```

## INTEGRATION

### With GitHub Workflow

```bash
# Before creating PR
/tdd validate

# In PR template, link to spec
gh pr create --body "## Spec\nSee: tests/specs/feature.spec.md"
```

### With Auto Skill

The `/auto` skill uses TDD internally:
```
PRD → /tdd spec → /tdd generate → /tdd implement → PR
```

### With Local CI Pipeline

TDD validation is enforced locally via the CI pipeline before PRs and deploys:

```bash
npm run ci            # Full CI: lint gates + tests + build
npm run ci:quick      # Lint gates only (fast, before PRs)
```

Tests run as part of `npm run ci` (Gate 5). The `/pr` command runs `ci:quick` automatically before creating a PR.

## ENFORCEMENT LEVELS

### Level 1: Reminder (Current)
- Hook shows TDD reminder when editing src/ files
- No blocking, just awareness

### Level 2: PR Validation
- CI checks for test coverage
- PR template requires spec link
- Reviewer checklist includes TDD compliance

### Level 3: Hard Block (Future)
- Pre-commit hook blocks commits without tests
- PR cannot merge without passing TDD check

## EXAMPLES

### Example 1: New API Endpoint

```bash
# 1. User has PRD for new endpoint
> /tdd spec "contractor-notifications"

# Output: Created tests/specs/contractor-notifications.spec.md

# 2. Generate test skeletons
> /tdd generate tests/specs/contractor-notifications.spec.md

# Output:
# Created: tests/unit/modules/contractors/notifications.test.ts
# Created: tests/integration/api/contractor-notifications.test.ts

# 3. Run tests (RED)
> npm test

# All tests fail as expected

# 4. Implement feature
> /tdd implement tests/specs/contractor-notifications.spec.md

# Claude implements, tests pass

# 5. Validate before PR
> /tdd validate

# TDD Validation: PASS
```

### Example 2: Bug Fix with Test

```bash
# 1. Write test that reproduces bug
> Create a test that fails due to bug #123

# 2. Run test (confirms bug)
> npm test -- --grep "bug 123"

# FAIL: Expected behavior not met

# 3. Fix the bug
> Fix the code to make the test pass

# 4. Run test (confirms fix)
> npm test -- --grep "bug 123"

# PASS: Bug fixed and regression prevented
```

## FILE STRUCTURE

```
tests/
├── specs/              # Test specifications (before code)
│   ├── feature-a.spec.md
│   └── feature-b.spec.md
├── unit/               # Unit tests
│   └── modules/
│       └── {module}/
│           └── {feature}.test.ts
├── integration/        # Integration tests
│   └── api/
│       └── {endpoint}.test.ts
└── e2e/                # End-to-end tests
    └── flows/
        └── {flow}.spec.ts
```

## CONFIGURATION

In `vitest.config.ts`:
```typescript
export default defineConfig({
  test: {
    coverage: {
      threshold: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    }
  }
});
```

## ANTI-PATTERNS (DGTS Violations)

```typescript
// BAD: Trivial test
it('should exist', () => {
  expect(true).toBe(true);
});

// BAD: Testing implementation, not behavior
it('should call internal method', () => {
  expect(service._internalMethod).toHaveBeenCalled();
});

// BAD: No actual assertion
it('should work', () => {
  const result = doSomething();
  // No expect!
});

// GOOD: Tests actual behavior
it('should return sorted contractors by name', () => {
  const contractors = [{ name: 'Zulu' }, { name: 'Alpha' }];
  const result = sortContractors(contractors);
  expect(result[0].name).toBe('Alpha');
  expect(result[1].name).toBe('Zulu');
});
```
