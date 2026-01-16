/**
 * Budget Threshold Tests
 * PRD-057: Project Budget Tracking System
 *
 * TDD Phase: RED - Tests written before implementation
 * These tests will FAIL until src/lib/budget/thresholds.ts is implemented
 */

import { describe, it, expect } from 'vitest';
import {
  checkBudgetAvailability,
  shouldTriggerAlert,
} from '../../../lib/budget/thresholds';
import type {
  ProjectBudget,
  BudgetCategory,
  BudgetCheckResult,
  AlertTriggerResult,
  BudgetAlert,
} from '../../../src/types/budget';

describe('Budget Thresholds', () => {
  describe('checkBudgetAvailability', () => {
    // Mock budget data for tests
    const createMockBudget = (
      overrides: Partial<ProjectBudget> = {}
    ): ProjectBudget => ({
      id: 'budget-001',
      projectId: 'project-001',
      sourceType: 'manual',
      totalBudget: 100000,
      currency: 'ZAR',
      committedAmount: 0,
      actualAmount: 0,
      availableBudget: 100000,
      varianceAmount: 100000,
      variancePercent: 100,
      status: 'approved',
      enforceBudget: true,
      allowOverride: true,
      alertThresholdWarning: 80,
      alertThresholdCritical: 100,
      createdBy: 'test-user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    });

    it('BT-001: should allow purchase when within budget', () => {
      // Budget: 100000, committed: 50000, request: 30000
      // Expected: { allowed: true, utilizationAfter: 80 }
      const budget = createMockBudget({
        committedAmount: 50000,
        availableBudget: 50000,
      });

      const result = checkBudgetAvailability(budget, 30000);

      expect(result.allowed).toBe(true);
      expect(result.utilizationAfter).toBe(80);
      expect(result.warning).toBe(false);
    });

    it('BT-002: should block purchase when would exceed budget', () => {
      // Budget: 100000, committed: 90000, request: 20000
      // Expected: { allowed: false, reason: 'over_budget', shortfall: 10000 }
      const budget = createMockBudget({
        committedAmount: 90000,
        availableBudget: 10000,
      });

      const result = checkBudgetAvailability(budget, 20000);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('over_budget');
      expect(result.shortfall).toBe(10000);
    });

    it('BT-003: should warn when approaching threshold', () => {
      // Budget: 100000, committed: 70000, request: 15000
      // Expected: { allowed: true, warning: true, utilizationAfter: 85 }
      const budget = createMockBudget({
        committedAmount: 70000,
        availableBudget: 30000,
      });

      const result = checkBudgetAvailability(budget, 15000);

      expect(result.allowed).toBe(true);
      expect(result.warning).toBe(true);
      expect(result.utilizationAfter).toBe(85);
    });

    it('BT-004: should return allowed=true when no budget configured', () => {
      // No budget exists for project
      // Expected: { allowed: true, reason: 'no_budget' }
      const result = checkBudgetAvailability(null, 50000);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('no_budget');
    });

    it('BT-005: should check category budget when category provided', () => {
      // Category allocated: 50000, committed: 45000, request: 10000
      // Expected: { allowed: false, reason: 'category_over_budget' }
      const budget = createMockBudget({
        committedAmount: 45000,
        availableBudget: 55000,
      });

      const category: BudgetCategory = {
        id: 'cat-001',
        projectBudgetId: budget.id,
        categoryCode: 'MATERIALS',
        categoryName: 'Materials',
        allocatedAmount: 50000,
        committedAmount: 45000,
        actualAmount: 0,
        availableAmount: 5000,
        isCustom: false,
        sortOrder: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = checkBudgetAvailability(budget, 10000, category);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('category_over_budget');
    });

    it('BT-006: should respect enforce_budget=false setting', () => {
      // Budget: 100000, committed: 90000, request: 20000, enforce=false
      // Expected: { allowed: true, warning: true }
      const budget = createMockBudget({
        committedAmount: 90000,
        availableBudget: 10000,
        enforceBudget: false,
      });

      const result = checkBudgetAvailability(budget, 20000);

      expect(result.allowed).toBe(true);
      expect(result.warning).toBe(true);
    });

    it('BT-007: should indicate allowOverride when budget blocks', () => {
      // Budget blocks but allows override
      const budget = createMockBudget({
        committedAmount: 90000,
        availableBudget: 10000,
        allowOverride: true,
      });

      const result = checkBudgetAvailability(budget, 20000);

      expect(result.allowed).toBe(false);
      expect(result.allowOverride).toBe(true);
    });

    it('BT-008: should not allow override when disabled', () => {
      // Budget blocks and override disabled
      const budget = createMockBudget({
        committedAmount: 90000,
        availableBudget: 10000,
        allowOverride: false,
      });

      const result = checkBudgetAvailability(budget, 20000);

      expect(result.allowed).toBe(false);
      expect(result.allowOverride).toBe(false);
    });

    it('BT-009: should calculate utilization before and after', () => {
      const budget = createMockBudget({
        committedAmount: 50000,
        availableBudget: 50000,
      });

      const result = checkBudgetAvailability(budget, 20000);

      expect(result.utilizationBefore).toBe(50);
      expect(result.utilizationAfter).toBe(70);
    });

    it('BT-010: should handle exact budget match', () => {
      // Request exactly matches available
      const budget = createMockBudget({
        committedAmount: 80000,
        availableBudget: 20000,
      });

      const result = checkBudgetAvailability(budget, 20000);

      expect(result.allowed).toBe(true);
      expect(result.utilizationAfter).toBe(100);
      expect(result.warning).toBe(true);
    });
  });

  describe('shouldTriggerAlert', () => {
    const createMockAlert = (
      overrides: Partial<BudgetAlert> = {}
    ): BudgetAlert => ({
      id: 'alert-001',
      projectBudgetId: 'budget-001',
      alertType: 'threshold_warning',
      severity: 'warning',
      thresholdPercent: 80,
      currentPercent: 80,
      title: 'Budget Warning',
      status: 'active',
      createdAt: new Date().toISOString(),
      ...overrides,
    });

    it('AT-001: should trigger warning at 80% utilization', () => {
      // Utilization: 80%, warning_threshold: 80
      // Expected: { trigger: true, type: 'warning' }
      const result = shouldTriggerAlert(80, 80, 100, []);

      expect(result.trigger).toBe(true);
      expect(result.type).toBe('warning');
    });

    it('AT-002: should trigger critical at 100% utilization', () => {
      // Utilization: 100%, critical_threshold: 100
      // Expected: { trigger: true, type: 'critical' }
      const result = shouldTriggerAlert(100, 80, 100, []);

      expect(result.trigger).toBe(true);
      expect(result.type).toBe('critical');
    });

    it('AT-003: should not trigger below threshold', () => {
      // Utilization: 75%, warning_threshold: 80
      // Expected: { trigger: false }
      const result = shouldTriggerAlert(75, 80, 100, []);

      expect(result.trigger).toBe(false);
    });

    it('AT-004: should not duplicate existing active alert', () => {
      // Active warning alert exists, utilization still at 82%
      // Expected: { trigger: false, reason: 'alert_exists' }
      const existingAlerts: BudgetAlert[] = [
        createMockAlert({ alertType: 'threshold_warning', status: 'active' }),
      ];

      const result = shouldTriggerAlert(82, 80, 100, existingAlerts);

      expect(result.trigger).toBe(false);
      expect(result.reason).toBe('alert_exists');
    });

    it('AT-005: should trigger if previous alert was acknowledged', () => {
      // Previous alert acknowledged, utilization increased to 95%
      const existingAlerts: BudgetAlert[] = [
        createMockAlert({
          alertType: 'threshold_warning',
          status: 'acknowledged',
        }),
      ];

      const result = shouldTriggerAlert(95, 80, 100, existingAlerts);

      expect(result.trigger).toBe(true);
    });

    it('AT-006: should trigger critical even if warning exists', () => {
      // Warning exists at 80%, but now at 100%
      const existingAlerts: BudgetAlert[] = [
        createMockAlert({ alertType: 'threshold_warning', status: 'active' }),
      ];

      const result = shouldTriggerAlert(100, 80, 100, existingAlerts);

      expect(result.trigger).toBe(true);
      expect(result.type).toBe('critical');
    });

    it('AT-007: should use custom thresholds', () => {
      // Custom warning at 70%, current at 72%
      const result = shouldTriggerAlert(72, 70, 90, []);

      expect(result.trigger).toBe(true);
      expect(result.type).toBe('warning');
    });

    it('AT-008: should handle over 100% utilization', () => {
      // Already over budget at 120%
      const result = shouldTriggerAlert(120, 80, 100, []);

      expect(result.trigger).toBe(true);
      expect(result.type).toBe('critical');
    });
  });
});
