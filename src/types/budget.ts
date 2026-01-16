/**
 * Budget Tracking Types
 * PRD-057: Project Budget Tracking System
 *
 * Types for comprehensive project budget tracking, enforcement, and reporting
 */

// ============================================================================
// Enums and Type Aliases
// ============================================================================

export type BudgetSourceType = 'manual' | 'boq' | 'hybrid';
export type BudgetStatus = 'draft' | 'approved' | 'locked' | 'closed';
export type BudgetHealth = 'healthy' | 'warning' | 'critical';

export type TransactionType =
  | 'allocation'
  | 'adjustment'
  | 'commitment'
  | 'commitment_reversal'
  | 'receipt'
  | 'invoice'
  | 'payment';

export type AlertType =
  | 'threshold_warning'
  | 'threshold_critical'
  | 'over_budget'
  | 'po_blocked'
  | 'override_approved';

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved';

export type AdjustmentType = 'increase' | 'decrease' | 'reallocation';

// ============================================================================
// Core Budget Entities
// ============================================================================

/**
 * Project Budget - Master budget record for a project
 */
export interface ProjectBudget {
  id: string;
  projectId: string;
  sourceType: BudgetSourceType;
  boqId?: string;

  // Amounts
  totalBudget: number;
  committedAmount: number;
  actualAmount: number;
  availableBudget: number;

  // Variance
  varianceAmount: number;
  variancePercent: number;

  // Settings
  status: BudgetStatus;
  enforceBudget: boolean;
  allowOverride: boolean;
  alertThresholdWarning: number;
  alertThresholdCritical: number;

  // Currency
  currency: string;

  // Approval
  approvedBy?: string;
  approvedAt?: string;

  // Audit
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Budget Category - Category breakdown within a budget
 */
export interface BudgetCategory {
  id: string;
  projectBudgetId: string;
  categoryCode: string;
  categoryName: string;

  // Amounts
  allocatedAmount: number;
  committedAmount: number;
  actualAmount: number;
  availableAmount: number;

  // Flags
  isCustom: boolean;

  // Display order
  sortOrder?: number;

  // Audit
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Budget Transaction - Financial ledger entry for audit trail
 */
export interface BudgetTransaction {
  id: string;
  projectBudgetId: string;
  categoryId?: string;

  // Transaction details
  transactionType: TransactionType;
  sourceType?: string;
  sourceId?: string;
  sourceNumber?: string;

  // Amounts
  amount: number;
  taxAmount?: number;

  // Description
  description?: string;

  // Audit
  createdBy: string;
  createdAt: string;
}

/**
 * Budget Alert - Threshold notification
 */
export interface BudgetAlert {
  id: string;
  projectBudgetId: string;
  alertType: AlertType;
  severity: AlertSeverity;

  // Threshold details
  thresholdPercent?: number;
  currentPercent?: number;
  amountInvolved?: number;

  // Display
  title: string;
  message?: string;

  // Status
  status: AlertStatus;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  resolvedBy?: string;
  resolvedAt?: string;

  // Audit
  createdAt: string;
}

/**
 * Budget Adjustment - Manual adjustment history for audit
 */
export interface BudgetAdjustment {
  id: string;
  projectBudgetId: string;
  adjustmentType: AdjustmentType;

  // Amounts
  previousAmount: number;
  newAmount: number;
  difference: number;

  // Required reason
  reason: string;

  // Approval
  approvedBy?: string;

  // Audit
  createdBy: string;
  createdAt: string;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Result from budget availability check
 */
export interface BudgetCheckResult {
  allowed: boolean;
  reason?: 'ok' | 'over_budget' | 'category_over_budget' | 'no_budget';
  available: number;
  requested: number;
  shortfall?: number;
  allowOverride: boolean;
  utilizationBefore: number;
  utilizationAfter: number;
  warning: boolean;
  warningMessage?: string;
}

/**
 * Result from category allocation validation
 */
export interface CategoryAllocationResult {
  valid: boolean;
  totalAllocated: number;
  totalBudget: number;
  difference: number;
  over: boolean;
}

/**
 * Result from alert trigger check
 */
export interface AlertTriggerResult {
  trigger: boolean;
  type?: 'warning' | 'critical';
  reason?: 'alert_exists' | 'below_threshold';
}

/**
 * Request to create a new budget
 */
export interface CreateBudgetRequest {
  sourceType: BudgetSourceType;
  totalBudget?: number;
  boqId?: string;
  enforceBudget?: boolean;
  allowOverride?: boolean;
  alertThresholdWarning?: number;
  alertThresholdCritical?: number;
}

/**
 * Request to adjust a budget
 */
export interface AdjustBudgetRequest {
  adjustmentType: AdjustmentType;
  amount: number;
  reason: string;
}

/**
 * Request to check budget availability
 */
export interface CheckBudgetRequest {
  projectId: string;
  amount: number;
  categoryId?: string;
}

/**
 * Budget summary for dashboard widget
 */
export interface BudgetSummary {
  projectId: string;
  totalBudget: number;
  committedAmount: number;
  actualAmount: number;
  availableBudget: number;
  utilizationPercent: number;
  health: BudgetHealth;
  status: BudgetStatus;
  activeAlerts: number;
}

// ============================================================================
// Default Budget Categories (seeded)
// ============================================================================

export const DEFAULT_BUDGET_CATEGORIES = [
  { code: 'MATERIALS', name: 'Materials & Consumables', sortOrder: 1 },
  { code: 'EQUIPMENT', name: 'Equipment & Tools', sortOrder: 2 },
  { code: 'LABOR', name: 'Labor Costs', sortOrder: 3 },
  { code: 'SUBCONTRACT', name: 'Subcontractor Work', sortOrder: 4 },
  { code: 'TRANSPORT', name: 'Transport & Logistics', sortOrder: 5 },
  { code: 'OVERHEAD', name: 'Overhead & Admin', sortOrder: 6 },
  { code: 'CONTINGENCY', name: 'Contingency Reserve', sortOrder: 7 },
] as const;

// Alias for backward compatibility
export const DEFAULT_CATEGORIES = DEFAULT_BUDGET_CATEGORIES;

export type DefaultCategoryCode = (typeof DEFAULT_BUDGET_CATEGORIES)[number]['code'];
