/**
 * Supplier Status - Query Operations
 * Handles status-based queries and data retrieval
 *
 * NOTE: Firebase Firestore has been removed. This service now uses API endpoints.
 */

import { log } from '@/lib/logger';
import { SupplierCrudService } from '../supplier.crud';
import {
  SupplierStatus,
  Supplier,
  StatusSummary,
  StatusHistoryEntry
} from './types';

export class StatusQueries {
  /**
   * Get suppliers by status
   */
  static async getByStatus(status: SupplierStatus): Promise<Supplier[]> {
    try {
      const suppliers = await SupplierCrudService.getAll();
      return suppliers.filter(s => s.status === status) as unknown as Supplier[];
    } catch (error) {
      log.error(`Error fetching suppliers by status ${status}:`, { data: error }, 'statusQueries');
      throw new Error(`Failed to fetch suppliers by status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get suppliers pending approval
   */
  static async getPendingApproval(): Promise<Supplier[]> {
    return this.getByStatus(SupplierStatus.PENDING);
  }

  /**
   * Get active suppliers
   */
  static async getActiveSuppliers(): Promise<Supplier[]> {
    return this.getByStatus(SupplierStatus.ACTIVE);
  }

  /**
   * Get inactive suppliers
   */
  static async getInactiveSuppliers(): Promise<Supplier[]> {
    return this.getByStatus(SupplierStatus.INACTIVE);
  }

  /**
   * Get blacklisted suppliers
   */
  static async getBlacklistedSuppliers(): Promise<Supplier[]> {
    return this.getByStatus(SupplierStatus.BLACKLISTED);
  }

  /**
   * Get preferred suppliers
   */
  static async getPreferredSuppliers(): Promise<Supplier[]> {
    try {
      const suppliers = await SupplierCrudService.getAll();
      return suppliers.filter(s =>
        s.isPreferred === true && s.status === SupplierStatus.ACTIVE
      ) as unknown as Supplier[];
    } catch (error) {
      log.error('Error fetching preferred suppliers:', { data: error }, 'statusQueries');
      throw new Error(`Failed to fetch preferred suppliers: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get status summary statistics
   */
  static async getStatusSummary(): Promise<StatusSummary> {
    try {
      const suppliers = await SupplierCrudService.getAll();

      const summary: StatusSummary = {
        [SupplierStatus.PENDING]: 0,
        [SupplierStatus.ACTIVE]: 0,
        [SupplierStatus.INACTIVE]: 0,
        [SupplierStatus.SUSPENDED]: 0,
        [SupplierStatus.BLACKLISTED]: 0,
        [SupplierStatus.ARCHIVED]: 0
      };

      // Count suppliers by status
      for (const supplier of suppliers) {
        const status = supplier.status as SupplierStatus;
        if (status in summary) {
          summary[status]++;
        }
      }

      return summary;
    } catch (error) {
      log.error('Error getting status summary:', { data: error }, 'statusQueries');
      throw new Error(`Failed to get status summary: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get status transition history for a supplier
   */
  static async getStatusHistory(supplierId: string): Promise<StatusHistoryEntry[]> {
    try {
      // In a real implementation, this would query a status history table
      // For now, return empty array - status history is not stored
      log.info(`Getting status history for supplier ${supplierId}`, {}, 'statusQueries');
      return [];
    } catch (error) {
      log.error(`Error fetching status history for ${supplierId}:`, { data: error }, 'statusQueries');
      return [];
    }
  }

  /**
   * Get suppliers with specific conditions
   */
  static async getSuppliersWithConditions(conditions: {
    status?: SupplierStatus;
    isPreferred?: boolean;
    isActive?: boolean;
  }): Promise<Supplier[]> {
    try {
      let suppliers = await SupplierCrudService.getAll();

      if (conditions.status) {
        suppliers = suppliers.filter(s => s.status === conditions.status);
      }

      if (conditions.isPreferred !== undefined) {
        suppliers = suppliers.filter(s => s.isPreferred === conditions.isPreferred);
      }

      if (conditions.isActive !== undefined) {
        suppliers = suppliers.filter(s => s.isActive === conditions.isActive);
      }

      return suppliers as unknown as Supplier[];
    } catch (error) {
      log.error('Error fetching suppliers with conditions:', { data: error }, 'statusQueries');
      throw new Error(`Failed to fetch suppliers: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
