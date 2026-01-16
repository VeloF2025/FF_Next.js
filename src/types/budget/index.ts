// WORKING: Budget tracking type definitions
// PRD-057: Project Budget Tracking System

/**
 * Source type for budget creation
 */
export type BudgetSourceType = 'manual' | 'boq' | 'hybrid';

/**
 * Budget approval/activation status
 */
export type BudgetStatus = 'draft' | 'approved' | 'locked' | 'closed';

/**
 * Project budget health indicator
 */
export type BudgetHealth = 'healthy' | 'warning' | 'critical';

/**
 * Transaction types for budget ledger
 */
export type BudgetTransactionType =
  | 'allocation'
  | 'adjustment'
  | 'commitment'
  | 'commitment_reversal'
  | 'receipt'
  | 'invoice'
  | 'payment';

// Alias for API compatibility
export type TransactionType = BudgetTransactionType;

/**
 * Alert types for budget notifications
 */
export type BudgetAlertType =
  | 'threshold_warning'
  | 'threshold_critical'
  | 'over_budget'
  | 'po_blocked'
  | 'override_approved';

// Alias for API compatibility
export type AlertType = BudgetAlertType;

/**
 * Alert severity levels
 */
export type AlertSeverity = 'info' | 'warning' | 'critical';

/**
 * Alert status
 */
export type AlertStatus = 'active' | 'acknowledged' | 'resolved';

/**
 * Project budget master record
 */
export interface ProjectBudget {
  id: string;
  projectId: string;
  sourceType: BudgetSourceType;
  boqId?: string;

  totalBudget: number;
  currency: string;

  committedAmount: number;
  actualAmount: number;

  // Calculated fields (GENERATED in DB)
  availableBudget: number;
  varianceAmount: number;
  variancePercent: number;

  status: BudgetStatus;
  enforceBudget: boolean;
  allowOverride: boolean;

  alertThresholdWarning: number;
  alertThresholdCritical: number;

  approvedBy?: string;
  approvedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Budget category breakdown
 */
export interface BudgetCategory {
  id: string;
  projectBudgetId: string;
  categoryCode: string;
  categoryName: string;

  allocatedAmount: number;
  committedAmount: number;
  actualAmount: number;

  // Calculated field
  availableAmount: number;

  isCustom: boolean;
  sortOrder: number;

  createdAt: string;
  updatedAt: string;
}

/**
 * Budget transaction record (audit trail)
 */
export interface BudgetTransaction {
  id: string;
  projectBudgetId: string;
  categoryId?: string;

  transactionType: BudgetTransactionType;

  sourceType?: string;
  sourceId?: string;
  sourceNumber?: string;

  amount: number;
  taxAmount: number;

  runningCommitted?: number;
  runningActual?: number;

  description?: string;
  createdBy: string;
  createdAt: string;
}

/**
 * Budget alert notification
 */
export interface BudgetAlert {
  id: string;
  projectBudgetId: string;

  alertType: BudgetAlertType;
  severity: AlertSeverity;

  thresholdPercent?: number;
  currentPercent?: number;

  title: string;
  message?: string;

  status: AlertStatus;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  amountInvolved?: number;

  createdAt: string;
}

/**
 * Result of budget availability check
 */
export interface BudgetCheckResult {
  allowed: boolean;
  reason?: 'ok' | 'over_budget' | 'category_over_budget' | 'no_budget';
  available: number;
  requested: number;
  shortfall?: number;
  allowOverride: boolean;
  utilizationAfter: number;
  utilizationBefore: number;
  warning: boolean;
}

/**
 * Input for budget check function
 */
export interface BudgetCheckInput {
  projectId: string;
  amount: number;
  categoryId?: string;
}

/**
 * Alert trigger result
 */
export interface AlertTriggerResult {
  trigger: boolean;
  type?: 'warning' | 'critical';
  reason?: 'alert_exists' | 'below_threshold';
}

/**
 * Category allocation validation result
 */
export interface CategoryAllocationResult {
  valid: boolean;
  totalAllocated: number;
  totalBudget: number;
  difference: number;
  over: boolean;
}

/**
 * Default budget category codes
 */
export const DEFAULT_CATEGORY_CODES = [
  'MATERIALS',
  'EQUIPMENT',
  'LABOR',
  'SUBCONTRACT',
  'TRANSPORT',
  'OVERHEAD',
  'CONTINGENCY',
] as const;

export type DefaultCategoryCode = typeof DEFAULT_CATEGORY_CODES[number];

/**
 * Default category definitions
 */
export interface DefaultCategory {
  code: DefaultCategoryCode;
  name: string;
  sortOrder: number;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { code: 'MATERIALS', name: 'Materials & Consumables', sortOrder: 1 },
  { code: 'EQUIPMENT', name: 'Equipment & Tools', sortOrder: 2 },
  { code: 'LABOR', name: 'Labor Costs', sortOrder: 3 },
  { code: 'SUBCONTRACT', name: 'Subcontractor Work', sortOrder: 4 },
  { code: 'TRANSPORT', name: 'Transport & Logistics', sortOrder: 5 },
  { code: 'OVERHEAD', name: 'Overhead & Admin', sortOrder: 6 },
  { code: 'CONTINGENCY', name: 'Contingency Reserve', sortOrder: 7 },
];
