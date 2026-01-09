# TDD - Test-Driven Development

Enforce test-first development workflow.

## Usage

- `/tdd spec <feature-name>` - Create test specification from requirements
- `/tdd generate <spec-file>` - Generate test skeletons from spec
- `/tdd validate` - Check TDD compliance before PR
- `/tdd implement <spec-file>` - Full RED-GREEN-REFACTOR workflow

## Arguments

$ARGUMENTS

## Commands

### `/tdd spec <feature-name>`

1. Find requirements:
   - Check `docs/specs/<feature>.md`
   - Check GitHub issues
   - Ask user if not found

2. Extract testable requirements:
   - Acceptance criteria
   - Edge cases
   - Error scenarios

3. Create `tests/specs/<feature>.spec.md`:
   ```markdown
   # Test Specification: <Feature>

   ## Source
   - Document: <source>
   - Date: <date>

   ## Unit Tests
   | ID | Description | Input | Expected |
   |----|-------------|-------|----------|
   | UT-001 | ... | ... | ... |

   ## Integration Tests
   | ID | Description | Components | Expected |
   |----|-------------|------------|----------|
   | IT-001 | ... | ... | ... |
   ```

### `/tdd generate <spec-file>`

1. Read spec file
2. Create test directory structure:
   ```
   tests/unit/modules/<module>/
   tests/integration/api/
   ```

3. Generate failing tests:
   ```typescript
   import { describe, it, expect } from 'vitest';

   describe('<Feature>', () => {
     // UT-001: <Description>
     it('should <expected behavior>', () => {
       expect.fail('Implement feature to pass this test');
     });
   });
   ```

### `/tdd validate`

Check compliance before PR:

1. Get changed files:
   ```bash
   git diff main...HEAD --name-only | grep "^src/"
   ```

2. For each changed source file:
   - Check if test file exists
   - Check if spec exists

3. Run tests and coverage:
   ```bash
   npm run test:coverage
   ```

4. Output report:
   ```
   TDD Validation
   ==============
   Source files changed: 5
   Test files exist: 4/5
   Spec files exist: 3/5
   Coverage: 82%

   [PASS] Coverage above 80%
   [WARN] Missing test for: src/modules/x/service.ts
   [WARN] Missing spec for: feature-y

   Status: READY with warnings
   ```

### `/tdd implement <spec-file>`

Full TDD cycle:

1. **RED Phase**
   - Generate tests from spec
   - Run tests (verify they fail)
   - Output: "Tests failing as expected"

2. **GREEN Phase**
   - Implement minimum code to pass
   - Run tests after each change
   - Output: "All tests passing"

3. **REFACTOR Phase**
   - Improve code quality
   - Ensure tests still pass
   - Apply Zero Tolerance standards
   - Output: "Refactoring complete"

## Integration

Works with:
- `/pr` - Includes TDD compliance check
- `/review` - Checks for test coverage
- Pre-commit hook - Validates tests exist
