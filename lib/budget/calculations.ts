// WORKING: Budget calculation functions
// PRD-057: Project Budget Tracking System

/**
 * Calculate available budget
 * @param totalBudget - Total budget amount
 * @param committedAmount - Amount already committed
 * @returns Available budget (cannot be negative)
 */
export function calculateAvailableBudget(
  totalBudget: number,
  committedAmount: number
): number {
  // Handle negative committed (treat as 0)
  const safeCommitted = Math.max(0, committedAmount);
  // Available = total - committed, but never negative
  return Math.max(0, totalBudget - safeCommitted);
}

/**
 * Calculate variance percentage (under/over budget)
 * Positive = under budget, Negative = over budget
 * @param totalBudget - Total budget amount
 * @param actualAmount - Actual spent amount
 * @returns Variance as percentage (rounded to 2 decimal places)
 */
export function calculateVariancePercent(
  totalBudget: number,
  actualAmount: number
): number {
  // Avoid division by zero
  if (totalBudget === 0) {
    return 0;
  }
  // Variance = (total - actual) / total * 100
  const variance = ((totalBudget - actualAmount) / totalBudget) * 100;
  // Round to 2 decimal places
  return Math.round(variance * 100) / 100;
}

/**
 * Calculate budget utilization percentage
 * @param totalBudget - Total budget amount
 * @param committedAmount - Amount already committed
 * @returns Utilization as percentage (rounded to 2 decimal places)
 */
export function calculateUtilization(
  totalBudget: number,
  committedAmount: number
): number {
  // Avoid division by zero
  if (totalBudget === 0) {
    return 0;
  }
  // Utilization = committed / total * 100
  const utilization = (committedAmount / totalBudget) * 100;
  // Round to 2 decimal places
  return Math.round(utilization * 100) / 100;
}
