# Test Specification: Overview Dashboard

## Source

- **PRD/Spec**: `.claude/plans/sequential-growing-brook.md`
- **Date Created**: 2026-01-24
- **Author**: Claude (TDD Implementation)

---

## Overview

The Overview Dashboard is the landing tab of the System Health Hub. It aggregates health data from all subsystems (Infrastructure, QField, Self-Healing) into a single at-a-glance view with stat cards and recent activity timeline.

---

## Feature Requirements

### FR-1: Overall Status Indicator
- Shows single status: HEALTHY (green), DEGRADED (yellow), CRITICAL (red)
- Status determined by: all services up = HEALTHY, 1-3 down = DEGRADED, 4+ down = CRITICAL
- Large prominent display at top of dashboard

### FR-2: Stat Cards Grid
Display 8 stat cards in responsive grid (4x2 on desktop, 2x4 on tablet, 1x8 on mobile):

| Card | Label | Value Format | Data Source |
|------|-------|--------------|-------------|
| 1 | Services Up | `X/Y` | Service registry count |
| 2 | Active Incidents | `N` | infrastructure_incidents (resolved=false) |
| 3 | VLM Latency | `XXms` | VLM health endpoint avg |
| 4 | DB Query Time | `XXms` | DB health endpoint avg |
| 5 | Auto-Fixes Today | `N` | recovery_actions (today, auto) |
| 6 | Last Issue | `Xm ago` | Latest incident timestamp |
| 7 | Pending Approvals | `N` | HITL queue count |
| 8 | Success Rate | `XX%` | success / (success + failure) |

### FR-3: Recent Activity Timeline
- Shows last 10 system events (max 24 hours)
- Event types: service_restart, incident_created, incident_resolved, approval_requested, fix_executed
- Each entry: timestamp, icon, description, status badge

### FR-4: Quick Actions
- Refresh All button
- Link to each subsystem tab for details
- Optional: collapse/expand sections

---

## Unit Tests - Stat Cards

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| SC-001 | Services Up shows correct count | 12 up, 14 total | "12/14" displayed | HIGH |
| SC-002 | Services Up all green when 100% | 14/14 | Green badge | HIGH |
| SC-003 | Services Up yellow when degraded | 11/14 | Yellow badge | HIGH |
| SC-004 | Services Up red when critical | 8/14 | Red badge | HIGH |
| SC-005 | Active Incidents shows count | 3 active | "3" displayed | HIGH |
| SC-006 | Active Incidents zero shows green | 0 active | "0" with green | HIGH |
| SC-007 | VLM Latency shows milliseconds | 45ms avg | "45ms" | HIGH |
| SC-008 | VLM Latency red when > 500ms | 600ms | Red badge | MEDIUM |
| SC-009 | DB Query Time shows milliseconds | 12ms avg | "12ms" | HIGH |
| SC-010 | DB Query Time red when > 100ms | 150ms | Red badge | MEDIUM |
| SC-011 | Auto-Fixes Today shows count | 5 today | "5" | HIGH |
| SC-012 | Last Issue shows relative time | 2 hours ago | "2h ago" | HIGH |
| SC-013 | Last Issue shows "None" if no issues | No incidents | "None" | MEDIUM |
| SC-014 | Pending Approvals shows queue | 2 pending | "2" with badge | HIGH |
| SC-015 | Success Rate shows percentage | 45/50 | "90%" | HIGH |
| SC-016 | Success Rate 100% is green | 50/50 | "100%" green | MEDIUM |
| SC-017 | Success Rate < 80% is yellow | 35/50 | "70%" yellow | MEDIUM |
| SC-018 | Success Rate < 50% is red | 20/50 | "40%" red | MEDIUM |

### Test File Location
`tests/unit/modules/system/components/StatCards.test.tsx`

---

## Unit Tests - Overall Status

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| OS-001 | HEALTHY when all services up | 14/14 up, 0 incidents | Green "HEALTHY" | HIGH |
| OS-002 | DEGRADED when 1-3 services down | 11/14 up | Yellow "DEGRADED" | HIGH |
| OS-003 | CRITICAL when 4+ services down | 9/14 up | Red "CRITICAL" | HIGH |
| OS-004 | CRITICAL when critical service down | VLM down | Red "CRITICAL" | HIGH |
| OS-005 | Status updates on data refresh | Status changes | New status shown | MEDIUM |

