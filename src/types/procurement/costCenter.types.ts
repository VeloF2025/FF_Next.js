/**
 * Cost Center Types for hierarchical cost allocation
 *
 * Hierarchy: Project → Phase → Zone → Pole/Drop
 */

// ============================================================
// COST CENTER TYPE (Hierarchy Level Definition)
// ============================================================

export interface CostCenterType {
  id: string;
  code: string;
  name: string;
  description?: string;
  hierarchy_level: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export const COST_CENTER_TYPE_CODES = {
  PROJECT: 'project',
  PHASE: 'phase',
  ZONE: 'zone',
  PON: 'pon',
  POLE: 'pole',
  DROP: 'drop',
  DEPARTMENT: 'department',
  TEAM: 'team',
} as const;

export type CostCenterTypeCode = (typeof COST_CENTER_TYPE_CODES)[keyof typeof COST_CENTER_TYPE_CODES];

// ============================================================
// COST CENTER
// ============================================================

export interface CostCenter {
  id: string;
  code: string;
  name: string;
  description?: string;

  // Hierarchy
  parent_id?: string | null;
  cost_center_type_id?: string;
  hierarchy_path?: string;
  depth: number;

  // Project linkage
  project_id?: string;

  // Budget allocation
  allocated_budget: number;
  committed_amount: number;
  actual_amount: number;
  available_amount: number;

  // Status
  is_active: boolean;
  is_locked: boolean;

  // Reference to external entities
  reference_type?: string;
  reference_id?: string;

  // Metadata
  sort_order: number;
  metadata?: Record<string, unknown>;

  // Audit
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface CostCenterSummary extends CostCenter {
  // Parent info
  parent_code?: string;
  parent_name?: string;

  // Type info
  type_code?: string;
  type_name?: string;
  hierarchy_level?: number;

  // Project info
  project_code?: string;
  project_name?: string;

  // Calculated
  utilization_percent: number;
  commitment_percent: number;

  // Counts
  child_count: number;
  transaction_count: number;
}

export interface CostCenterTree extends CostCenter {
  level: number;
  sort_path: number[];
  full_path: string;
  children?: CostCenterTree[];
}

// ============================================================
// COST CENTER ALLOCATION
// ============================================================

export type AllocationTypeValue = 'budget' | 'commitment' | 'actual';

export const ALLOCATION_TYPES: { value: AllocationTypeValue; label: string }[] = [
  { value: 'budget', label: 'Budget' },
  { value: 'commitment', label: 'Commitment' },
  { value: 'actual', label: 'Actual' },
];

export interface CostCenterAllocation {
  id: string;
  cost_center_id: string;
  budget_category_id?: string;
  budget_item_id?: string;

  allocation_type: AllocationTypeValue;
  amount: number;
  currency: string;

  reference_type?: string;
  reference_id?: string;
  reference_number?: string;

  description?: string;

  fiscal_year?: number;
  fiscal_period?: number;

  created_by?: string;
  approved_by?: string;
  approved_at?: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// COST CENTER TRANSACTION
// ============================================================

export type TransactionTypeValue = 'expense' | 'revenue' | 'transfer_in' | 'transfer_out';
export type TransactionStatusValue = 'pending' | 'approved' | 'posted' | 'reversed';

export const TRANSACTION_TYPES: { value: TransactionTypeValue; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'transfer_in', label: 'Transfer In' },
  { value: 'transfer_out', label: 'Transfer Out' },
];

export const TRANSACTION_STATUSES: { value: TransactionStatusValue; label: string; color: string }[] = [
  { value: 'pending', label: 'Pending', color: 'yellow' },
  { value: 'approved', label: 'Approved', color: 'blue' },
  { value: 'posted', label: 'Posted', color: 'green' },
  { value: 'reversed', label: 'Reversed', color: 'red' },
];

export interface CostCenterTransaction {
  id: string;
  cost_center_id: string;
  allocation_id?: string;

  transaction_type: TransactionTypeValue;
  transaction_date: string;
  amount: number;
  currency: string;

  reference_type?: string;
  reference_id?: string;
  reference_number?: string;

  description?: string;

  stock_item_id?: string;
  quantity?: number;
  unit_cost?: number;

  status: TransactionStatusValue;

  created_by?: string;
  approved_by?: string;
  approved_at?: string;
  posted_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CostCenterTransactionWithDetails extends CostCenterTransaction {
  cost_center_code?: string;
  cost_center_name?: string;
  stock_item_code?: string;
  stock_item_name?: string;
}

// ============================================================
// ROLL-UP TOTALS
// ============================================================

export interface CostCenterRollupTotals {
  total_allocated: number;
  total_committed: number;
  total_actual: number;
  total_available: number;
}

// ============================================================
// API REQUEST/RESPONSE
// ============================================================

export interface CreateCostCenterRequest {
  code: string;
  name: string;
  description?: string;
  parent_id?: string;
  cost_center_type_id?: string;
  project_id?: string;
  allocated_budget?: number;
  reference_type?: string;
  reference_id?: string;
  sort_order?: number;
  metadata?: Record<string, unknown>;
  created_by?: string;
}

export interface UpdateCostCenterRequest {
  code?: string;
  name?: string;
  description?: string;
  parent_id?: string;
  cost_center_type_id?: string;
  allocated_budget?: number;
  is_active?: boolean;
  is_locked?: boolean;
  sort_order?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateAllocationRequest {
  cost_center_id: string;
  budget_category_id?: string;
  budget_item_id?: string;
  allocation_type: AllocationTypeValue;
  amount: number;
  currency?: string;
  reference_type?: string;
  reference_id?: string;
  reference_number?: string;
  description?: string;
  fiscal_year?: number;
  fiscal_period?: number;
  created_by?: string;
}

export interface CreateTransactionRequest {
  cost_center_id: string;
  allocation_id?: string;
  transaction_type: TransactionTypeValue;
  transaction_date?: string;
  amount: number;
  currency?: string;
  reference_type?: string;
  reference_id?: string;
  reference_number?: string;
  description?: string;
  stock_item_id?: string;
  quantity?: number;
  unit_cost?: number;
  created_by?: string;
}

export interface CostCenterListResponse {
  cost_centers: CostCenterSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface CostCenterTreeResponse {
  tree: CostCenterTree[];
  total: number;
}

// ============================================================
// FILTER OPTIONS
// ============================================================

export interface CostCenterFilters {
  project_id?: string;
  type_code?: string;
  parent_id?: string;
  is_active?: boolean;
  search?: string;
  include_children?: boolean;
}

export interface TransactionFilters {
  cost_center_id?: string;
  transaction_type?: TransactionTypeValue;
  status?: TransactionStatusValue;
  from_date?: string;
  to_date?: string;
  reference_type?: string;
  search?: string;
}
