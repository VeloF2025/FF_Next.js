# Test Specification: Project Hub System Integration

**PRD Reference**: System Integration Plan (2026-01-25)
**Created**: 2026-01-25
**Status**: Draft - Sprint 1

---

## Overview

The Project Hub integrates data from 7 major modules (Projects, Contractors, Clients, H&S, Pipeline, Maintenance, Procurement) into a unified dashboard. This spec covers Sprint 1: Foundation.

### Sprint 1 Scope
1. Database schema (is_primary flag, views)
2. PM field migration
3. Dashboard APIs (6 endpoints)
4. Project Detail Page redesign

---

## 1. Unit Tests

### 1.1 Project Team Service (`tests/unit/projects/projectTeamService.test.ts`)

```typescript
describe('ProjectTeamService', () => {
  describe('getPrimaryManager', () => {
    it('should return staff member with is_primary=true', () => {
      // Setup: staff_projects with one is_primary=true
      // Expected: Returns that staff member
    });

    it('should return null when no primary manager assigned', () => {
      // Setup: staff_projects without is_primary=true
      // Expected: null
    });

    it('should handle project with no team members', () => {
      // Setup: No staff_projects records
      // Expected: null
    });
  });

  describe('getUnifiedTeam', () => {
    it('should combine staff and contractors into unified view', () => {
      // Setup: 3 staff + 2 contractors
      // Expected: 5 team members with person_type field
    });

    it('should only include active team members', () => {
      // Setup: 3 active staff, 1 inactive staff
      // Expected: 3 team members
    });

    it('should include role for each team member', () => {
      // Setup: staff with roles 'Engineer', 'Technician'
      // Expected: Each team member has role field
    });
  });

  describe('assignPrimaryManager', () => {
    it('should set is_primary=true for specified staff', () => {
      // Input: staffId, projectId
      // Expected: is_primary=true, previous primary=false
    });

    it('should unset previous primary when assigning new', () => {
      // Setup: Existing primary manager
      // Input: Different staffId
      // Expected: Old primary=false, new primary=true
    });

    it('should fail if staff not assigned to project', () => {
      // Setup: Staff not in staff_projects
      // Expected: Error 'Staff not assigned to project'
    });
  });
});
```

### 1.2 Project Dashboard Aggregation (`tests/unit/projects/projectDashboardService.test.ts`)

```typescript
describe('ProjectDashboardService', () => {
  describe('aggregateMetrics', () => {
    it('should return all module metrics for project', () => {
      // Setup: Project with budget, tickets, POs, audits
      // Expected: {
      //   budget: { total, committed, actual, health },
      //   team: { staffCount, contractorCount },
      //   hs: { latestScore, complianceStatus },
      //   maintenance: { openTickets, resolvedThisMonth },
      //   procurement: { pendingPOs, pendingRFQs }
      // }
    });

    it('should return default values when no data exists', () => {
      // Setup: Project with no related records
      // Expected: All metrics have sensible defaults (0, null, 'unknown')
    });

    it('should calculate budget health correctly', () => {
      // Setup: budget=100000, actual=85000
      // Expected: health='warning' (85% utilization)
    });
  });

  describe('getActivityTimeline', () => {
    it('should combine activities from all modules', () => {
      // Setup: PO approved, ticket resolved, audit completed
      // Expected: 3 activities sorted by date desc
    });

    it('should limit results to specified count', () => {
      // Setup: 20 activities
      // Input: limit=10
      // Expected: 10 most recent activities
    });

    it('should include module source for each activity', () => {
      // Setup: Mixed activities
      // Expected: Each has 'module' field (procurement, maintenance, hs)
    });
  });
});
```

### 1.3 PM Migration Utility (`tests/unit/projects/pmMigration.test.ts`)