### Test File Location
`tests/unit/modules/system/components/OverviewDashboard.test.tsx`

---

## Unit Tests - Activity Timeline

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| AT-001 | Shows last 10 events | 15 events | Only 10 shown | HIGH |
| AT-002 | Events sorted newest first | Mixed timestamps | Newest at top | HIGH |
| AT-003 | Service restart event renders | restart event | "VLM restarted" | HIGH |
| AT-004 | Incident created event renders | incident event | "Incident: DB down" | HIGH |
| AT-005 | Incident resolved event renders | resolved event | "Resolved: DB down" | HIGH |
| AT-006 | Approval requested event renders | approval event | "Approval needed: ..." | HIGH |
| AT-007 | Empty state when no events | No events | "No recent activity" | MEDIUM |
| AT-008 | Event timestamp relative | 30 min ago | "30m ago" | MEDIUM |
| AT-009 | Event timestamp absolute for > 24h | Yesterday | "Jan 23, 14:30" | MEDIUM |

### Test File Location
`tests/unit/modules/system/components/ActivityTimeline.test.tsx`

---

## Integration Tests

| ID | Description | Components Involved | Expected Behavior | Priority |
|----|-------------|---------------------|-------------------|----------|
| IT-001 | Dashboard fetches all stats | Dashboard, API | All cards populated | HIGH |
| IT-002 | Dashboard fetches activity | Dashboard, API | Timeline populated | HIGH |
| IT-003 | Partial API failure handled | Dashboard, API | Failed cards show error | HIGH |
| IT-004 | Refresh updates all data | Dashboard, API | New data displayed | HIGH |
| IT-005 | Loading states shown | Dashboard | Skeletons during load | MEDIUM |

### Test File Location
`tests/integration/api/system/overview.test.ts`

---

## Acceptance Criteria Mapping

- [x] **AC1**: Overall status shows HEALTHY/DEGRADED/CRITICAL → `OS-001`, `OS-002`, `OS-003`
- [x] **AC2**: Services Up shows X/Y format → `SC-001`, `SC-002`
- [x] **AC3**: Active Incidents shows count → `SC-005`, `SC-006`
- [x] **AC4**: VLM Latency shows avg ms → `SC-007`, `SC-008`
- [x] **AC5**: DB Query Time shows avg ms → `SC-009`, `SC-010`
- [x] **AC6**: Auto-Fixes Today shows count → `SC-011`
- [x] **AC7**: Last Issue shows time ago → `SC-012`, `SC-013`
- [x] **AC8**: Pending Approvals shows queue count → `SC-014`
- [x] **AC9**: Success Rate shows percentage → `SC-015`, `SC-016`
- [x] **AC10**: Recent Activity shows timeline → `AT-001`, `AT-002`
- [x] **AC11**: Auto-refresh every 30s → `IT-004`

---

## Edge Cases

| Scenario | Expected Behavior | Test ID |
|----------|-------------------|---------|
| All APIs fail | Show error state with retry | IT-003 |
| Zero services registered | Show "No services configured" | - |
| No historical data | Show "No data available" in cards | SC-013 |
| Very long service names | Truncate with ellipsis | - |
| Rapid status changes | Debounce updates | - |

---

## API Endpoints Required

```typescript
// GET /api/system/overview
interface OverviewResponse {
  overallStatus: 'healthy' | 'degraded' | 'critical';
  stats: {
    servicesUp: number;
    servicesTotal: number;
    activeIncidents: number;
    vlmLatencyMs: number;
    dbQueryTimeMs: number;
    autoFixesToday: number;
    lastIssueAt: string | null;
    pendingApprovals: number;
    successRate: number; // 0-100
  };
  recentActivity: ActivityEvent[];
}

interface ActivityEvent {
  id: string;
  type: 'service_restart' | 'incident_created' | 'incident_resolved' | 'approval_requested' | 'fix_executed';
  description: string;
  timestamp: string;
  status: 'success' | 'failure' | 'pending';
  serviceId?: string;
  incidentId?: string;
}
```

---

## Notes

- Stat cards should use shared `StatCard` component for consistency
- Color coding: green (#22c55e), yellow (#eab308), red (#ef4444)
- Timeline should lazy-load more events on scroll (future enhancement)
- Consider caching API response for 10 seconds to reduce load

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
