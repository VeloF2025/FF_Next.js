# Test Specification: System Health Hub

## Source

- **PRD/Spec**: `.claude/plans/sequential-growing-brook.md`
- **Date Created**: 2026-01-24
- **Author**: Claude (TDD Implementation)

---

## Overview

Unified System Health Hub consolidating 4 separate monitoring pages into one tabbed interface at `/system/health`. Provides Overview, Infrastructure, QField, and Self-Healing tabs with super_admin access only.

---

## Feature Requirements

### FR-1: Unified Tab Interface
- Single page at `/system/health` with 4 tabs
- Tabs: Overview (default), Infrastructure, QField, Self-Healing
- Tab state persisted in URL query param (`?tab=infrastructure`)
- Responsive design - tabs collapse to dropdown on mobile

### FR-2: Super Admin Access Control
- Only users with `SYSTEM_ADMIN` permission can access
- Unauthorized users see AccessDenied component
- Sidebar shows single "System Health" entry (replaces 3-4 scattered items)

### FR-3: Component Reuse
- Infrastructure tab: Renders existing `InfrastructureHealthDashboard`
- QField tab: Renders existing `QFieldDashboard`
- Overview tab: New aggregated dashboard
- Self-Healing tab: New recovery management dashboard

### FR-4: Auto-Refresh
- All tabs auto-refresh every 30 seconds
- Manual refresh button available
- Loading state shown during refresh

---

## Unit Tests

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| UT-001 | Renders with 4 tabs | Valid user | 4 tab buttons visible | HIGH |
| UT-002 | Default tab is Overview | No query param | Overview tab active | HIGH |
| UT-003 | Tab switch updates URL | Click Infrastructure | `?tab=infrastructure` in URL | HIGH |
| UT-004 | URL param sets active tab | `?tab=qfield` | QField tab active | HIGH |
| UT-005 | Invalid tab param defaults to Overview | `?tab=invalid` | Overview tab active | MEDIUM |
| UT-006 | Unauthorized user sees AccessDenied | No SYSTEM_ADMIN | AccessDenied component | HIGH |
| UT-007 | Infrastructure tab renders dashboard | Tab active | InfrastructureHealthDashboard | HIGH |
| UT-008 | QField tab renders dashboard | Tab active | QFieldDashboard | HIGH |
| UT-009 | Auto-refresh triggers every 30s | 30s elapsed | Data refreshed | MEDIUM |
| UT-010 | Manual refresh button works | Click refresh | Data refreshed immediately | MEDIUM |

### Test File Location
`tests/unit/modules/system/components/SystemHealthHub.test.tsx`

---

## Integration Tests

| ID | Description | Components Involved | Expected Behavior | Priority |
|----|-------------|---------------------|-------------------|----------|
| IT-001 | Page loads with auth | Page, AuthContext | Renders for super_admin | HIGH |
| IT-002 | Page blocks unauthorized | Page, AuthContext | AccessDenied for manager | HIGH |
| IT-003 | Tab navigation works | Tabs, Router | URL updates, content changes | HIGH |
| IT-004 | Health data fetches | Page, API | Data populates dashboards | HIGH |
| IT-005 | Error handling on API failure | Page, API | Error message shown | MEDIUM |

### Test File Location
`tests/integration/api/system/health.test.ts`

---

## E2E Tests

| ID | User Flow | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| E2E-001 | Navigate all tabs | 1. Login as super_admin<br>2. Go to /system/health<br>3. Click each tab | All 4 tabs load correctly | HIGH |
| E2E-002 | Unauthorized access | 1. Login as manager<br>2. Go to /system/health | Access denied page | HIGH |
| E2E-003 | Deep link to tab | 1. Login<br>2. Go to /system/health?tab=qfield | QField tab active | MEDIUM |
| E2E-004 | Refresh preserves tab | 1. Select Self-Healing tab<br>2. Browser refresh | Self-Healing still active | MEDIUM |

### Test File Location
`tests/e2e/system-health-hub.spec.ts`

---

## Acceptance Criteria Mapping

- [x] **AC1**: ONE unified System Health menu item → `UT-001`, `IT-001`, `E2E-001`
- [x] **AC2**: 4 tabs: Overview, Infrastructure, QField, Self-Healing → `UT-001`, `UT-007`, `UT-008`
- [x] **AC3**: Super admin only access → `UT-006`, `IT-002`, `E2E-002`
- [x] **AC4**: Tab state in URL → `UT-003`, `UT-004`, `E2E-003`, `E2E-004`
- [x] **AC5**: Reuse existing dashboards → `UT-007`, `UT-008`, `IT-004`
- [x] **AC6**: Auto-refresh every 30s → `UT-009`
- [x] **AC7**: Manual refresh button → `UT-010`

---

## Edge Cases

| Scenario | Expected Behavior | Test ID |
|----------|-------------------|---------|
| Network timeout on data fetch | Show error, retry button | IT-005 |
| User loses permission mid-session | Redirect to AccessDenied on next action | - |
| Tab component throws error | Show error boundary, other tabs work | - |
| Very slow API response | Show loading skeleton | - |
| Browser back button | Previous tab shown | E2E-004 |

---

## Component Props

```typescript
interface SystemHealthHubProps {
  initialTab?: 'overview' | 'infrastructure' | 'qfield' | 'self-healing';
}
```

---

## Tab Configuration

```typescript
const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'infrastructure', label: 'Infrastructure', icon: Server },
  { id: 'qfield', label: 'QField', icon: MapPin },
  { id: 'self-healing', label: 'Self-Healing', icon: ShieldCheck },
] as const;
```

---

## Notes

- InfrastructureHealthDashboard exists at `src/modules/system/components/InfrastructureHealthDashboard.tsx`
- QFieldDashboard exists at `src/modules/system/qfield/QFieldDashboard.tsx`
- Must update sidebar config to remove old menu items
- Consider SSR for initial data fetch

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
