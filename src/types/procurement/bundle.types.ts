/**
 * Stock Bundle Types
 * Bundles/Kits for grouping stock items together
 */

export interface StockBundle {
  id: string;
  bundle_code: string;
  name: string;
  description?: string;

  // Classification
  category_id?: string;
  bundle_type: 'kit' | 'combo' | 'assembly';

  // Pricing
  price_type: 'calculated' | 'fixed' | 'markup';
  fixed_price?: number;
  markup_percentage?: number;
  currency: string;

  // Usage
  usage_count: number;

  // Flags
  is_active: boolean;
  is_default: boolean;
  allow_substitution: boolean;

  // Metadata
  notes?: string;
  tags?: string[];

  // Timestamps
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;

  // Computed (from view)
  category_name?: string;
  category_code?: string;
  item_count?: number;
  total_quantity?: number;
  calculated_price?: number;
  effective_price?: number;
}

export interface StockBundleItem {
  id: string;
  bundle_id: string;
  stock_item_id: string;

  // Quantity
  quantity: number;
  uom?: string;

  // Pricing
  price_override?: number;
  discount_percentage?: number;

  // Configuration
  is_optional: boolean;
  is_configurable: boolean;
  min_quantity?: number;
  max_quantity?: number;

  // Substitution
  substitute_group?: string;

  // Display
  sort_order: number;
  notes?: string;

  // Timestamps
  created_at: string;
  updated_at: string;

  // Computed (from view)
  bundle_code?: string;
  bundle_name?: string;
  item_code?: string;
  item_name?: string;
  item_description?: string;
  item_category?: string;
  tracking_type?: string;
  effective_uom?: string;
  item_cost?: number;
  effective_cost?: number;
  line_total?: number;
  item_category_name?: string;
  item_category_icon?: string;
  item_category_color?: string;
}

export interface StockBundleFormData {
  bundle_code: string;
  name: string;
  description?: string;
  category_id?: string;
  bundle_type?: 'kit' | 'combo' | 'assembly';
  price_type?: 'calculated' | 'fixed' | 'markup';
  fixed_price?: number;
  markup_percentage?: number;
  is_active?: boolean;
  is_default?: boolean;
  allow_substitution?: boolean;
  notes?: string;
  tags?: string[];
}

export interface StockBundleItemFormData {
  stock_item_id: string;
  quantity: number;
  uom?: string;
  price_override?: number;
  discount_percentage?: number;
  is_optional?: boolean;
  is_configurable?: boolean;
  min_quantity?: number;
  max_quantity?: number;
  substitute_group?: string;
  sort_order?: number;
  notes?: string;
}

export interface StockBundleFilters {
  search?: string;
  category_id?: string;
  bundle_type?: string;
  is_active?: boolean;
}

// Bundle types for dropdown
export const BUNDLE_TYPES = [
  { value: 'kit', label: 'Kit', description: 'Collection of items for a specific task' },
  { value: 'combo', label: 'Combo', description: 'Items frequently sold together' },
  { value: 'assembly', label: 'Assembly', description: 'Items that form a single unit' },
] as const;

// Price types for dropdown
export const PRICE_TYPES = [
  { value: 'calculated', label: 'Calculated', description: 'Sum of all item prices' },
  { value: 'fixed', label: 'Fixed Price', description: 'Set bundle price regardless of items' },
  { value: 'markup', label: 'Markup', description: 'Calculated price plus markup percentage' },
] as const;
