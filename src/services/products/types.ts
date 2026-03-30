/**
 * Product Service Types
 * Type definitions for product operations and data structures
 */

import { 
  Product, 
  ProductFormData, 
  ProductAvailability,
  ProductCategory,
  PriceList,
  PriceListItem
} from '@/types/supplier.types';

export type {
  Product,
  ProductFormData,
  ProductCategory,
  PriceList,
  PriceListItem
};

export {
  ProductAvailability
};

export interface ProductFilter {
  supplierId?: string;
  category?: ProductCategory;
  availability?: ProductAvailability;
}

export interface PriceAdjustment {
  type: 'percentage' | 'fixed';
  value: number;
  category?: ProductCategory;
}

export interface CreatePriceListData {
  name: string;
  description?: string;
  items: PriceListItem[];
  effectiveFrom: Date;
  effectiveTo?: Date;
}

export type ProductCallback = (products: Product[]) => void;