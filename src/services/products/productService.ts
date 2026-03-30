/**
 * Product Service - Main Orchestrator
 * Combines all product services into a unified interface
 */

import { ProductCrudService } from './crud';
import { ProductStatusService } from './status';
import { ProductSearchService } from './search';
import { ProductPricingService } from './pricing';
import { ProductSubscriptionService } from './subscriptions';
import { 
  Product, 
  ProductFormData, 
  ProductFilter, 
  ProductAvailability,
  CreatePriceListData,
  PriceAdjustment,
  PriceListItem,
  ProductCallback
} from './types';

/**
 * Main Product Service class
 * Provides a unified interface for all product operations
 */
export class ProductService {
  // ============= CRUD Operations =============
  
  async getAllProducts(filter?: ProductFilter): Promise<Product[]> {
    return ProductCrudService.getAllProducts(filter);
  }

  async getProductById(id: string): Promise<Product> {
    return ProductCrudService.getProductById(id);
  }

  async createProduct(data: ProductFormData): Promise<string> {
    return ProductCrudService.createProduct(data);
  }

  async updateProduct(id: string, data: Partial<ProductFormData>): Promise<void> {
    return ProductCrudService.updateProduct(id, data);
  }

  async deleteProduct(id: string): Promise<void> {
    return ProductCrudService.deleteProduct(id);
  }

  // ============= Status Management =============
  
  async updateAvailability(id: string, availability: ProductAvailability): Promise<void> {
    return ProductStatusService.updateAvailability(id, availability);
  }

  async discontinueProduct(id: string, replacementId?: string): Promise<void> {
    return ProductStatusService.discontinueProduct(id, replacementId);
  }

  async activateProduct(id: string): Promise<void> {
    return ProductStatusService.activateProduct(id);
  }

  async deactivateProduct(id: string): Promise<void> {
    return ProductStatusService.deactivateProduct(id);
  }

  // ============= Search & Filter =============
  
  async searchProducts(searchTerm: string): Promise<Product[]> {
    return ProductSearchService.searchProducts(searchTerm);
  }

  async getProductsBySupplier(supplierId: string): Promise<Product[]> {
    return ProductSearchService.getProductsBySupplier(supplierId);
  }

  async getAvailableProducts(): Promise<Product[]> {
    return ProductSearchService.getAvailableProducts();
  }

  async getProductsByCategory(category: string): Promise<Product[]> {
    return ProductSearchService.getProductsByCategory(category);
  }

  async getLowStockProducts(): Promise<Product[]> {
    return ProductSearchService.getLowStockProducts();
  }

  // ============= Pricing Operations =============
  
  async createPriceList(supplierId: string, data: CreatePriceListData): Promise<string> {
    return ProductPricingService.createPriceList(supplierId, data);
  }

  async getPriceLists(supplierId: string) {
    return ProductPricingService.getPriceLists(supplierId);
  }

  async getActivePriceList(supplierId: string) {
    return ProductPricingService.getActivePriceList(supplierId);
  }

  async updatePriceList(id: string, items: PriceListItem[]): Promise<void> {
    return ProductPricingService.updatePriceList(id, items);
  }

  async bulkUpdatePrices(supplierId: string, priceAdjustment: PriceAdjustment): Promise<void> {
    return ProductPricingService.bulkUpdatePrices(supplierId, priceAdjustment);
  }

  // ============= Real-time Subscription =============
  
  subscribeToProducts(supplierId: string, callback: ProductCallback): () => void {
    return ProductSubscriptionService.subscribeToProducts(supplierId, callback);
  }

  subscribeToActiveProducts(callback: ProductCallback): () => void {
    return ProductSubscriptionService.subscribeToActiveProducts(callback);
  }

  subscribeToProductsByCategory(category: string, callback: ProductCallback): () => void {
    return ProductSubscriptionService.subscribeToProductsByCategory(category, callback);
  }
}