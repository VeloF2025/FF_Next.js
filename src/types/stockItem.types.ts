/**
 * Stock Item Types
 * Synced from Odoo and extended for FibreFlow
 */

export interface StockItem {
  id: string;
  itemCode: string;
  name: string;
  description: string | null;
  category: string;
  trackingType: 'none' | 'serial' | 'lot' | 'quantity';
  uom: string;
  standardCost: number | null;
  listPrice: number | null;
  currency: string;
  minStockLevel: number;
  maxStockLevel: number | null;
  reorderQuantity: number | null;
  isActive: boolean;
  isReturnable: boolean;
  productType: string;
  purchaseOk: boolean;
  saleOk: boolean;
  qtyAvailable: number;
  qtyReserved: number;
  qtyOnOrder: number;
  odooProductId: number | null;
  odooSyncedAt: Date | null;
  createdBy: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  supplierCodes?: SupplierItemCode[];
}

export interface SupplierItemCode {
  id: string;
  stockItemId: string;
  supplierId: string;
  supplierName: string;
  supplierItemCode: string;
  supplierItemName: string | null;
  supplierPrice: number | null;
  supplierCurrency: string;
  priceValidFrom: string | null;
  priceValidTo: string | null;
  leadTimeDays: number | null;
  minOrderQty: number | null;
  isPreferred: boolean;
  isActive: boolean;
}

export interface StockItemsResponse {
  data: StockItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filters: {
    categories: Array<{ value: string; count: number }>;
  };
}

export interface StockItemFilters {
  search?: string;
  category?: string;
  hasStock?: boolean;
  odooOnly?: boolean;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface CreateStockItemInput {
  itemCode: string;
  name: string;
  description?: string;
  category: string;
  trackingType?: 'none' | 'serial' | 'lot' | 'quantity';
  uom?: string;
  standardCost?: number;
  listPrice?: number;
  currency?: string;
  minStockLevel?: number;
  maxStockLevel?: number;
  reorderQuantity?: number;
  isActive?: boolean;
  isReturnable?: boolean;
  productType?: string;
  purchaseOk?: boolean;
  saleOk?: boolean;
  qtyAvailable?: number;
}

export interface UpdateStockItemInput extends Partial<CreateStockItemInput> {
  id: string;
}

// Category colors for badges
export const CATEGORY_COLORS: Record<string, string> = {
  activations: 'bg-green-500/20 text-green-400',
  backhaul: 'bg-cyan-500/20 text-cyan-400',
  optics: 'bg-purple-500/20 text-purple-400',
  poles: 'bg-yellow-500/20 text-yellow-400',
  stringing: 'bg-orange-500/20 text-orange-400',
  consumable: 'bg-gray-500/20 text-gray-400',
  tools: 'bg-red-500/20 text-red-400',
  fibertime: 'bg-teal-500/20 text-teal-400',
  services: 'bg-indigo-500/20 text-indigo-400',
  uncategorized: 'bg-slate-500/20 text-slate-400',
};

export const TRACKING_TYPE_LABELS: Record<string, string> = {
  none: 'No Tracking',
  serial: 'Serial Number',
  lot: 'Lot/Batch',
  quantity: 'Quantity',
};
