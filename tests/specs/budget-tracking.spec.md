# Test Specification: Project Budget Tracking System

**PRD Reference**: PRD-057
**Created**: 2026-01-16
**Status**: Draft

---

## 1. Unit Tests

### 1.1 Budget Calculations (`tests/unit/budget/calculations.test.ts`)

```typescript
describe('Budget Calculations', () => {
  describe('calculateAvailableBudget', () => {
    it('should return total - committed when committed < total', () => {
      // Input: total=100000, committed=60000
      // Expected: 40000
    });

    it('should return 0 when committed >= total', () => {
      // Input: total=100000, committed=120000
      // Expected: 0 (not negative)
    });

    it('should handle zero budget gracefully', () => {
      // Input: total=0, committed=0
      // Expected: 0
    });
  });

  describe('calculateVariancePercent', () => {
    it('should calculate positive variance when under budget', () => {
      // Input: total=100000, actual=80000
      // Expected: 20 (20% under budget)
    });

    it('should calculate negative variance when over budget', () => {
      // Input: total=100000, actual=110000
      // Expected: -10 (10% over budget)
    });

    it('should return 0 when total is 0', () => {
      // Input: total=0, actual=5000
      // Expected: 0 (avoid division by zero)
    });
  });

  describe('calculateUtilization', () => {
    it('should calculate utilization percentage correctly', () => {
      // Input: total=100000, committed=75000
      // Expected: 75
    });

    it('should cap at 100 when over budget', () => {
      // Input: total=100000, committed=150000
      // Expected: 150 (or flag as over)
    });
  });
});
```

### 1.2 Budget Threshold Checks (`tests/unit/budget/thresholds.test.ts`)

```typescript
describe('Budget Thresholds', () => {
  describe('checkBudgetAvailability', () => {
    it('should allow purchase when within budget', () => {
      // Budget: 100000, committed: 50000, request: 30000
      // Expected: { allowed: true, utilizationAfter: 80 }
    });

    it('should block purchase when would exceed budget', () => {
      // Budget: 100000, committed: 90000, request: 20000
      // Expected: { allowed: false, reason: 'over_budget', shortfall: 10000 }
    });

    it('should warn when approaching threshold', () => {
      // Budget: 100000, committed: 70000, request: 15000
      // Expected: { allowed: true, warning: true, utilizationAfter: 85 }
    });

    it('should return allowed=true when no budget configured', () => {
      // No budget exists for project
      // Expected: { allowed: true, reason: 'no_budget' }
    });

    it('should check category budget when category_id provided', () => {
      // Category allocated: 50000, committed: 45000, request: 10000
      // Expected: { allowed: false, reason: 'category_over_budget' }
    });

    it('should respect enforce_budget=false setting', () => {
      // Budget: 100000, committed: 90000, request: 20000, enforce=false
      // Expected: { allowed: true, warning: true }
    });
  });

  describe('shouldTriggerAlert', () => {
    it('should trigger warning at 80% utilization', () => {
      // Utilization: 80%, warning_threshold: 80
      // Expected: { trigger: true, type: 'warning' }
    });

    it('should trigger critical at 100% utilization', () => {
      // Utilization: 100%, critical_threshold: 100
      // Expected: { trigger: true, type: 'critical' }
    });

    it('should not trigger below threshold', () => {
      // Utilization: 75%, warning_threshold: 80
      // Expected: { trigger: false }
    });

    it('should not duplicate existing active alert', () => {
      // Active warning alert exists, utilization still at 82%
      // Expected: { trigger: false, reason: 'alert_exists' }
    });
  });
});
```

### 1.3 Budget Category Validation (`tests/unit/budget/categories.test.ts`)

```typescript
describe('Budget Categories', () => {
  describe('validateCategoryAllocation', () => {
    it('should accept valid allocation within total budget', () => {
      // Total budget: 100000
      // Categories: [40000, 30000, 20000, 10000] = 100000
      // Expected: valid
    });

    it('should reject allocation exceeding total budget', () => {
      // Total budget: 100000
      // Categories: [50000, 40000, 30000] = 120000
      // Expected: invalid, over by 20000
    });

    it('should allow partial allocation (categories < total)', () => {
      // Total budget: 100000
      // Categories: [40000, 30000] = 70000
      // Expected: valid (30000 unallocated)
    });
  });

  describe('mapBoqCategoriesToBudget', () => {
    it('should map BOQ categories to budget categories', () => {
      // BOQ items with categories: ['Materials', 'Equipment', 'Labor']
      // Expected: 3 budget_categories created with correct amounts
    });

    it('should aggregate same-category BOQ items', () => {
      // BOQ items: [Materials: 10000, Materials: 20000, Equipment: 15000]
      // Expected: Materials: 30000, Equipment: 15000
    });

    it('should handle missing category as UNCATEGORIZED', () => {
      // BOQ item with no category
      // Expected: maps to UNCATEGORIZED category
    });
  });
});
```

