# Test Specification: Health Daemon

## Source

- **PRD/Spec**: `.claude/plans/sequential-growing-brook.md`
- **Date Created**: 2026-01-24
- **Author**: Claude (TDD Implementation)

---

## Overview

The Health Daemon is a long-running background process that continuously monitors all registered services. It runs health checks every 60 seconds, detects issues, triggers recovery actions, and logs all activity. Runs as a systemd service on the Velocity server.

---

## Feature Requirements

### FR-1: Continuous Monitoring Loop
- Check all services every 60 seconds
- Support configurable interval per service
- Handle concurrent checks (parallel where possible)
- Graceful shutdown on SIGTERM

### FR-2: Health Check Execution
- HTTP endpoints: Check response status (200-299 = up)
- Systemd services: Check via `systemctl is-active`
- Database endpoints: Test connection with simple query
- Support custom health check scripts

### FR-3: Status Determination
- UP: Health check passes
- DOWN: Health check fails
- DEGRADED: Health check slow (>5s) or partial success
- UNKNOWN: Cannot reach endpoint

### FR-4: Issue Detection & Classification
- Detect when service transitions from UP to DOWN/DEGRADED
- Classify issue type: timeout, connection_refused, 5xx_error, auth_failure
- Determine severity based on service criticality and duration

### FR-5: Recovery Triggering
- When issue detected, look up recovery actions for service
- Execute safe actions automatically
- Queue moderate/dangerous actions for HITL approval
- Respect cooldown periods between attempts

### FR-6: Logging & Metrics
- Log all checks to `system_health_logs` table
- Track response times for performance trending
- Emit metrics for external monitoring (optional)

---

## Unit Tests - Health Check Execution

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| HC-001 | HTTP 200 response is UP | 200 response | status=up | HIGH |
| HC-002 | HTTP 201 response is UP | 201 response | status=up | HIGH |
| HC-003 | HTTP 500 response is DOWN | 500 response | status=down | HIGH |
| HC-004 | HTTP 503 response is DOWN | 503 response | status=down | HIGH |
| HC-005 | Connection refused is DOWN | ECONNREFUSED | status=down | HIGH |
| HC-006 | Timeout is DEGRADED | >5s response | status=degraded | HIGH |
| HC-007 | Network unreachable is UNKNOWN | ENETUNREACH | status=unknown | HIGH |
| HC-008 | Systemd active is UP | active | status=up | HIGH |
| HC-009 | Systemd inactive is DOWN | inactive | status=down | HIGH |
| HC-010 | Systemd failed is DOWN | failed | status=down | HIGH |
| HC-011 | DB connection success is UP | Query success | status=up | HIGH |
| HC-012 | DB connection failure is DOWN | Query fail | status=down | HIGH |
| HC-013 | Response time recorded | 45ms response | latency=45 | MEDIUM |

### Test File Location
`tests/unit/modules/system/healthCheck.test.ts`

---

## Unit Tests - Monitoring Loop

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| ML-001 | Loop runs every 60s | Default config | 60s interval | HIGH |
| ML-002 | Loop checks all services | 14 services | 14 checks | HIGH |
| ML-003 | Checks run in parallel | 14 services | All concurrent | HIGH |
| ML-004 | Failed check doesn't stop loop | 1 failure | Loop continues | HIGH |
| ML-005 | Loop respects per-service interval | Custom interval | Correct timing | MEDIUM |
| ML-006 | Graceful shutdown on SIGTERM | SIGTERM sent | Clean exit | HIGH |
| ML-007 | Graceful shutdown on SIGINT | SIGINT sent | Clean exit | HIGH |
| ML-008 | In-progress checks complete on shutdown | Shutdown mid-check | Checks finish | MEDIUM |
| ML-009 | Loop logs start/stop | Start/stop | Logs written | MEDIUM |
| ML-010 | Loop handles empty registry | 0 services | No error | LOW |

### Test File Location
`tests/unit/modules/system/monitoringLoop.test.ts`

---

## Unit Tests - Issue Detection

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| ID-001 | Detect UP to DOWN transition | Previous=up, Current=down | Issue detected | HIGH |
| ID-002 | Detect UP to DEGRADED transition | Previous=up, Current=degraded | Issue detected | HIGH |
| ID-003 | No issue on UP to UP | Previous=up, Current=up | No issue | HIGH |
| ID-004 | No issue on DOWN to DOWN | Previous=down, Current=down | No issue (already down) | HIGH |
| ID-005 | Classify timeout issue | Timeout error | type=timeout | HIGH |
| ID-006 | Classify connection refused | ECONNREFUSED | type=connection_refused | HIGH |
| ID-007 | Classify 5xx error | 500 response | type=5xx_error | HIGH |
| ID-008 | Classify auth failure | 401/403 response | type=auth_failure | HIGH |
| ID-009 | Critical service = high severity | isCritical=true | severity=high | HIGH |
| ID-010 | Non-critical = low severity | isCritical=false | severity=low | HIGH |
| ID-011 | Long outage increases severity | >5 min down | severity increases | MEDIUM |

### Test File Location
`tests/unit/modules/system/issueDetection.test.ts`

---

