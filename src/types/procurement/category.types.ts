/**
 * Stock Category Types
 * Dynamic hierarchical categories for stock items
 */

export interface StockCategory {
  id: string;
  code: string;
  name: string;
  description?: string;

  // Hierarchy
  parent_id?: string;
  level: number;
  path: string;

  // Display
  icon?: string;
  color?: string;
  sort_order: number;

  // Defaults
  default_tracking_type: 'serial' | 'lot' | 'quantity';
  default_uom: string;

  // Flags
  is_active: boolean;
  is_system: boolean;

  // Timestamps
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;

  // Computed (from view)
  item_count?: number;
  parent_name?: string;
  parent_code?: string;
}

export interface StockCategoryFormData {
  code: string;
  name: string;
  description?: string;
  parent_id?: string;
  icon?: string;
  color?: string;
  sort_order?: number;
  default_tracking_type?: 'serial' | 'lot' | 'quantity';
  default_uom?: string;
  is_active?: boolean;
}

export interface StockCategoryFilters {
  search?: string;
  parent_id?: string;
  is_active?: boolean;
  level?: number;
}

export interface StockCategoryTreeNode extends StockCategory {
  children: StockCategoryTreeNode[];
}

// Available Lucide icons for categories
export const CATEGORY_ICONS = [
  'Router',
  'Wifi',
  'Battery',
  'Cable',
  'Plug',
  'Package',
  'Wrench',
  'HardHat',
  'Box',
  'Boxes',
  'Server',
  'Cpu',
  'Monitor',
  'Smartphone',
  'Zap',
  'Settings',
  'Tool',
  'Cog',
] as const;

// Available colors for categories
export const CATEGORY_COLORS = [
  { value: 'blue', label: 'Blue', class: 'bg-blue-500/20 text-blue-400' },
  { value: 'green', label: 'Green', class: 'bg-green-500/20 text-green-400' },
  { value: 'yellow', label: 'Yellow', class: 'bg-yellow-500/20 text-yellow-400' },
  { value: 'red', label: 'Red', class: 'bg-red-500/20 text-red-400' },
  { value: 'purple', label: 'Purple', class: 'bg-purple-500/20 text-purple-400' },
  { value: 'indigo', label: 'Indigo', class: 'bg-indigo-500/20 text-indigo-400' },
  { value: 'orange', label: 'Orange', class: 'bg-orange-500/20 text-orange-400' },
  { value: 'emerald', label: 'Emerald', class: 'bg-emerald-500/20 text-emerald-400' },
  { value: 'gray', label: 'Gray', class: 'bg-gray-500/20 text-gray-400' },
  { value: 'cyan', label: 'Cyan', class: 'bg-cyan-500/20 text-cyan-400' },
] as const;

// Tracking types
export const TRACKING_TYPES = [
  { value: 'serial', label: 'Serial Number', description: 'Track individual items by serial number' },
  { value: 'lot', label: 'Lot/Batch', description: 'Track groups of items by lot number' },
  { value: 'quantity', label: 'Quantity Only', description: 'Track by quantity without identification' },
] as const;

// Common units of measure
export const UNITS_OF_MEASURE = [
  { value: 'EA', label: 'Each' },
  { value: 'M', label: 'Meter' },
  { value: 'KM', label: 'Kilometer' },
  { value: 'KG', label: 'Kilogram' },
  { value: 'L', label: 'Liter' },
  { value: 'BOX', label: 'Box' },
  { value: 'ROLL', label: 'Roll' },
  { value: 'SET', label: 'Set' },
  { value: 'PAIR', label: 'Pair' },
  { value: 'PK', label: 'Pack' },
] as const;
