/**
 * Product Service - Legacy Compatibility Layer
 * 
 * @deprecated This file has been split into modular components for better maintainability.
 * 
 * New modular structure:
 * - types.ts: Type definitions and interfaces
 * - crud.ts: Core CRUD operations for products
 * - status.ts: Product availability and status management
 * - search.ts: Search, filtering, and query operations
 * - pricing.ts: Price lists and pricing management
 * - subscriptions.ts: Real-time data subscriptions
 * - productService.ts: Main service orchestrator
 * 
 * For new code, import from the modular structure:
 * ```typescript
 * import { ProductService, ProductCrudService, ProductSearchService } from '@/services/products';
 * // or
 * import ProductServices from '@/services/products';
 * ```
 * 
 * This legacy layer maintains backward compatibility while the codebase transitions.
 */

import { ProductService } from '../products/productService';
import { ProductAvailability, ProductCategory, PriceListItem, ProductFormData, ProductCallback } from '../products/types';

// Create a service instance
const service = new ProductService();

/**
 * @deprecated Use the new modular ProductService from '@/services/products' instead
 * 
 * Legacy product service object that delegates to the new modular architecture
 */
export const productService = {
  /**
   * @deprecated Use ProductCrudService.getAllProducts() instead
   */
  async getAllProducts(filter?: { 
    supplierId?: string; 
    category?: ProductCategory; 
    availability?: ProductAvailability 
  }) {
    return service.getAllProducts(filter);
  },

  /**
   * @deprecated Use ProductCrudService.getProductById() instead
   */
  async getProductById(id: string) {
    return service.getProductById(id);
  },

  /**
   * @deprecated Use ProductCrudService.createProduct() instead
   */
  async createProduct(data: ProductFormData) {
    return service.createProduct(data);
  },

  /**
   * @deprecated Use ProductCrudService.updateProduct() instead
   */
  async updateProduct(id: string, data: Partial<ProductFormData>) {
    return service.updateProduct(id, data);
  },

  /**
   * @deprecated Use ProductCrudService.deleteProduct() instead
   */
  async deleteProduct(id: string) {
    return service.deleteProduct(id);
  },

  /**
   * @deprecated Use ProductStatusService.updateAvailability() instead
   */
  async updateAvailability(id: string, availability: ProductAvailability) {
    return service.updateAvailability(id, availability);
  },

  /**
   * @deprecated Use ProductStatusService.discontinueProduct() instead
   */
  async discontinueProduct(id: string, replacementId?: string) {
    return service.discontinueProduct(id, replacementId);
  },

  /**
   * @deprecated Use ProductSearchService.searchProducts() instead
   */
  async searchProducts(searchTerm: string) {
    return service.searchProducts(searchTerm);
  },

  /**
   * @deprecated Use ProductSearchService.getProductsBySupplier() instead
   */
  async getProductsBySupplier(supplierId: string) {
    return service.getProductsBySupplier(supplierId);
  },

  /**
   * @deprecated Use ProductSearchService.getAvailableProducts() instead
   */
  async getAvailableProducts() {
    return service.getAvailableProducts();
  },

  /**
   * @deprecated Use ProductPricingService.createPriceList() instead
   */
  async createPriceList(supplierId: string, data: {
    name: string;
    description?: string;
    items: PriceListItem[];
    effectiveFrom: Date;
    effectiveTo?: Date;
  }) {
    return service.createPriceList(supplierId, data);
  },

  /**
   * @deprecated Use ProductPricingService.getPriceLists() instead
   */
  async getPriceLists(supplierId: string) {
    return service.getPriceLists(supplierId);
  },

  /**
   * @deprecated Use ProductPricingService.getActivePriceList() instead
   */
  async getActivePriceList(supplierId: string) {
    return service.getActivePriceList(supplierId);
  },

  /**
   * @deprecated Use ProductPricingService.updatePriceList() instead
   */
  async updatePriceList(id: string, items: PriceListItem[]) {
    return service.updatePriceList(id, items);
  },

  /**
   * @deprecated Use ProductPricingService.bulkUpdatePrices() instead
   */
  async bulkUpdatePrices(supplierId: string, priceAdjustment: {
    type: 'percentage' | 'fixed';
    value: number;
    category?: ProductCategory;
  }) {
    return service.bulkUpdatePrices(supplierId, priceAdjustment);
  },

  /**
   * @deprecated Use ProductSubscriptionService.subscribeToProducts() instead
   */
  subscribeToProducts(supplierId: string, callback: ProductCallback) {
    return service.subscribeToProducts(supplierId, callback);
  }
};