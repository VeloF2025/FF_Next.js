/**
 * Form data types for supplier management
 */

import { 
  SupplierStatus, 
  BusinessType, 
  PaymentTerms,
  Currency,
  EmployeeSize,
  RevenueRange
} from './base.types';
import { ProductCategory } from './product.types';

export interface SupplierFormInput {
  name: string;
  tradingName?: string;
  registrationNumber?: string;
  taxNumber?: string;
  status: SupplierStatus;
  businessType: BusinessType;
  categories: ProductCategory[];
  email: string;
  phone: string;
  website?: string;
  preferredPaymentTerms?: PaymentTerms;
  currency?: Currency;
  creditLimit?: number;
  leadTime?: number;
  minimumOrderValue?: number;
  employeeSize?: EmployeeSize;
  annualRevenue?: RevenueRange;
  notes?: string;
  tags?: string[];
}

export interface SupplierQuickAdd {
  name: string;
  email: string;
  phone: string;
  businessType: BusinessType;
  categories: ProductCategory[];
}

export interface SupplierImportData {
  suppliers: Partial<SupplierFormInput>[];
  mapping?: {
    [key: string]: string; // CSV column to field mapping
  };
  options?: {
    skipDuplicates?: boolean;
    updateExisting?: boolean;
    validateData?: boolean;
  };
}

export interface SupplierSearchFilters {
  query?: string;
  status?: SupplierStatus[];
  businessType?: BusinessType[];
  categories?: ProductCategory[];
  rating?: {
    min?: number;
    max?: number;
  };
  isVerified?: boolean;
  isPreferred?: boolean;
  hasContract?: boolean;
  tags?: string[];
  sortBy?: 'name' | 'rating' | 'created' | 'updated';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface SupplierBulkAction {
  action: 'activate' | 'deactivate' | 'delete' | 'tag' | 'export';
  supplierIds: string[];
  data?: Record<string, unknown>; // Additional data for specific actions
}