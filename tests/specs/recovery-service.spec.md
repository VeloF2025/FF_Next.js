# Test Specification: Recovery Service

## Source

- **PRD/Spec**: `.claude/plans/sequential-growing-brook.md`
- **Date Created**: 2026-01-24
- **Author**: Claude (TDD Implementation)

---

## Overview

The Recovery Service executes recovery actions for failing services. It handles safe auto-recovery, queues actions requiring human approval, executes shell commands securely, verifies action success, and logs all attempts.

---

## Feature Requirements

### FR-1: Action Execution
- Execute shell commands via secure subprocess
- Support SSH commands for remote servers (VPS, Velocity)
- Capture stdout/stderr for logging
- Enforce timeout (default 60s per action)

### FR-2: Risk Level Handling
- **Safe**: Execute immediately, no approval needed
- **Moderate**: Send notification, execute if approved or auto-approve after 10 min
- **Dangerous**: Require explicit human approval, never auto-approve

### FR-3: Success Verification
- Check success indicator after action (e.g., health endpoint returns 200)
- Retry health check 3 times with 5s delay
- Mark as success only if indicator passes
- Mark as failure if indicator fails after retries

### FR-4: Cooldown Management
- Track last execution time per action
- Respect cooldown period (default 5 min)
- Skip action if within cooldown
- Reset cooldown on successful recovery

### FR-5: Rollback Support
- If action fails and rollback_command exists, execute rollback
- Log rollback attempt and result
- Never auto-rollback dangerous actions

### FR-6: Logging & Audit Trail
- Log all execution attempts to `infrastructure_incidents`
- Record: action, start time, end time, result, output, error
- Store in both DB and KB files for permanence

---

## Unit Tests - Action Execution

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| AE-001 | Execute simple command | `echo hello` | stdout="hello" | HIGH |
| AE-002 | Execute systemctl restart | Service name | Service restarted | HIGH |
| AE-003 | Handle command not found | Invalid command | Error captured | HIGH |
| AE-004 | Handle permission denied | No sudo | Error captured | HIGH |
| AE-005 | Timeout after 60s | Slow command | TimeoutError | HIGH |
| AE-006 | Custom timeout respected | timeout=30s | Timeout at 30s | MEDIUM |
| AE-007 | SSH to remote server | VPS command | Executes on VPS | HIGH |
| AE-008 | SSH handles connection failure | Unreachable host | Error captured | HIGH |
| AE-009 | Capture stdout | Command with output | stdout stored | HIGH |
| AE-010 | Capture stderr | Command with error | stderr stored | HIGH |
| AE-011 | Exit code captured | Non-zero exit | exitCode stored | HIGH |
| AE-012 | Environment variables set | Env required | Variables available | MEDIUM |

### Test File Location
`tests/unit/modules/system/actionExecution.test.ts`

---

## Unit Tests - Risk Level Handling

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| RL-001 | Safe action executes immediately | riskLevel=safe | Immediate execution | HIGH |
| RL-002 | Safe action no notification | riskLevel=safe | No WhatsApp sent | HIGH |
| RL-003 | Moderate sends notification | riskLevel=moderate | WhatsApp sent | HIGH |
| RL-004 | Moderate queues for approval | riskLevel=moderate | Approval queued | HIGH |
| RL-005 | Moderate auto-approves after 10m | 10m elapsed | Auto-executed | HIGH |
| RL-006 | Dangerous requires approval | riskLevel=dangerous | Approval required | HIGH |
| RL-007 | Dangerous never auto-approves | 1h elapsed | Still pending | HIGH |
| RL-008 | Rejected action logged | User rejects | Status=rejected | HIGH |
| RL-009 | Approved action executes | User approves | Action executed | HIGH |
| RL-010 | Multiple approvers respected | 2 approvers | Any can approve | MEDIUM |

### Test File Location
`tests/unit/modules/system/riskLevelHandling.test.ts`

---

## Unit Tests - Success Verification

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| SV-001 | Success on healthy endpoint | 200 response | status=success | HIGH |
| SV-002 | Failure on unhealthy endpoint | 500 response | status=failure | HIGH |
| SV-003 | Retry 3 times on failure | First 2 fail | 3 attempts made | HIGH |
| SV-004 | Success on 3rd retry | 3rd succeeds | status=success | HIGH |
| SV-005 | Failure after all retries | All fail | status=failure | HIGH |
| SV-006 | 5s delay between retries | 3 retries | 10s+ total time | MEDIUM |
| SV-007 | Custom indicator evaluated | systemctl check | Indicator used | HIGH |
| SV-008 | No indicator = assume success | No indicator | status=success | MEDIUM |

### Test File Location
`tests/unit/modules/system/successVerification.test.ts`

---

## Unit Tests - Cooldown Management

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| CD-001 | Skip action in cooldown | 2min since last | Action skipped | HIGH |
| CD-002 | Execute action after cooldown | 6min since last | Action executed | HIGH |
| CD-003 | Cooldown per-action not service | Action A in CD | Action B executes | HIGH |
| CD-004 | Default cooldown is 5 min | No config | 5 min enforced | HIGH |
| CD-005 | Custom cooldown respected | cooldown=10min | 10 min enforced | MEDIUM |
| CD-006 | Success resets cooldown | Action succeeds | New 5min window | MEDIUM |
| CD-007 | Failure doesn't reset cooldown | Action fails | Cooldown continues | MEDIUM |
| CD-008 | Force bypass cooldown | force=true | Action executes | MEDIUM |