---

## 2. Integration Tests

### 2.1 Budget API (`tests/api/budget/budget-api.test.ts`)

```typescript
describe('Budget API', () => {
  describe('GET /api/projects/[id]/budget', () => {
    it('should return 404 when no budget exists', async () => {
      // GET /api/projects/{projectId}/budget
      // Expected: { exists: false }
    });

    it('should return budget with categories when exists', async () => {
      // Setup: Create budget with categories
      // GET /api/projects/{projectId}/budget
      // Expected: { exists: true, budget: {...}, categories: [...] }
    });

    it('should include calculated fields', async () => {
      // Setup: Budget with committed=50000, total=100000
      // Expected: available_budget=50000, variance_percent calculated
    });
  });

  describe('POST /api/projects/[id]/budget', () => {
    it('should create manual budget with default categories', async () => {
      // POST with: { sourceType: 'manual', totalBudget: 100000 }
      // Expected: Budget created, 7 default categories seeded
    });

    it('should reject duplicate budget for project', async () => {
      // Setup: Budget already exists
      // POST new budget
      // Expected: 409 Conflict
    });

    it('should validate required fields', async () => {
      // POST with: { sourceType: 'manual' } (missing totalBudget)
      // Expected: 400 Bad Request
    });
  });

  describe('POST /api/projects/[id]/budget/sync-boq', () => {
    it('should create budget from approved BOQ', async () => {
      // Setup: Approved BOQ with items totaling 150000
      // POST /api/projects/{id}/budget/sync-boq?boqId={boqId}
      // Expected: Budget created with total=150000
    });

    it('should map BOQ item categories', async () => {
      // Setup: BOQ with Materials=50000, Equipment=30000
      // Expected: budget_categories created with correct allocations
    });

    it('should reject unapproved BOQ', async () => {
      // Setup: BOQ with status='draft'
      // Expected: 400 "BOQ must be approved"
    });
  });

  describe('POST /api/projects/[id]/budget/adjust', () => {
    it('should create adjustment transaction', async () => {
      // POST with: { adjustmentType: 'increase', amount: 20000, reason: 'Scope change' }
      // Expected: Budget total increased, transaction logged
    });

    it('should require reason for adjustment', async () => {
      // POST without reason
      // Expected: 400 "Reason required"
    });

    it('should only allow admin users', async () => {
      // Non-admin user attempts adjustment
      // Expected: 403 Forbidden
    });
  });

  describe('POST /api/budget/check', () => {
    it('should return allowed=true for valid purchase', async () => {
      // Setup: Budget 100000, committed 50000
      // POST: { projectId, amount: 30000 }
      // Expected: { allowed: true, available: 50000, utilizationAfter: 80 }
    });

    it('should return allowed=false for over-budget', async () => {
      // Setup: Budget 100000, committed 90000, enforce=true
      // POST: { projectId, amount: 20000 }
      // Expected: { allowed: false, reason: 'over_budget', shortfall: 10000 }
    });

    it('should return warning flag at threshold', async () => {
      // Setup: Budget 100000, committed 75000
      // POST: { projectId, amount: 10000 }
      // Expected: { allowed: true, warning: true }
    });
  });
});
```

### 2.2 Budget Triggers (`tests/api/budget/triggers.test.ts`)

```typescript
describe('Budget Triggers', () => {
  describe('PO Approval Trigger', () => {
    beforeEach(async () => {
      // Setup: Project with budget 100000, committed 0
    });

    it('should increase committed_amount when PO approved', async () => {
      // Create PO for 30000, approve it
      // Expected: budget.committed_amount = 30000
    });

    it('should create commitment transaction', async () => {
      // Approve PO for 30000
      // Expected: budget_transactions record with type='commitment'
    });

    it('should trigger alert when crossing threshold', async () => {
      // Setup: committed=75000, approve PO for 10000 (85% utilization)
      // Expected: budget_alerts record with type='threshold_warning'
    });

    it('should reverse commitment on PO cancellation', async () => {
      // Approve PO for 30000, then cancel it
      // Expected: committed_amount back to 0, reversal transaction logged
    });
  });

  describe('GRN Completion Trigger', () => {
    beforeEach(async () => {
      // Setup: Project with budget, PO approved for 30000
    });

    it('should increase actual_amount when GRN completed', async () => {
      // Create GRN, complete it with total=28000
      // Expected: budget.actual_amount = 28000
    });

    it('should create receipt transaction', async () => {
      // Complete GRN
      // Expected: budget_transactions record with type='receipt'
    });

    it('should update budget health status', async () => {
      // Complete multiple GRNs exceeding 80%
      // Expected: project.budget_health = 'warning'
    });
  });
});
```

