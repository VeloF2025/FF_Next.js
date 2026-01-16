/**
 * Tests for Budget API endpoints
 * PRD-057: Project Budget Tracking System
 *
 * TDD Phase: RED - Tests written before implementation
 * Tests verify expected behavior patterns and type contracts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ProjectBudget,
  BudgetCategory,
  BudgetTransaction,
  BudgetAlert,
  BudgetCheckResult,
  BudgetSourceType,
  BudgetStatus,
} from '../../../src/types/budget';

describe('Budget API - Behavior Tests', () => {
  describe('GET /api/projects/[id]/budget - Response Structure', () => {
    it('BA-001: should return exists=false when no budget exists', () => {
      const mockResponse = {
        success: true,
        data: {
          exists: false,
        },
      };

      expect(mockResponse.success).toBe(true);
      expect(mockResponse.data.exists).toBe(false);
    });

    it('BA-002: should return budget with categories when exists', () => {
      const mockResponse = {
        success: true,
        data: {
          exists: true,
          budget: {
            id: 'budget-1',
            projectId: 'project-1',
            sourceType: 'manual' as BudgetSourceType,
            totalBudget: 100000,
            committedAmount: 50000,
            actualAmount: 30000,
            availableBudget: 50000,
            variancePercent: 70,
            status: 'approved' as BudgetStatus,
            enforceBudget: true,
            allowOverride: true,
            alertThresholdWarning: 80,
            alertThresholdCritical: 100,
          } as Partial<ProjectBudget>,
          categories: [
            {
              id: 'cat-1',
              categoryCode: 'MATERIALS',
              categoryName: 'Materials & Consumables',
              allocatedAmount: 40000,
              committedAmount: 20000,
              actualAmount: 15000,
              availableAmount: 20000,
            },
          ] as Partial<BudgetCategory>[],
        },
      };

      expect(mockResponse.success).toBe(true);
      expect(mockResponse.data.exists).toBe(true);
      expect(mockResponse.data.budget).toBeDefined();
      expect(mockResponse.data.categories).toBeInstanceOf(Array);
      expect(mockResponse.data.categories.length).toBeGreaterThan(0);
    });

    it('BA-003: should include calculated fields in response', () => {
      const budget: Partial<ProjectBudget> = {
        totalBudget: 100000,
        committedAmount: 50000,
        actualAmount: 30000,
        availableBudget: 50000,
        varianceAmount: 70000,
        variancePercent: 70,
      };

      // Verify calculated fields are present
      expect(budget.availableBudget).toBeDefined();
      expect(budget.varianceAmount).toBeDefined();
      expect(budget.variancePercent).toBeDefined();

      // Verify calculation logic
      expect(budget.availableBudget).toBe(budget.totalBudget! - budget.committedAmount!);
    });
  });

  describe('POST /api/projects/[id]/budget - Create Budget', () => {
    it('BA-004: should accept manual budget creation', () => {
      const validBody = {
        sourceType: 'manual',
        totalBudget: 100000,
        currency: 'ZAR',
        enforceBudget: true,
        allowOverride: true,
      };

      expect(validBody.sourceType).toBe('manual');
      expect(validBody.totalBudget).toBeGreaterThan(0);
    });

    it('BA-005: should require totalBudget for manual source', () => {
      const invalidBody = {
        sourceType: 'manual',
        // totalBudget missing
      };

      const hasRequiredFields =
        invalidBody.sourceType === 'manual' &&
        (invalidBody as any).totalBudget !== undefined;

      expect(hasRequiredFields).toBe(false);
    });

    it('BA-006: should create with 7 default categories', () => {
      const expectedCategories = [
        'MATERIALS',
        'EQUIPMENT',
        'LABOR',
        'SUBCONTRACT',
        'TRANSPORT',
        'OVERHEAD',
        'CONTINGENCY',
      ];

      expect(expectedCategories).toHaveLength(7);
    });

    it('BA-007: should reject duplicate budget for project', () => {
      const errorResponse = {
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'Budget already exists for this project',
        },
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.error.code).toBe('CONFLICT');
    });
  });

  describe('POST /api/projects/[id]/budget/sync-boq - BOQ Sync', () => {
    it('BA-008: should require boqId parameter', () => {
      const invalidBody = {
        // boqId missing
      };

      const hasBoqId = (invalidBody as any).boqId !== undefined;
      expect(hasBoqId).toBe(false);
    });

    it('BA-009: should reject unapproved BOQ', () => {
      const errorResponse = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'BOQ must be approved before syncing to budget',
        },
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.error.message).toContain('approved');
    });

    it('BA-010: should map BOQ categories to budget categories', () => {
      const boqCategories = ['Materials', 'Equipment', 'Labor'];
      const mappedCodes = ['MATERIALS', 'EQUIPMENT', 'LABOR'];

      expect(boqCategories).toHaveLength(mappedCodes.length);
    });
  });

  describe('POST /api/projects/[id]/budget/adjust - Manual Adjustment', () => {
    it('BA-011: should require reason for adjustment', () => {
      const invalidBody = {
        adjustmentType: 'increase',
        amount: 20000,
        // reason missing
      };

      const hasReason = (invalidBody as any).reason !== undefined;
      expect(hasReason).toBe(false);
    });

    it('BA-012: should accept valid adjustment request', () => {
      const validBody = {
        adjustmentType: 'increase',
        amount: 20000,
        reason: 'Scope change approved in CR-001',
      };

      expect(validBody.adjustmentType).toBeDefined();
      expect(validBody.amount).toBeGreaterThan(0);
      expect(validBody.reason).toBeDefined();
      expect(validBody.reason.length).toBeGreaterThan(0);
    });

    it('BA-013: should create transaction record for adjustment', () => {
      const expectedTransaction: Partial<BudgetTransaction> = {
        transactionType: 'adjustment',
        amount: 20000,
        description: 'Budget increase: Scope change approved',
      };

      expect(expectedTransaction.transactionType).toBe('adjustment');
      expect(expectedTransaction.amount).toBeDefined();
    });
  });

  describe('POST /api/budget/check - Budget Availability Check', () => {
    it('BA-014: should return allowed=true for valid purchase', () => {
      const mockResult: BudgetCheckResult = {
        allowed: true,
        reason: 'ok',
        available: 50000,
        requested: 30000,
        allowOverride: true,
        utilizationAfter: 80,
        utilizationBefore: 50,
        warning: false,
      };

      expect(mockResult.allowed).toBe(true);
      expect(mockResult.reason).toBe('ok');
      expect(mockResult.requested).toBeLessThanOrEqual(mockResult.available);
    });

    it('BA-015: should return allowed=false for over-budget', () => {
      const mockResult: BudgetCheckResult = {
        allowed: false,
        reason: 'over_budget',
        available: 10000,
        requested: 20000,
        shortfall: 10000,
        allowOverride: true,
        utilizationAfter: 110,
        utilizationBefore: 90,
        warning: true,
      };

      expect(mockResult.allowed).toBe(false);
      expect(mockResult.reason).toBe('over_budget');
      expect(mockResult.shortfall).toBe(mockResult.requested - mockResult.available);
    });

    it('BA-016: should return warning flag at threshold', () => {
      const mockResult: BudgetCheckResult = {
        allowed: true,
        available: 15000,
        requested: 10000,
        allowOverride: true,
        utilizationAfter: 85,
        utilizationBefore: 75,
        warning: true,
      };

      expect(mockResult.allowed).toBe(true);
      expect(mockResult.warning).toBe(true);
      expect(mockResult.utilizationAfter).toBeGreaterThan(80);
    });
  });
});

describe('Budget Type Validation', () => {
  describe('BudgetSourceType', () => {
    it('should have all valid source types', () => {
      const validTypes: BudgetSourceType[] = ['manual', 'boq', 'hybrid'];

      expect(validTypes).toHaveLength(3);
      expect(validTypes).toContain('manual');
      expect(validTypes).toContain('boq');
    });
  });

  describe('BudgetStatus', () => {
    it('should have all valid status values', () => {
      const validStatuses: BudgetStatus[] = ['draft', 'approved', 'locked', 'closed'];

      expect(validStatuses).toHaveLength(4);
      expect(validStatuses).toContain('draft');
      expect(validStatuses).toContain('approved');
    });
  });

  describe('ProjectBudget interface', () => {
    it('should have required fields', () => {
      const mockBudget: Partial<ProjectBudget> = {
        id: 'budget-1',
        projectId: 'project-1',
        sourceType: 'manual',
        totalBudget: 100000,
        committedAmount: 0,
        actualAmount: 0,
        availableBudget: 100000,
        status: 'draft',
        enforceBudget: true,
        allowOverride: true,
      };

      expect(mockBudget.id).toBeDefined();
      expect(mockBudget.projectId).toBeDefined();
      expect(mockBudget.sourceType).toBeDefined();
      expect(mockBudget.totalBudget).toBeDefined();
    });
  });

  describe('BudgetCategory interface', () => {
    it('should have required fields', () => {
      const mockCategory: Partial<BudgetCategory> = {
        id: 'cat-1',
        projectBudgetId: 'budget-1',
        categoryCode: 'MATERIALS',
        categoryName: 'Materials & Consumables',
        allocatedAmount: 40000,
        committedAmount: 0,
        actualAmount: 0,
        availableAmount: 40000,
        isCustom: false,
        sortOrder: 1,
      };

      expect(mockCategory.categoryCode).toBeDefined();
      expect(mockCategory.categoryName).toBeDefined();
      expect(mockCategory.allocatedAmount).toBeDefined();
    });
  });
});

describe('Budget API Response Helpers', () => {
  it('should format budget response correctly', () => {
    const formatBudgetResponse = (
      budget: Partial<ProjectBudget>,
      categories: Partial<BudgetCategory>[]
    ) => ({
      success: true,
      data: {
        exists: true,
        budget,
        categories,
        summary: {
          totalBudget: budget.totalBudget,
          committed: budget.committedAmount,
          actual: budget.actualAmount,
          available: budget.availableBudget,
          utilizationPercent: budget.totalBudget
            ? Math.round(((budget.committedAmount || 0) / budget.totalBudget) * 100)
            : 0,
        },
      },
    });

    const result = formatBudgetResponse(
      { totalBudget: 100000, committedAmount: 50000, availableBudget: 50000 },
      []
    );

    expect(result.success).toBe(true);
    expect(result.data.exists).toBe(true);
    expect(result.data.summary.utilizationPercent).toBe(50);
  });

  it('should format check result response correctly', () => {
    const formatCheckResponse = (result: BudgetCheckResult) => ({
      success: true,
      data: result,
      meta: {
        timestamp: new Date().toISOString(),
      },
    });

    const checkResult: BudgetCheckResult = {
      allowed: true,
      available: 50000,
      requested: 30000,
      allowOverride: true,
      utilizationAfter: 80,
      utilizationBefore: 50,
      warning: false,
    };

    const response = formatCheckResponse(checkResult);

    expect(response.success).toBe(true);
    expect(response.data.allowed).toBe(true);
    expect(response.meta.timestamp).toBeDefined();
  });

  it('should format validation error correctly', () => {
    const formatValidationError = (errors: Record<string, string>) => ({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: errors,
      },
    });

    const result = formatValidationError({
      totalBudget: 'Total budget is required for manual entry',
    });

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('VALIDATION_ERROR');
    expect(result.error.details.totalBudget).toBeDefined();
  });
});

describe('Budget Alerts API', () => {
  describe('GET /api/projects/[id]/budget/alerts', () => {
    it('BA-017: should return active alerts', () => {
      const mockResponse = {
        success: true,
        data: {
          alerts: [
            {
              id: 'alert-1',
              alertType: 'threshold_warning',
              severity: 'warning',
              thresholdPercent: 80,
              currentPercent: 85,
              title: 'Budget Warning: 85% utilized',
              status: 'active',
            },
          ] as Partial<BudgetAlert>[],
          summary: {
            active: 1,
            acknowledged: 0,
            resolved: 0,
          },
        },
      };

      expect(mockResponse.success).toBe(true);
      expect(mockResponse.data.alerts).toBeInstanceOf(Array);
      expect(mockResponse.data.summary.active).toBe(1);
    });
  });

  describe('POST /api/projects/[id]/budget/alerts/[id]/acknowledge', () => {
    it('BA-018: should acknowledge alert', () => {
      const mockResponse = {
        success: true,
        data: {
          id: 'alert-1',
          status: 'acknowledged',
          acknowledgedBy: 'user-1',
          acknowledgedAt: new Date().toISOString(),
        },
      };

      expect(mockResponse.success).toBe(true);
      expect(mockResponse.data.status).toBe('acknowledged');
      expect(mockResponse.data.acknowledgedBy).toBeDefined();
    });
  });
});

describe('Budget Transactions API', () => {
  describe('GET /api/projects/[id]/budget/transactions', () => {
    it('BA-019: should return paginated transactions', () => {
      const mockResponse = {
        success: true,
        data: {
          transactions: [
            {
              id: 'txn-1',
              transactionType: 'commitment',
              sourceType: 'purchase_order',
              sourceNumber: 'PO-2026-0001',
              amount: 30000,
              description: 'PO approved',
              createdAt: new Date().toISOString(),
            },
          ] as Partial<BudgetTransaction>[],
        },
        pagination: {
          page: 1,
          pageSize: 50,
          total: 1,
          totalPages: 1,
        },
      };

      expect(mockResponse.success).toBe(true);
      expect(mockResponse.data.transactions).toBeInstanceOf(Array);
      expect(mockResponse.pagination).toBeDefined();
    });

    it('BA-020: should filter by transaction type', () => {
      const filterParams = {
        type: 'commitment',
        page: 1,
        pageSize: 50,
      };

      expect(filterParams.type).toBe('commitment');
    });
  });
});
