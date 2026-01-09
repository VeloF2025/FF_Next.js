# TDD Enforcement Protocol

**Version:** 1.0
**Updated:** 2026-01-09
**Scope:** All feature development in FibreFlow

---

## Core Principle

> "No feature code without test specification first"

Features cannot be implemented until:
1. A specification (PRD, story, or issue) exists
2. Test cases are defined from that specification
3. Test files are created (can be skeleton/failing)

---

## Workflow: Spec → Test → Code

### Phase 1: Specification
Before ANY coding begins, ensure:
- [ ] Clear requirements document exists (PRD, GitHub issue, or story)
- [ ] Acceptance criteria are defined
- [ ] Edge cases are identified

**Locations for specs:**
```
docs/specs/{feature-name}.md       # PRDs and detailed specs
.github/ISSUE_TEMPLATE/            # GitHub issue templates
stories/{epic}/{story-name}.md     # User stories (if using BMad)
```

### Phase 2: Test Definition
From the spec, create test cases BEFORE implementation:

```typescript
// tests/unit/{module}/{feature}.test.ts
describe('Feature: {feature-name}', () => {
  // From spec: "User should be able to..."
  it('should handle primary use case', () => {
    // TODO: Implement after test is defined
    expect(true).toBe(false); // Failing test
  });

  // From spec: "When X happens, Y should..."
  it('should handle edge case X', () => {
    expect(true).toBe(false); // Failing test
  });
});
```

### Phase 3: Implementation
Only after tests exist:
1. Run tests (they should fail)
2. Implement feature code
3. Run tests (they should pass)
4. Refactor if needed

---

## Directory Structure

```
tests/
├── unit/               # Unit tests (fast, isolated)
│   ├── modules/        # Module-specific tests
│   │   ├── ticketing/
│   │   ├── wa-monitor/
│   │   └── ...
│   └── lib/            # Library function tests
├── integration/        # Integration tests
│   └── api/            # API endpoint tests
├── e2e/                # End-to-end tests (Playwright)
│   └── flows/          # User flow tests
└── specs/              # Test specifications (before code)
    └── {feature}.spec.md
```

---

## Test Specification Template

Create at `tests/specs/{feature}.spec.md`:

```markdown
# Test Specification: {Feature Name}

## Source
- PRD: docs/specs/{feature}.md
- Issue: #{issue-number}
- Story: {story-id}

## Test Cases

### Unit Tests
| ID | Description | Input | Expected Output |
|----|-------------|-------|-----------------|
| UT-001 | Primary use case | ... | ... |
| UT-002 | Edge case: empty input | ... | ... |
| UT-003 | Error handling | ... | ... |

### Integration Tests
| ID | Description | Components | Expected Behavior |
|----|-------------|------------|-------------------|
| IT-001 | API endpoint | Router, Service, DB | ... |

### E2E Tests
| ID | User Flow | Steps | Expected Result |
|----|-----------|-------|-----------------|
| E2E-001 | User completes action | 1. Navigate... 2. Click... | Success message |

## Acceptance Criteria Mapping
- [ ] AC1 → UT-001, IT-001
- [ ] AC2 → UT-002, E2E-001
```

---

## Enforcement Mechanisms

### 1. Pre-Implementation Check (Hook)
Before creating feature files, the system checks:
- Spec file exists in `docs/specs/` or GitHub issue
- Test spec exists in `tests/specs/`
- At least one test file exists

### 2. PR Validation
PRs with new features must include:
- Link to spec/issue
- New or modified test files
- Test coverage for new code

### 3. CI Pipeline
```yaml
# .github/workflows/tdd-check.yml
- name: TDD Validation
  run: |
    # Check that new src/ files have corresponding test files
    npm run test:coverage
    # Fail if coverage drops below threshold
```

---

## Quick Commands

```bash
# Create test spec from PRD
/tdd spec "Feature Name" --from docs/specs/feature.md

# Generate test skeleton from spec
/tdd generate tests/specs/feature.spec.md

# Validate TDD compliance before PR
/tdd validate

# Check test coverage
npm run test:coverage
```

---

## Exceptions

TDD is NOT required for:
- Documentation changes (*.md files)
- Configuration changes (.env, config files)
- Pure refactoring (no behavior change)
- Hotfixes (but tests must follow within 24h)

Mark exceptions in commit message:
```
fix: critical hotfix for production issue

[TDD-EXEMPT: Hotfix - tests to follow in #123]
```

---

## Integration with Other Protocols

### DGTS (Don't Game The System)
- Tests must actually test behavior, not pass trivially
- No `expect(true).toBe(true)`
- No mocking the entire system under test

### Zero Tolerance
- Test files follow same quality standards
- Proper error assertions
- No console.log in tests

### NLNH (No Lies, No Hallucinations)
- Test descriptions match actual behavior
- Don't claim coverage you don't have

---

## Metrics

Track TDD compliance:
```
.claude/metrics/tdd-compliance.json
{
  "features_with_tests_first": 45,
  "features_without_tests": 3,
  "compliance_rate": 0.94,
  "last_updated": "2026-01-09"
}
```
