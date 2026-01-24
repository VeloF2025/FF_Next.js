# Test Specification: Self-Healing Dashboard

## Source

- **PRD/Spec**: `.claude/plans/sequential-growing-brook.md`
- **Date Created**: 2026-01-24
- **Author**: Claude (TDD Implementation)

---

## Overview

The Self-Healing Dashboard is a tab within the System Health Hub that provides visibility into the autonomous recovery system. It shows service registry status, active incidents, pending HITL approvals, recovery history timeline, and learning statistics.

---

## Feature Requirements

### FR-1: Service Registry Grid
- Display all registered services with current status
- Group by category: App, AI, Messaging, Database, Infrastructure
- Each card shows: name, status, last check time, recovery enabled flag
- Click to expand: health endpoint, recovery actions, recent history

### FR-2: Active Incidents Panel
- List all unresolved incidents
- Each incident shows: service, issue type, started at, attempts made
- Color coded by severity (safe=yellow, moderate=orange, dangerous=red)
- Action buttons: View Details, Dismiss (if false positive)

### FR-3: Pending Approvals Queue (HITL)
- List actions waiting for human approval
- Each shows: service, action description, risk level, requested at
- Buttons: Approve, Reject, View Context
- Approve executes the action, Reject logs dismissal

### FR-4: Recovery History Timeline
- Shows last 50 recovery actions (24-48 hours)
- Filters: All, Success, Failed, Pending
- Each entry: timestamp, service, action, result, duration
- Click to expand: full command, output, error if failed

### FR-5: Learning Statistics
- Success rate per service (pie chart or bar)
- Fix classification breakdown (safe/moderate/dangerous)
- Trending: actions promoted/demoted based on success
- Human override count

---

## Unit Tests - Service Registry Grid

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| SR-001 | Renders all registered services | 14 services | 14 cards shown | HIGH |
| SR-002 | Groups services by category | Mixed categories | 5 category groups | HIGH |
| SR-003 | Shows UP status with green badge | Service up | Green "UP" badge | HIGH |
| SR-004 | Shows DOWN status with red badge | Service down | Red "DOWN" badge | HIGH |
| SR-005 | Shows DEGRADED status with yellow | Service degraded | Yellow "DEGRADED" | HIGH |
| SR-006 | Shows last check timestamp | 2 min ago | "2m ago" | MEDIUM |
| SR-007 | Shows recovery enabled icon | Recovery on | Shield icon | MEDIUM |
| SR-008 | Expand shows health endpoint | Click expand | URL displayed | MEDIUM |
| SR-009 | Expand shows recovery actions | Click expand | Action list | MEDIUM |
| SR-010 | Empty state when no services | 0 services | "No services" message | LOW |

### Test File Location
`tests/unit/modules/system/components/ServiceRegistryGrid.test.tsx`

---

## Unit Tests - Active Incidents Panel

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| AI-001 | Renders active incidents | 3 incidents | 3 cards shown | HIGH |
| AI-002 | Shows service name | VLM incident | "VLM" displayed | HIGH |
| AI-003 | Shows issue type | Connection timeout | "Connection timeout" | HIGH |
| AI-004 | Shows time elapsed | Started 15m ago | "15m" displayed | HIGH |
| AI-005 | Shows attempt count | 2 attempts | "2 attempts" | HIGH |
| AI-006 | Safe severity is yellow | risk=safe | Yellow background | MEDIUM |
| AI-007 | Moderate severity is orange | risk=moderate | Orange background | MEDIUM |
| AI-008 | Dangerous severity is red | risk=dangerous | Red background | MEDIUM |
| AI-009 | View Details opens modal | Click button | Modal opens | HIGH |
| AI-010 | Dismiss removes incident | Click dismiss | Incident gone | HIGH |
| AI-011 | Empty state when no incidents | 0 incidents | "All clear" message | MEDIUM |

### Test File Location
`tests/unit/modules/system/components/ActiveIncidentsPanel.test.tsx`

---

## Unit Tests - Pending Approvals Queue

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| PA-001 | Renders pending approvals | 2 pending | 2 cards shown | HIGH |
| PA-002 | Shows service name | WA Bridge | "WA Bridge" | HIGH |
| PA-003 | Shows action description | "Restart service" | Action displayed | HIGH |
| PA-004 | Shows risk level badge | Moderate | "MODERATE" badge | HIGH |
| PA-005 | Shows requested timestamp | 5m ago | "5m ago" | MEDIUM |
| PA-006 | Approve button calls API | Click approve | POST to /approve | HIGH |
| PA-007 | Reject button calls API | Click reject | POST to /reject | HIGH |
| PA-008 | View Context shows details | Click view | Context modal | MEDIUM |
| PA-009 | Approve removes from queue | Success response | Card removed | HIGH |
| PA-010 | Reject removes from queue | Success response | Card removed | HIGH |
| PA-011 | Empty state when no pending | 0 pending | "No pending" msg | MEDIUM |
| PA-012 | Shows confirmation on approve | Click approve | Confirm dialog | HIGH |

