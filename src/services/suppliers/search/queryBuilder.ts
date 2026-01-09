/**
 * Supplier Search Query Builder
 * Query construction for supplier searches
 *
 * NOTE: Firebase Firestore has been removed. This service now uses API endpoints.
 */

import { Supplier, SupplierStatus } from '@/types/supplier/base.types';
import { SupplierCrudService } from '../supplier.crud';
import { log } from '@/lib/logger';

export class SupplierQueryBuilder {
  /**
   * Get base supplier dataset with basic filters
   */
  static async getBaseSupplierSet(filters: Record<string, unknown>): Promise<Supplier[]> {
    try {
      // Get all suppliers through the CRUD service
      let suppliers = await SupplierCrudService.getAll();

      // Apply status filter
      if (filters.status) {
        if (Array.isArray(filters.status)) {
          suppliers = suppliers.filter(s => (filters.status as string[]).includes(s.status));
        } else {
          suppliers = suppliers.filter(s => s.status === filters.status);
        }
      } else {
        // Default to active suppliers only
        suppliers = suppliers.filter(s => s.status === SupplierStatus.ACTIVE);
      }

      return suppliers;
    } catch (error) {
      log.error('Error getting base supplier set:', { data: error }, 'queryBuilder');
      throw new Error(`Failed to get suppliers: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get suppliers by category
   */
  static async queryByCategory(category: string, options?: {
    includeInactive?: boolean;
    sortByRating?: boolean;
    limit?: number;
  }): Promise<Supplier[]> {
    try {
      let suppliers = await SupplierCrudService.getAll();

      // Filter by category
      suppliers = suppliers.filter(s =>
        s.categories && s.categories.includes(category)
      );

      // Filter by status
      if (!options?.includeInactive) {
        suppliers = suppliers.filter(s => s.status === SupplierStatus.ACTIVE);
      }

      // Sort
      if (options?.sortByRating) {
        suppliers.sort((a, b) => {
          const aRating = (a.rating as { overall?: number })?.overall || 0;
          const bRating = (b.rating as { overall?: number })?.overall || 0;
          return bRating - aRating;
        });
      } else {
        suppliers.sort((a, b) => (a.companyName || '').localeCompare(b.companyName || ''));
      }

      // Apply limit
      if (options?.limit) {
        suppliers = suppliers.slice(0, options.limit);
      }

      return suppliers;
    } catch (error) {
      log.error(`Error querying suppliers by category ${category}:`, { data: error }, 'queryBuilder');
      throw new Error(`Failed to query suppliers by category: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get preferred suppliers
   */
  static async queryPreferredSuppliers(options?: {
    category?: string;
    sortByPerformance?: boolean;
    limit?: number;
  }): Promise<Supplier[]> {
    try {
      let suppliers = await SupplierCrudService.getAll();

      // Filter preferred and active
      suppliers = suppliers.filter(s =>
        s.isPreferred === true && s.status === SupplierStatus.ACTIVE
      );

      // Filter by category if specified
      if (options?.category) {
        suppliers = suppliers.filter(s =>
          s.categories && s.categories.includes(options.category!)
        );
      }

      // Sort
      if (options?.sortByPerformance) {
        suppliers.sort((a, b) => {
          const aScore = (a.performance as { overallScore?: number })?.overallScore || 0;
          const bScore = (b.performance as { overallScore?: number })?.overallScore || 0;
          return bScore - aScore;
        });
      } else {
        suppliers.sort((a, b) => {
          const aRating = (a.rating as { overall?: number })?.overall || 0;
          const bRating = (b.rating as { overall?: number })?.overall || 0;
          return bRating - aRating;
        });
      }

      // Apply limit
      if (options?.limit) {
        suppliers = suppliers.slice(0, options.limit);
      }

      return suppliers;
    } catch (error) {
      log.error('Error querying preferred suppliers:', { data: error }, 'queryBuilder');
      throw new Error(`Failed to query preferred suppliers: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get suppliers by name search
   */
  static async queryByName(searchTerm: string, maxResults: number = 50): Promise<Supplier[]> {
    try {
      if (!searchTerm.trim()) {
        return [];
      }

      let suppliers = await SupplierCrudService.getAll();

      // Filter by active status
      suppliers = suppliers.filter(s => s.status === SupplierStatus.ACTIVE);

      // Filter by name (client-side text search)
      const term = searchTerm.toLowerCase();
      suppliers = suppliers.filter(s =>
        (s.companyName || '').toLowerCase().includes(term) ||
        (s.name || '').toLowerCase().includes(term)
      );

      // Sort by name
      suppliers.sort((a, b) => (a.companyName || '').localeCompare(b.companyName || ''));

      // Apply limit
      return suppliers.slice(0, maxResults);
    } catch (error) {
      log.error('Error querying suppliers by name:', { data: error }, 'queryBuilder');
      throw new Error(`Failed to query suppliers by name: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get top rated suppliers
   */
  static async getTopRatedSuppliers(limitCount: number): Promise<Supplier[]> {
    try {
      let suppliers = await SupplierCrudService.getAll();

      // Filter by active status
      suppliers = suppliers.filter(s => s.status === SupplierStatus.ACTIVE);

      // Sort by rating
      suppliers.sort((a, b) => {
        const aRating = (a.rating as { overall?: number })?.overall || 0;
        const bRating = (b.rating as { overall?: number })?.overall || 0;
        return bRating - aRating;
      });

      // Apply limit
      return suppliers.slice(0, limitCount);
    } catch (error) {
      log.error('Error getting top rated suppliers:', { data: error }, 'queryBuilder');
      throw new Error(`Failed to get top rated suppliers: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