---

## 3. E2E Tests

### 3.1 Budget Workflow (`tests/e2e/budget-workflow.spec.ts`)

```typescript
describe('Budget Tracking E2E', () => {
  describe('Manual Budget Creation', () => {
    it('should create budget with manual entry', async () => {
      // 1. Navigate to project budget page
      // 2. Click "Create Budget"
      // 3. Select "Manual Entry"
      // 4. Enter total: 500000
      // 5. Allocate to categories
      // 6. Save
      // Expected: Budget visible on dashboard
    });
  });

  describe('BOQ Budget Sync', () => {
    it('should create budget from approved BOQ', async () => {
      // 1. Navigate to project with approved BOQ
      // 2. Click "Sync from BOQ"
      // 3. Confirm
      // Expected: Budget created matching BOQ total
    });
  });

  describe('PO Budget Enforcement', () => {
    it('should block over-budget PO creation', async () => {
      // 1. Setup: Budget 100000, committed 90000
      // 2. Create PO for 20000
      // 3. Try to submit
      // Expected: Modal blocking with "Request Override" button
    });

    it('should allow override after approval', async () => {
      // 1. Request override for over-budget PO
      // 2. Admin approves override
      // 3. Original user submits PO
      // Expected: PO created successfully
    });
  });

  describe('Budget Adjustments', () => {
    it('should allow admin to adjust budget', async () => {
      // 1. Login as admin
      // 2. Navigate to budget page
      // 3. Click "Adjust Budget"
      // 4. Increase by 50000 with reason
      // 5. Save
      // Expected: Budget total updated, transaction logged
    });
  });

  describe('Budget Alerts', () => {
    it('should show alert when threshold reached', async () => {
      // 1. Setup: Budget at 79%
      // 2. Approve PO pushing to 82%
      // Expected: Warning alert visible on dashboard
    });

    it('should allow acknowledging alerts', async () => {
      // 1. Alert exists
      // 2. Click "Acknowledge"
      // Expected: Alert status = 'acknowledged'
    });
  });
});
```

---

## 4. Test Data Requirements

### 4.1 Fixtures (`tests/fixtures/budget.fixtures.ts`)

```typescript
export const budgetFixtures = {
  validBudget: {
    sourceType: 'manual',
    totalBudget: 100000,
    currency: 'ZAR',
    enforceBudget: true,
    allowOverride: true,
    alertThresholdWarning: 80,
    alertThresholdCritical: 100,
  },

  defaultCategories: [
    { code: 'MATERIALS', name: 'Materials & Consumables', allocation: 40000 },
    { code: 'EQUIPMENT', name: 'Equipment & Tools', allocation: 20000 },
    { code: 'LABOR', name: 'Labor Costs', allocation: 15000 },
    { code: 'SUBCONTRACT', name: 'Subcontractor Work', allocation: 10000 },
    { code: 'TRANSPORT', name: 'Transport & Logistics', allocation: 5000 },
    { code: 'OVERHEAD', name: 'Overhead & Admin', allocation: 5000 },
    { code: 'CONTINGENCY', name: 'Contingency Reserve', allocation: 5000 },
  ],

  boqWithCategories: {
    status: 'approved',
    totalEstimatedValue: 150000,
    items: [
      { category: 'Materials', amount: 60000 },
      { category: 'Equipment', amount: 40000 },
      { category: 'Labor', amount: 30000 },
      { category: 'Transport', amount: 20000 },
    ],
  },
};
```

---

## 5. Test Coverage Requirements

| Area | Minimum Coverage |
|------|------------------|
| Budget calculations | 100% |
| Budget check logic | 100% |
| API endpoints | 90% |
| Database triggers | 90% |
| UI components | 80% |

---

## 6. TDD Implementation Order

### Phase 1: Core Logic (RED → GREEN)
1. Write `calculations.test.ts` - all tests RED
2. Implement `src/lib/budget/calculations.ts` - tests GREEN
3. Write `thresholds.test.ts` - all tests RED
4. Implement `src/lib/budget/thresholds.ts` - tests GREEN

### Phase 2: Database (RED → GREEN)
1. Write `triggers.test.ts` - all tests RED
2. Create migration `056_budget_tracking.sql`
3. Implement triggers - tests GREEN

### Phase 3: API (RED → GREEN)
1. Write `budget-api.test.ts` - all tests RED
2. Implement API endpoints - tests GREEN

### Phase 4: E2E (RED → GREEN)
1. Write `budget-workflow.spec.ts` - all tests RED
2. Implement UI components - tests GREEN