### Test File Location
`tests/unit/modules/system/cooldownManagement.test.ts`

---

## Unit Tests - Rollback Support

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| RB-001 | Rollback on action failure | Action fails | Rollback executed | HIGH |
| RB-002 | No rollback if no command | No rollback_command | No rollback | HIGH |
| RB-003 | Rollback logged separately | Rollback runs | Separate log entry | HIGH |
| RB-004 | Rollback success logged | Rollback succeeds | status=rolled_back | HIGH |
| RB-005 | Rollback failure logged | Rollback fails | Rollback error logged | HIGH |
| RB-006 | No rollback for safe actions | safe + fails | No rollback | MEDIUM |
| RB-007 | Rollback for moderate actions | moderate + fails | Rollback if exists | HIGH |
| RB-008 | No auto-rollback dangerous | dangerous + fails | Rollback queued | HIGH |

### Test File Location
`tests/unit/modules/system/rollbackSupport.test.ts`

---

## Unit Tests - Logging

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| LG-001 | Attempt logged to DB | Action executed | DB row created | HIGH |
| LG-002 | Log includes action ID | Action executed | action_id present | HIGH |
| LG-003 | Log includes service ID | Action executed | service_id present | HIGH |
| LG-004 | Log includes timestamps | Action executed | start/end times | HIGH |
| LG-005 | Log includes result | Action executed | success/failure | HIGH |
| LG-006 | Log includes output | Action executed | stdout/stderr | HIGH |
| LG-007 | Log includes duration | Action executed | duration_seconds | HIGH |
| LG-008 | KB file created | Action executed | .md file written | MEDIUM |
| LG-009 | KB file includes context | Action executed | Full details | MEDIUM |

### Test File Location
`tests/unit/modules/system/recoveryLogging.test.ts`

---

## Integration Tests

| ID | Description | Components Involved | Expected Behavior | Priority |
|----|-------------|---------------------|-------------------|----------|
| IT-001 | Execute safe action e2e | Service, Action, Verify | Service recovered | HIGH |
| IT-002 | HITL approval flow | Action, Approval, Execute | Approved action runs | HIGH |
| IT-003 | Rejection flow | Action, Approval, Reject | Action not executed | HIGH |
| IT-004 | Cooldown prevents spam | Multiple triggers | Only 1 execution | HIGH |
| IT-005 | Rollback on failure | Action fails, Rollback | Rollback executed | HIGH |
| IT-006 | Success count incremented | Successful recovery | Count updated | MEDIUM |
| IT-007 | Failure count incremented | Failed recovery | Count updated | MEDIUM |
| IT-008 | KB file persisted | Recovery complete | File exists | MEDIUM |

### Test File Location
`tests/integration/api/system/recovery.test.ts`

---

## Acceptance Criteria Mapping

- [x] **AC1**: Execute shell commands securely → `AE-001` - `AE-012`
- [x] **AC2**: Safe actions auto-execute → `RL-001`, `RL-002`
- [x] **AC3**: Moderate actions notify + queue → `RL-003`, `RL-004`
- [x] **AC4**: Dangerous actions require approval → `RL-006`, `RL-007`
- [x] **AC5**: Verify success after action → `SV-001` - `SV-008`
- [x] **AC6**: Respect cooldown periods → `CD-001` - `CD-008`
- [x] **AC7**: Rollback on failure → `RB-001` - `RB-008`
- [x] **AC8**: Log all attempts → `LG-001` - `LG-009`
- [x] **AC9**: Track success/failure counts → `IT-006`, `IT-007`

---

## Command Examples

```typescript
// Safe action
{
  command: 'systemctl restart fibreflow.service',
  riskLevel: 'safe',
  successIndicator: 'systemctl is-active fibreflow.service',
}

// Moderate action
{
  command: 'cd /home/louis/apps/fibreflow && git reset --hard origin/master && npm install && npm run build',
  riskLevel: 'moderate',
  successIndicator: 'curl -s https://vf.fibreflow.app/api/health',
  rollbackCommand: 'git checkout HEAD~1',
}

// Dangerous action
{
  command: 'psql -c "TRUNCATE TABLE system_health_logs"',
  riskLevel: 'dangerous',
  successIndicator: null,
  requiresApproval: true,
}
```

---

## Notes

- Use `child_process.spawn` not `exec` for security
- Sanitize all command inputs to prevent injection
- SSH commands use key-based auth, no passwords in code
- Consider using a command allowlist for extra security
- Log sensitive commands with redacted credentials

---

## Checklist

Before implementation:
- [x] All acceptance criteria have mapped tests
- [x] Edge cases identified
- [x] Test file locations decided
- [x] Priority assigned to each test

After test creation:
- [ ] Tests are failing (RED phase)
- [ ] Test descriptions match behavior
- [ ] No trivial tests (DGTS compliant)
