/**
 * Stock Take / Physical Inventory Types
 * For periodic stock counting with variance tracking
 */

export interface StockTake {
  id: string;
  reference_number: string;
  name: string;
  description?: string;

  // Scope
  location_id?: string;
  warehouse_id?: string;
  category_id?: string;
  project_id?: string;

  // Type
  stock_take_type: 'full' | 'partial' | 'cycle' | 'spot';
  count_method: 'blind' | 'guided';

  // Schedule
  scheduled_date?: string;
  start_date?: string;
  end_date?: string;

  // Status
  status: 'draft' | 'in_progress' | 'pending_review' | 'approved' | 'cancelled';

  // Approval
  approved_by?: string;
  approved_at?: string;
  approval_notes?: string;

  // Summary
  total_items: number;
  counted_items: number;
  variance_items: number;
  total_variance_value: number;

  // Metadata
  notes?: string;
  tags?: string[];

  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;

  // Computed (from view)
  location_name?: string;
  location_code?: string;
  warehouse_name?: string;
  warehouse_code?: string;
  category_name?: string;
  project_name?: string;
  line_count?: number;
  counted_count?: number;
  variance_count?: number;
  total_variance_qty?: number;
  calc_variance_value?: number;
  completion_percentage?: number;
}

export interface StockTakeLine {
  id: string;
  stock_take_id: string;
  stock_item_id: string;

  // Location
  location_id?: string;
  warehouse_id?: string;
  bin_location?: string;

  // Expected
  expected_quantity: number;
  expected_value: number;

  // Counted
  counted_quantity?: number;
  counted_at?: string;
  counted_by?: string;
  counted_by_name?: string;

  // Recount
  recount_quantity?: number;
  recounted_at?: string;
  recounted_by?: string;
  recounted_by_name?: string;

  // Variance
  variance_quantity: number;
  variance_value: number;
  variance_percentage?: number;

  // Status
  status: 'pending' | 'counted' | 'recounted' | 'verified' | 'adjusted';

  // Adjustment
  adjustment_reason?: string;
  adjustment_notes?: string;
  adjusted_at?: string;
  adjusted_by?: string;

  // Serial/Lot
  serial_numbers?: string[];
  lot_numbers?: string[];

  created_at: string;
  updated_at: string;

  // Computed (from view)
  item_code?: string;
  item_name?: string;
  item_category?: string;
  tracking_type?: string;
  uom?: string;
  standard_cost?: number;
  category_name?: string;
  category_icon?: string;
  category_color?: string;
  location_name?: string;
  location_code?: string;
  warehouse_name?: string;
  stock_take_reference?: string;
  stock_take_name?: string;
  stock_take_status?: string;
}

export interface StockTakeFormData {
  name: string;
  description?: string;
  location_id?: string;
  warehouse_id?: string;
  category_id?: string;
  project_id?: string;
  stock_take_type?: 'full' | 'partial' | 'cycle' | 'spot';
  count_method?: 'blind' | 'guided';
  scheduled_date?: string;
  notes?: string;
  tags?: string[];
}

export interface StockTakeLineCountData {
  counted_quantity: number;
  counted_by_name?: string;
  serial_numbers?: string[];
  lot_numbers?: string[];
  notes?: string;
}

export interface StockTakeAdjustment {
  id: string;
  stock_take_id: string;
  stock_take_line_id: string;
  stock_item_id: string;
  adjustment_type: 'increase' | 'decrease' | 'write_off';
  quantity_before: number;
  quantity_after: number;
  adjustment_quantity: number;
  unit_cost?: number;
  adjustment_value?: number;
  reason_code?: string;
  reason_description?: string;
  approved_by?: string;
  approved_at?: string;
  created_at: string;
  created_by?: string;
  created_by_name?: string;
}

export interface AdjustmentReason {
  id: string;
  code: string;
  name: string;
  description?: string;
  adjustment_type?: 'increase' | 'decrease' | 'both';
  is_active: boolean;
  sort_order: number;
}

export interface StockTakeFilters {
  search?: string;
  status?: string;
  location_id?: string;
  warehouse_id?: string;
  category_id?: string;
  project_id?: string;
  stock_take_type?: string;
  date_from?: string;
  date_to?: string;
}

// Stock Take Types
export const STOCK_TAKE_TYPES = [
  { value: 'full', label: 'Full Count', description: 'Count all items in scope' },
  { value: 'partial', label: 'Partial Count', description: 'Count selected items/categories' },
  { value: 'cycle', label: 'Cycle Count', description: 'Scheduled periodic counting' },
  { value: 'spot', label: 'Spot Check', description: 'Random verification' },
] as const;

// Count Methods
export const COUNT_METHODS = [
  { value: 'blind', label: 'Blind Count', description: 'Expected quantities hidden during count' },
  { value: 'guided', label: 'Guided Count', description: 'Expected quantities shown to counter' },
] as const;

// Stock Take Statuses
export const STOCK_TAKE_STATUSES = [
  { value: 'draft', label: 'Draft', color: 'gray' },
  { value: 'in_progress', label: 'In Progress', color: 'blue' },
  { value: 'pending_review', label: 'Pending Review', color: 'yellow' },
  { value: 'approved', label: 'Approved', color: 'green' },
  { value: 'cancelled', label: 'Cancelled', color: 'red' },
] as const;

// Line Statuses
export const LINE_STATUSES = [
  { value: 'pending', label: 'Pending', color: 'gray' },
  { value: 'counted', label: 'Counted', color: 'blue' },
  { value: 'recounted', label: 'Recounted', color: 'purple' },
  { value: 'verified', label: 'Verified', color: 'green' },
  { value: 'adjusted', label: 'Adjusted', color: 'orange' },
] as const;