```typescript
describe('PM Migration', () => {
  describe('migrateProjectManager', () => {
    it('should create staff_projects record with is_primary=true', () => {
      // Setup: Project with project_manager='uuid'
      // Expected: staff_projects record created
    });

    it('should skip if primary already exists', () => {
      // Setup: is_primary=true already exists
      // Expected: No duplicate created
    });

    it('should handle invalid project_manager UUID', () => {
      // Setup: project_manager='not-a-uuid'
      // Expected: Logged and skipped, not error
    });

    it('should use role="Project Manager"', () => {
      // Setup: Valid migration
      // Expected: role='Project Manager'
    });
  });

  describe('validateMigration', () => {
    it('should report count of migrated records', () => {
      // Setup: 10 projects with managers, 5 without
      // Expected: { migrated: 10, skipped: 5 }
    });
  });
});
```

---

## 2. Integration Tests

### 2.1 Dashboard API (`tests/api/projects/dashboard-api.test.ts`)

```typescript
describe('Project Dashboard API', () => {
  describe('GET /api/projects/[projectId]/dashboard', () => {
    it('should return aggregated metrics from all modules', async () => {
      // Setup: Project with budget, team, tickets
      // GET /api/projects/{id}/dashboard
      // Expected: 200 with all metric categories
    });

    it('should return 404 for non-existent project', async () => {
      // GET /api/projects/{invalid-uuid}/dashboard
      // Expected: 404
    });

    it('should require authentication', async () => {
      // No auth header
      // Expected: 401
    });
  });

  describe('GET /api/projects/[projectId]/team', () => {
    it('should return unified staff and contractor list', async () => {
      // Setup: 2 staff + 1 contractor
      // Expected: 3 team members with person_type
    });

    it('should identify primary manager', async () => {
      // Setup: One staff with is_primary=true
      // Expected: That member has isPrimary: true
    });

    it('should only return active members by default', async () => {
      // Setup: 2 active, 1 inactive
      // Expected: 2 members
    });

    it('should include inactive when requested', async () => {
      // GET /api/projects/{id}/team?includeInactive=true
      // Expected: 3 members
    });
  });

  describe('GET /api/projects/[projectId]/timeline', () => {
    it('should return cross-module activity feed', async () => {
      // Setup: PO, Ticket, Audit events
      // Expected: Combined timeline sorted by date
    });

    it('should respect limit parameter', async () => {
      // GET /api/projects/{id}/timeline?limit=5
      // Expected: Max 5 items
    });
  });

  describe('GET /api/projects/[projectId]/procurement-summary', () => {
    it('should return BOQ, RFQ, PO, GRN counts', async () => {
      // Setup: Various procurement records
      // Expected: { boqs: 1, rfqs: 2, pos: 5, grns: 3 }
    });

    it('should include total values', async () => {
      // Setup: POs with values
      // Expected: { totalPoValue: 150000, totalGrnValue: 120000 }
    });

    it('should show pending items', async () => {
      // Setup: 2 pending POs, 1 pending RFQ
      // Expected: { pendingPOs: 2, pendingRFQs: 1 }
    });
  });

  describe('GET /api/projects/[projectId]/maintenance-summary', () => {
    it('should return ticket counts by status', async () => {
      // Setup: 3 open, 5 resolved, 2 closed tickets
      // Expected: { open: 3, resolved: 5, closed: 2 }
    });

    it('should include resolution metrics', async () => {
      // Setup: Tickets with resolution times
      // Expected: { avgResolutionHours: 24.5 }
    });
  });

  describe('GET /api/projects/[projectId]/hs-summary', () => {
    it('should return latest audit score', async () => {
      // Setup: 2 audits, latest score=92
      // Expected: { latestScore: 92 }
    });

    it('should return compliance status', async () => {
      // Setup: All requirements met
      // Expected: { complianceStatus: 'compliant' }
    });

    it('should return null when no audits exist', async () => {
      // Setup: No audits
      // Expected: { latestScore: null, complianceStatus: 'unknown' }
    });
  });
});
```

### 2.2 Database Views (`tests/api/projects/views.test.ts`)

