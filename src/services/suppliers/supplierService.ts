/**
 * Supplier Management Service - Legacy Compatibility Layer
 * 
 * @deprecated This file has been split into modular components for better maintainability.
 * 
 * New modular structure:
 * - supplier.crud.ts: Core CRUD operations
 * - supplier.status.ts: Status and preference management
 * - supplier.rating.ts: Rating and performance management
 * - supplier.search.ts: Search and filter operations
 * - supplier.compliance.ts: Compliance and document management
 * - supplier.subscriptions.ts: Real-time subscriptions
 * - supplier.statistics.ts: Statistics and analytics
 * 
 * For new code, import from the specific modules:
 * ```typescript
 * import { SupplierCrudService, SupplierSearchService } from '@/services/suppliers';
 * // or
 * import SupplierServices from '@/services/suppliers';
 * ```
 * 
 * This legacy layer maintains backward compatibility while the codebase transitions.
 */

import { SupplierCrudService } from './supplier.crud';
import { SupplierStatusService } from './supplier.status';
import { SupplierRatingService } from './supplier.rating';
import { SupplierSearchService } from './supplier.search';
import { SupplierComplianceService } from './supplier.compliance';
import { SupplierSubscriptionService } from './supplier.subscriptions';
import { SupplierStatisticsService } from './supplier.statistics';
import type {
  Supplier,
  SupplierFormData,
  SupplierStatus,
  SupplierRating,
  PerformancePeriod,
  ComplianceStatus,
  SupplierDocument
} from '@/types/supplier/base.types';

/**
 * @deprecated Use the new modular services for better type safety and organization
 * 
 * Legacy supplier service object that delegates to new modular architecture
 */
export const supplierService = {
  // ============= CRUD Operations =============
  
  /**
   * @deprecated Use SupplierCrudService.getAll() instead
   */
  async getAll(filter?: { 
    status?: SupplierStatus; 
    category?: string; 
    isPreferred?: boolean 
  }) {
    return SupplierCrudService.getAll(filter);
  },

  /**
   * @deprecated Use SupplierCrudService.getById() instead
   */
  async getById(id: string): Promise<Supplier> {
    return SupplierCrudService.getById(id);
  },

  /**
   * @deprecated Use SupplierCrudService.create() instead
   */
  async create(data: SupplierFormData): Promise<string> {
    return SupplierCrudService.create(data);
  },

  /**
   * @deprecated Use SupplierCrudService.update() instead
   */
  async update(id: string, data: Partial<SupplierFormData>): Promise<void> {
    return SupplierCrudService.update(id, data);
  },

  /**
   * @deprecated Use SupplierCrudService.delete() instead
   */
  async delete(id: string): Promise<void> {
    return SupplierCrudService.delete(id);
  },

  // ============= Status Management =============
  
  /**
   * @deprecated Use SupplierStatusService.updateStatus() instead
   */
  async updateStatus(id: string, status: SupplierStatus, reason?: string): Promise<void> {
    return SupplierStatusService.updateStatus(id, status, reason);
  },

  /**
   * @deprecated Use SupplierStatusService.setPreferred() instead
   */
  async setPreferred(id: string, isPreferred: boolean): Promise<void> {
    return SupplierStatusService.setPreferred(id, isPreferred);
  },

  // ============= Performance & Rating =============
  
  /**
   * @deprecated Use SupplierRatingService.updateRating() instead
   */
  async updateRating(id: string, rating: Partial<SupplierRating>): Promise<void> {
    return SupplierRatingService.updateRating(id, rating);
  },

  /**
   * @deprecated Use SupplierRatingService.calculatePerformance() instead
   */
  async calculatePerformance(supplierId: string, period: PerformancePeriod) {
    return SupplierRatingService.calculatePerformance(supplierId, period);
  },

  // ============= Search & Filter =============
  
  /**
   * @deprecated Use SupplierSearchService.searchByName() instead
   */
  async searchByName(searchTerm: string): Promise<Supplier[]> {
    return SupplierSearchService.searchByName(searchTerm);
  },

  /**
   * @deprecated Use SupplierSearchService.getPreferredSuppliers() instead
   */
  async getPreferredSuppliers(): Promise<Supplier[]> {
    return SupplierSearchService.getPreferredSuppliers();
  },

  /**
   * @deprecated Use SupplierSearchService.getByCategory() instead
   */
  async getByCategory(category: string): Promise<Supplier[]> {
    return SupplierSearchService.getByCategory(category);
  },

  // ============= Compliance & Documents =============
  
  /**
   * @deprecated Use SupplierComplianceService.updateCompliance() instead
   */
  async updateCompliance(id: string, compliance: Partial<ComplianceStatus>): Promise<void> {
    return SupplierComplianceService.updateCompliance(id, compliance);
  },

  /**
   * @deprecated Use SupplierComplianceService.addDocument() instead
   */
  async addDocument(id: string, document: Omit<SupplierDocument, 'id'>): Promise<void> {
    await SupplierComplianceService.addDocument(id, document);
  },

  // ============= Real-time Subscription =============
  
  /**
   * @deprecated Use SupplierSubscriptionService.subscribeToSupplier() instead
   */
  subscribeToSupplier(supplierId: string, callback: (supplier: Supplier) => void) {
    return SupplierSubscriptionService.subscribeToSupplier(supplierId, callback);
  },

  /**
   * @deprecated Use SupplierSubscriptionService.subscribeToSuppliers() instead
   */
  subscribeToSuppliers(callback: (suppliers: Supplier[]) => void) {
    return SupplierSubscriptionService.subscribeToSuppliers(callback);
  },

  // ============= Statistics =============
  
  /**
   * @deprecated Use SupplierStatisticsService.getStatistics() instead
   */
  async getStatistics() {
    return SupplierStatisticsService.getStatistics();
  },

  /**
   * @deprecated Use SupplierStatisticsService.countByCategory() instead
   */
  countByCategory(suppliers: Supplier[]) {
    const counts: Record<string, number> = {};
    
    suppliers.forEach(supplier => {
      supplier.categories?.forEach(category => {
        counts[category] = (counts[category] || 0) + 1;
      });
    });
    
    return counts;
  }
};

// Re-export new modular services for migration convenience
export { SupplierCrudService } from './supplier.crud';
export { SupplierStatusService } from './supplier.status';
export { SupplierRatingService } from './supplier.rating';
export { SupplierSearchService } from './supplier.search';
export { SupplierComplianceService } from './supplier.compliance';
export { SupplierSubscriptionService } from './supplier.subscriptions';
export { SupplierStatisticsService } from './supplier.statistics';

// Default export maintains compatibility
export default supplierService;