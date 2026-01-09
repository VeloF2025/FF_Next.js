# Test Specification: [Feature Name]

> Copy this template to create a new test specification.
> Name: `tests/specs/<feature-name>.spec.md`

## Source

- **PRD/Spec**: `docs/specs/<feature>.md` or GitHub Issue #XX
- **Date Created**: YYYY-MM-DD
- **Author**: [Name]

---

## Overview

[Brief description of the feature being tested]

---

## Unit Tests

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| UT-001 | Primary use case | Valid input | Success response | HIGH |
| UT-002 | Empty input handling | `null`/`undefined` | Graceful error | HIGH |
| UT-003 | Invalid input type | Wrong type | Type error | MEDIUM |
| UT-004 | Boundary conditions | Edge values | Correct handling | MEDIUM |
| UT-005 | Error propagation | Failing dependency | Proper error | HIGH |

### Test File Location
`tests/unit/modules/<module>/<feature>.test.ts`

---

## Integration Tests

| ID | Description | Components Involved | Expected Behavior | Priority |
|----|-------------|---------------------|-------------------|----------|
| IT-001 | API endpoint responds | Router, Service, DB | 200 with data | HIGH |
| IT-002 | Auth required | Router, Auth middleware | 401 without token | HIGH |
| IT-003 | Database persistence | Service, DB | Data saved correctly | HIGH |

### Test File Location
`tests/integration/api/<feature>.test.ts`

---

## E2E Tests (if applicable)

| ID | User Flow | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| E2E-001 | User completes action | 1. Navigate to page<br>2. Fill form<br>3. Submit | Success message shown | HIGH |

### Test File Location
`tests/e2e/flows/<feature>.spec.ts`

---

## Acceptance Criteria Mapping

Map each acceptance criterion to its test(s):

- [ ] **AC1**: [Criterion from spec] → `UT-001`, `IT-001`
- [ ] **AC2**: [Criterion from spec] → `UT-002`, `E2E-001`
- [ ] **AC3**: [Criterion from spec] → `IT-002`

---

## Edge Cases

| Scenario | Expected Behavior | Test ID |
|----------|-------------------|---------|
| Network failure | Retry with backoff | UT-005 |
| Concurrent requests | No race conditions | IT-003 |
| Large data set | Performance acceptable | - |

---

## Notes

- [Any special considerations]
- [Dependencies that need mocking]
- [Setup/teardown requirements]

---

## Checklist

Before implementation:
- [ ] All acceptance criteria have mapped tests
- [ ] Edge cases identified
- [ ] Test file locations decided
- [ ] Priority assigned to each test

After test creation:
- [ ] Tests are failing (RED phase)
- [ ] Test descriptions match behavior
- [ ] No trivial tests (DGTS compliant)