```typescript
describe('Database Views', () => {
  describe('v_project_team view', () => {
    it('should combine staff and contractor records', async () => {
      // Setup: staff_projects + contractor_projects
      // Query: SELECT * FROM v_project_team WHERE project_id = ?
      // Expected: Combined results with person_type
    });

    it('should use correct person_type values', async () => {
      // Expected: 'staff' or 'contractor'
    });
  });

  describe('v_project_dashboard view', () => {
    it('should calculate staff and contractor counts', async () => {
      // Setup: 3 active staff, 2 inactive, 1 contractor
      // Expected: staff_count=3, contractor_count=1
    });

    it('should include budget metrics', async () => {
      // Setup: project_budgets record
      // Expected: total_budget, committed_amount in view
    });

    it('should include H&S score', async () => {
      // Setup: hs_project_audits record
      // Expected: latest_hs_score populated
    });

    it('should include maintenance ticket count', async () => {
      // Setup: 5 open tickets
      // Expected: open_tickets=5
    });

    it('should include pending PO count', async () => {
      // Setup: 2 pending_approval POs
      // Expected: pending_pos=2
    });
  });
});
```

---

## 3. E2E Tests

### 3.1 Project Hub Workflow (`tests/e2e/project-hub.spec.ts`)

```typescript
describe('Project Hub E2E', () => {
  describe('Project Detail Page', () => {
    it('should display overview with metrics from all modules', async () => {
      // 1. Navigate to /projects/{id}
      // 2. Verify overview tab is default
      // Expected: Progress, Budget, Team, H&S cards visible
    });

    it('should show team tab with staff and contractors', async () => {
      // 1. Navigate to project
      // 2. Click Team tab
      // Expected: List shows both staff and contractors
    });

    it('should indicate primary manager', async () => {
      // 1. View team tab
      // Expected: PM has badge/indicator
    });

    it('should show procurement summary with quick links', async () => {
      // 1. Click Procurement tab
      // Expected: BOQ/RFQ/PO/GRN counts, links to each
    });

    it('should show maintenance summary with ticket counts', async () => {
      // 1. Click Maintenance tab
      // Expected: Open/Resolved/Closed counts
    });

    it('should show H&S score and compliance', async () => {
      // 1. Click H&S tab
      // Expected: Latest score, compliance status
    });

    it('should show activity timeline on overview', async () => {
      // 1. View overview tab
      // Expected: Recent activities from all modules
    });
  });

  describe('Quick Actions', () => {
    it('should navigate to BOQ from procurement card', async () => {
      // 1. Click "View BOQ" link
      // Expected: Navigate to /procurement/boq?project={id}
    });

    it('should navigate to open tickets from maintenance card', async () => {
      // 1. Click "Open Tickets: N" link
      // Expected: Navigate to /maintenance?project={id}&status=open
    });

    it('should navigate to latest audit from H&S card', async () => {
      // 1. Click "Latest Audit" link
      // Expected: Navigate to audit detail page
    });
  });

  describe('Manager Assignment', () => {
    it('should allow reassigning primary manager (admin)', async () => {
      // 1. Login as admin
      // 2. Navigate to team tab
      // 3. Click "Set as Primary" on different staff
      // Expected: New manager shown as primary
    });

    it('should prevent non-admin from reassigning PM', async () => {
      // 1. Login as regular user
      // 2. Navigate to team tab
      // Expected: "Set as Primary" button not visible
    });
  });
});
```

---

## 4. Test Data Requirements

### 4.1 Fixtures (`tests/fixtures/project-hub.fixtures.ts`)

```typescript
export const projectHubFixtures = {
  // Base project
  project: {
    id: 'test-project-001',
    project_code: 'LAW-001',
    project_name: 'Lawley Fiber Network',
    status: 'active',
    progress: 75,
    budget: 3000000,
    actual_cost: 2550000,
  },

  // Team members
  team: {
    staff: [
      { id: 'staff-001', name: 'John Smith', role: 'Project Manager', is_primary: true },
      { id: 'staff-002', name: 'Jane Doe', role: 'Engineer', is_primary: false },
      { id: 'staff-003', name: 'Bob Wilson', role: 'Technician', is_primary: false },
    ],
    contractors: [
      { id: 'contractor-001', name: 'ABC Fiber Co', role: 'Installation' },
      { id: 'contractor-002', name: 'XYZ Trenching', role: 'Civil Works' },
    ],
  },

  // Budget data
  budget: {
    total_budget: 3000000,
    committed_amount: 2700000,
    actual_amount: 2550000,
    budget_health: 'warning', // 85% actual
  },

  // H&S data
  hs: {
    latest_audit: {
      score: 92,
      date: '2026-01-20',
    },
    compliance_status: 'compliant',
  },

  // Maintenance data
  maintenance: {
    tickets: {
      open: 5,
      in_progress: 3,
      resolved: 15,
      closed: 27,
    },
    avg_resolution_hours: 18.5,
  },

  // Procurement data
  procurement: {
    boqs: 1,
    rfqs: 3,
    pos: { total: 12, pending: 2, approved: 8, completed: 2 },
    grns: { total: 6, pending: 1, completed: 5 },
    total_po_value: 2800000,
    total_grn_value: 2550000,
  },
};
```