## Unit Tests - Recovery Triggering

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| RT-001 | Safe action auto-executes | Safe action available | Action executed | HIGH |
| RT-002 | Moderate action queued for HITL | Moderate action | Added to queue | HIGH |
| RT-003 | Dangerous action queued for HITL | Dangerous action | Added to queue | HIGH |
| RT-004 | Cooldown prevents rapid retry | Recent execution | Action skipped | HIGH |
| RT-005 | No action if recovery disabled | recoveryEnabled=false | No action | HIGH |
| RT-006 | Multiple actions tried in order | 3 actions | Sequential attempt | MEDIUM |
| RT-007 | Stops on successful action | 1st succeeds | No further actions | MEDIUM |
| RT-008 | All actions fail creates incident | All fail | Incident created | HIGH |
| RT-009 | Success resets failure count | Action succeeds | failureCount reset | MEDIUM |
| RT-010 | Failure increments count | Action fails | failureCount++ | MEDIUM |

### Test File Location
`tests/unit/modules/system/recoveryTrigger.test.ts`

---

## Unit Tests - Logging

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| LG-001 | Health check logged | Check complete | DB row created | HIGH |
| LG-002 | Log includes timestamp | Check complete | Timestamp present | HIGH |
| LG-003 | Log includes service ID | Check complete | Service ID present | HIGH |
| LG-004 | Log includes status | Check complete | Status present | HIGH |
| LG-005 | Log includes latency | Check complete | Latency present | HIGH |
| LG-006 | Error logged on failure | Check fails | Error message logged | HIGH |
| LG-007 | Logs pruned after 30 days | Old logs exist | Logs deleted | MEDIUM |

### Test File Location
`tests/unit/modules/system/healthLogging.test.ts`

---

## Integration Tests

| ID | Description | Components Involved | Expected Behavior | Priority |
|----|-------------|---------------------|-------------------|----------|
| IT-001 | Daemon starts and runs | Daemon, Registry | Services checked | HIGH |
| IT-002 | Status persists to DB | Daemon, DB | Status logged | HIGH |
| IT-003 | Issue creates incident | Daemon, Incidents | Incident created | HIGH |
| IT-004 | Safe action executed | Daemon, Recovery | Service restarted | HIGH |
| IT-005 | HITL approval queued | Daemon, Approvals | Approval created | HIGH |
| IT-006 | Multiple services parallel | Daemon | All checked ~same time | MEDIUM |
| IT-007 | Daemon survives DB outage | Daemon, DB down | Retries, doesn't crash | HIGH |
| IT-008 | Daemon reconnects after outage | Daemon, DB restored | Resumes logging | HIGH |

### Test File Location
`tests/integration/daemon/healthDaemon.test.ts`

---

## Acceptance Criteria Mapping

- [x] **AC1**: Check all services every 60s → `ML-001`, `ML-002`
- [x] **AC2**: HTTP endpoint health checks → `HC-001` - `HC-007`
- [x] **AC3**: Systemd service checks → `HC-008` - `HC-010`
- [x] **AC4**: Database connection checks → `HC-011`, `HC-012`
- [x] **AC5**: Detect UP→DOWN transitions → `ID-001`, `ID-002`
- [x] **AC6**: Classify issue types → `ID-005` - `ID-008`
- [x] **AC7**: Auto-execute safe actions → `RT-001`
- [x] **AC8**: Queue moderate/dangerous for HITL → `RT-002`, `RT-003`
- [x] **AC9**: Respect cooldown periods → `RT-004`
- [x] **AC10**: Log all checks → `LG-001` - `LG-006`
- [x] **AC11**: Graceful shutdown → `ML-006`, `ML-007`

---

## Edge Cases

| Scenario | Expected Behavior | Test ID |
|----------|-------------------|---------|
| All services down | Continue checking, create incidents | IT-003 |
| Database unreachable | Buffer logs, retry connection | IT-007, IT-008 |
| Service added mid-run | Picked up on next cycle | - |
| Service removed mid-run | Skipped gracefully | - |
| Very slow health check | Timeout after 30s | HC-006 |
| Rapid oscillation (flapping) | Suppress alerts after 3 flaps | - |

---

## Daemon Configuration

```typescript
interface DaemonConfig {
  checkIntervalMs: number;        // Default: 60000 (60s)
  healthCheckTimeoutMs: number;   // Default: 30000 (30s)
  cooldownMinutes: number;        // Default: 5
  maxConcurrentChecks: number;    // Default: 10
  logRetentionDays: number;       // Default: 30
  enableRecovery: boolean;        // Default: true
}
```

---

## Systemd Service File

```ini
# /etc/systemd/system/self-healing-daemon.service
[Unit]
Description=FibreFlow Self-Healing Infrastructure Daemon
After=network.target

[Service]
Type=simple
User=velo
WorkingDirectory=/home/velo/fibreflow-production
ExecStart=/usr/bin/node scripts/infrastructure/self-healing-daemon.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

---

## Notes

- Use p-limit or similar for concurrency control
- Implement exponential backoff for failed health checks
- Consider circuit breaker pattern for persistently failing services
- Buffer logs in memory if DB is temporarily unavailable
- Emit metrics to stdout in OpenTelemetry format for Grafana

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
