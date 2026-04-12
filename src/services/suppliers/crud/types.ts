/**
 * Supplier CRUD Types
 * Shared types for supplier CRUD operations
 */

export interface SupplierFilter {
  status?: string;
  category?: string;
  isPreferred?: boolean;
  limit?: number;
}

export interface SupplierUpdateData {
  updatedAt: Date | string;
  lastModifiedBy: string;
  [key: string]: Date | string | number | boolean | null | undefined;
}

export interface SupplierSoftDeleteData {
  status: string;
  isActive: boolean;
  updatedAt: Date | string;
  lastModifiedBy: string;
  inactiveReason?: string;
  inactivatedAt?: Date | string;
}

export interface SupplierBatchOptions {
  batchSize?: number;
  maxConcurrent?: number;
}