---

## 5. Test Coverage Requirements

| Area | Minimum Coverage |
|------|------------------|
| ProjectTeamService | 100% |
| ProjectDashboardService | 100% |
| PM Migration utility | 100% |
| Dashboard API endpoints | 90% |
| Database views | 90% |
| UI components | 80% |

---

## 6. TDD Implementation Order

### Phase 1: Database (RED -> GREEN)
1. Write `views.test.ts` - all tests RED
2. Create migration `130_system_integration.sql`
3. Run migration - tests GREEN

### Phase 2: Services (RED -> GREEN)
1. Write `projectTeamService.test.ts` - all tests RED
2. Implement `ProjectTeamService.ts` - tests GREEN
3. Write `projectDashboardService.test.ts` - all tests RED
4. Implement `ProjectDashboardService.ts` - tests GREEN

### Phase 3: PM Migration (RED -> GREEN)
1. Write `pmMigration.test.ts` - all tests RED
2. Implement migration script - tests GREEN
3. Run migration against dev DB

### Phase 4: API (RED -> GREEN)
1. Write `dashboard-api.test.ts` - all tests RED
2. Implement 6 API endpoints - tests GREEN

### Phase 5: E2E (RED -> GREEN)
1. Write `project-hub.spec.ts` - all tests RED
2. Implement Project Detail Page redesign - tests GREEN

---

## 7. Acceptance Criteria Mapping

| Criterion | Description | Tests |
|-----------|-------------|-------|
| AC1 | Unified project team view (staff + contractors) | UT-1.1, IT-2.1 |
| AC2 | Primary manager identified via is_primary flag | UT-1.1, IT-2.1 |
| AC3 | Dashboard shows metrics from all 7 modules | UT-1.2, IT-2.1 |
| AC4 | Activity timeline combines all module events | UT-1.2, IT-2.1 |
| AC5 | PM migration preserves existing data | UT-1.3 |
| AC6 | Project detail page shows tabbed interface | E2E-3.1 |
| AC7 | Quick links navigate to correct module pages | E2E-3.1 |

---

## 8. UI Theme Considerations

### Velocity Theme Integration
- Use `useVelocityTheme` hook for dynamic styling
- Apply glassmorphism effects to metric cards: `velocityGlassmorphism.transparency.medium`
- Neon accents for status indicators: `velocityColors.neon.cyan`, `velocityColors.neon.green`
- Elevation for cards: `velocityElevation[3]` for default, `velocityElevation[5]` for hover
- Gradient backgrounds: `velocityGradients.card` for metric cards

### Component Patterns
- Metric cards: Glass effect with neon border glow
- Tab navigation: Underline with cyan accent
- Status badges: Neon colors (green=good, yellow=warning, red=critical)
- Activity timeline: Subtle gradient background, avatar icons

### CSS Variables (existing)
- `--ff-card-bg`: Card background
- `--ff-border-light`: Border color
- `--ff-text-primary`: Primary text
- `--ff-text-secondary`: Secondary text

---

## 9. Notes

### Dependencies
- `staff_projects` table must exist (already present)
- `contractor_projects` table must exist (verify)
- `project_budgets` table must exist (already present)
- `tickets` table must have `project_id` column (verify)
- `purchase_orders` table must have `project_id` column (verify)
- `hs_project_audits` table must exist (verify)

### Mocking Requirements
- Database: Use test DB or mock Neon client
- Auth: Mock authenticated user with admin role for some tests

### Setup/Teardown
- Create test project with all related records
- Clean up after each test suite