### Test File Location
`tests/unit/modules/system/components/PendingApprovalsQueue.test.tsx`

---

## Unit Tests - Recovery History Timeline

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| RH-001 | Renders recovery history | 10 actions | 10 entries shown | HIGH |
| RH-002 | Sorted newest first | Mixed times | Newest at top | HIGH |
| RH-003 | Shows timestamp | 2h ago | "2h ago" | HIGH |
| RH-004 | Shows service name | VLM | "VLM" | HIGH |
| RH-005 | Shows action name | Restart | "Restart" | HIGH |
| RH-006 | Success shows green check | result=success | Green checkmark | HIGH |
| RH-007 | Failed shows red X | result=failed | Red X | HIGH |
| RH-008 | Pending shows spinner | result=pending | Spinner | HIGH |
| RH-009 | Shows duration | 45s | "45s" | MEDIUM |
| RH-010 | Filter by success | Click success | Only success shown | HIGH |
| RH-011 | Filter by failed | Click failed | Only failed shown | HIGH |
| RH-012 | Expand shows command | Click row | Command displayed | MEDIUM |
| RH-013 | Expand shows output | Click row | Output displayed | MEDIUM |
| RH-014 | Failed shows error | Click failed row | Error displayed | MEDIUM |
| RH-015 | Load more on scroll | Scroll bottom | More items load | LOW |

### Test File Location
`tests/unit/modules/system/components/RecoveryHistoryTimeline.test.tsx`

---

## Unit Tests - Learning Statistics

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| LS-001 | Shows overall success rate | 90% | "90%" displayed | HIGH |
| LS-002 | Shows per-service rates | 3 services | 3 bars/slices | MEDIUM |
| LS-003 | Shows classification breakdown | 10/5/2 | Pie chart correct | MEDIUM |
| LS-004 | Shows promoted actions count | 3 promoted | "3" displayed | MEDIUM |
| LS-005 | Shows demoted actions count | 1 demoted | "1" displayed | MEDIUM |
| LS-006 | Shows human override count | 5 overrides | "5" displayed | MEDIUM |
| LS-007 | Empty state when no data | No history | "No data yet" | LOW |

### Test File Location
`tests/unit/modules/system/components/LearningStatistics.test.tsx`

---

## Integration Tests

| ID | Description | Components Involved | Expected Behavior | Priority |
|----|-------------|---------------------|-------------------|----------|
| IT-001 | Dashboard fetches all data | Dashboard, APIs | All sections populated | HIGH |
| IT-002 | Approve action executes | Queue, API, Service | Action runs, queue updates | HIGH |
| IT-003 | Reject action logs | Queue, API | Logged, removed from queue | HIGH |
| IT-004 | Dismiss incident updates DB | Panel, API | Incident marked resolved | HIGH |
| IT-005 | Real-time updates work | Dashboard, SSE/Poll | New incidents appear | MEDIUM |
| IT-006 | Filters persist on refresh | Timeline, URL | Same filter active | MEDIUM |

### Test File Location
`tests/integration/api/system/self-healing.test.ts`

---

## Acceptance Criteria Mapping

- [x] **AC1**: Service registry with status → `SR-001` - `SR-010`
- [x] **AC2**: Active incidents panel → `AI-001` - `AI-011`
- [x] **AC3**: Pending approvals queue → `PA-001` - `PA-012`
- [x] **AC4**: Recovery history timeline → `RH-001` - `RH-015`
- [x] **AC5**: Learning statistics → `LS-001` - `LS-007`
- [x] **AC6**: Approve/Reject HITL actions → `PA-006`, `PA-007`, `IT-002`, `IT-003`
- [x] **AC7**: Filter recovery history → `RH-010`, `RH-011`
- [x] **AC8**: Expand for details → `SR-008`, `RH-012`

---

## API Endpoints Required

```typescript
// GET /api/system/self-healing/services
interface ServiceRegistryResponse {
  services: ServiceDefinition[];
}

// GET /api/system/self-healing/incidents
interface IncidentsResponse {
  incidents: Incident[];
}

// GET /api/system/self-healing/approvals
interface ApprovalsResponse {
  pending: PendingApproval[];
}

// POST /api/system/approve-recovery
interface ApproveRequest {
  approvalId: string;
  action: 'approve' | 'reject';
  notes?: string;
}

// GET /api/system/self-healing/history
interface HistoryResponse {
  actions: RecoveryAction[];
  total: number;
  page: number;
}

// GET /api/system/self-healing/stats
interface StatsResponse {
  overallSuccessRate: number;
  perServiceRates: Record<string, number>;
  classificationBreakdown: { safe: number; moderate: number; dangerous: number };
  promotedCount: number;
  demotedCount: number;
  humanOverrideCount: number;
}
```

---

## Notes

- Dashboard should use WebSocket or SSE for real-time incident updates
- Approve action requires confirmation modal to prevent accidental clicks
- History timeline should virtualize for performance with large datasets
- Learning stats can be expensive - consider caching for 5 minutes

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
