// WORKING: Budget threshold checking functions
// PRD-057: Project Budget Tracking System

import type {
  ProjectBudget,
  BudgetCategory,
  BudgetCheckResult,
  AlertTriggerResult,
  BudgetAlert,
} from '../../src/types/budget';
import { calculateUtilization } from './calculations';

/**
 * Check if a purchase amount is within budget
 * @param budget - Project budget (or null if none exists)
 * @param requestedAmount - Amount being requested
 * @param category - Optional category for category-level check
 * @returns Budget check result
 */
export function checkBudgetAvailability(
  budget: ProjectBudget | null,
  requestedAmount: number,
  category?: BudgetCategory
): BudgetCheckResult {
  // No budget configured - allow but indicate reason
  if (!budget) {
    return {
      allowed: true,
      reason: 'no_budget',
      requested: requestedAmount,
      available: 0,
      allowOverride: false,
      utilizationAfter: 0,
      utilizationBefore: 0,
      warning: false,
    };
  }

  const utilizationBefore = calculateUtilization(
    budget.totalBudget,
    budget.committedAmount
  );

  // Check category-level budget if provided
  if (category) {
    const categoryAvailable = category.availableAmount;
    if (requestedAmount > categoryAvailable) {
      return {
        allowed: false,
        reason: 'category_over_budget',
        requested: requestedAmount,
        available: categoryAvailable,
        shortfall: requestedAmount - categoryAvailable,
        allowOverride: budget.allowOverride,
        utilizationAfter: 0,
        utilizationBefore,
        warning: false,
      };
    }
  }

  // Check project-level budget
  const newCommitted = budget.committedAmount + requestedAmount;
  const utilizationAfter = calculateUtilization(budget.totalBudget, newCommitted);
  const wouldExceed = newCommitted > budget.totalBudget;
  const available = budget.availableBudget;

  // Determine if warning should be shown (exceeding threshold)
  const warning = utilizationAfter > budget.alertThresholdWarning;

  // If would exceed and enforcement is on, block
  if (wouldExceed && budget.enforceBudget) {
    return {
      allowed: false,
      reason: 'over_budget',
      requested: requestedAmount,
      available,
      shortfall: requestedAmount - available,
      allowOverride: budget.allowOverride,
      utilizationAfter,
      utilizationBefore,
      warning: true,
    };
  }

  // If would exceed but enforcement is off, allow with warning
  if (wouldExceed && !budget.enforceBudget) {
    return {
      allowed: true,
      requested: requestedAmount,
      available,
      allowOverride: budget.allowOverride,
      utilizationAfter,
      utilizationBefore,
      warning: true,
    };
  }

  // Within budget
  return {
    allowed: true,
    reason: 'ok',
    requested: requestedAmount,
    available,
    allowOverride: budget.allowOverride,
    utilizationAfter,
    utilizationBefore,
    warning,
  };
}

/**
 * Determine if a budget alert should be triggered
 * @param currentUtilization - Current budget utilization percentage
 * @param warningThreshold - Warning threshold percentage
 * @param criticalThreshold - Critical threshold percentage
 * @param existingAlerts - List of existing alerts for this budget
 * @returns Alert trigger result
 */
export function shouldTriggerAlert(
  currentUtilization: number,
  warningThreshold: number,
  criticalThreshold: number,
  existingAlerts: BudgetAlert[]
): AlertTriggerResult {
  // Check if we're at critical level
  const atCritical = currentUtilization >= criticalThreshold;
  // Check if we're at warning level
  const atWarning = currentUtilization >= warningThreshold;

  // Check for existing active critical alert
  const hasActiveCritical = existingAlerts.some(
    (alert) =>
      alert.alertType === 'threshold_critical' && alert.status === 'active'
  );

  // Check for existing active warning alert
  const hasActiveWarning = existingAlerts.some(
    (alert) =>
      alert.alertType === 'threshold_warning' && alert.status === 'active'
  );

  // If at critical level
  if (atCritical) {
    // Only skip if active critical alert already exists
    if (hasActiveCritical) {
      return {
        trigger: false,
        reason: 'alert_exists',
      };
    }
    return {
      trigger: true,
      type: 'critical',
    };
  }

  // If at warning level
  if (atWarning) {
    // Only skip if active warning alert already exists
    if (hasActiveWarning) {
      return {
        trigger: false,
        reason: 'alert_exists',
      };
    }
    return {
      trigger: true,
      type: 'warning',
    };
  }

  // Below threshold
  return {
    trigger: false,
    reason: 'below_threshold',
  };
}
