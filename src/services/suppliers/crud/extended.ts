/**
 * Supplier Extended Operations
 * Advanced operations like soft delete, statistics, validation
 *
 * NOTE: Firebase Firestore has been removed. This service now uses API endpoints.
 */

import { SupplierStatus } from '@/types/supplier/base.types';
import { SupplierBaseCrud } from './base';
import { log } from '@/lib/logger';

/**
 * Extended supplier operations
 */
export class SupplierExtendedOperations {
  /**
   * Soft delete supplier (set status to inactive)
   */
  static async softDelete(id: string, reason?: string): Promise<void> {
    try {
      const updateData: Record<string, unknown> = {
        status: SupplierStatus.INACTIVE,
        isActive: false,
        updatedAt: new Date().toISOString(),
        lastModifiedBy: 'current-user-id' // TODO: Get from auth context
      };

      if (reason) {
        updateData.inactiveReason = reason;
        updateData.inactivatedAt = new Date().toISOString();
      }

      await SupplierBaseCrud.update(id, updateData as never);
    } catch (error) {
      log.error(`Error soft deleting supplier ${id}:`, { data: error }, 'extended');
      throw error;
    }
  }

  /**
   * Get active suppliers count
   */
  static async getActiveCount(): Promise<number> {
    try {
      const suppliers = await SupplierBaseCrud.getAll({ status: SupplierStatus.ACTIVE });
      return suppliers.length;
    } catch (error) {
      log.error('Error getting active supplier count:', { data: error }, 'extended');
      return 0;
    }
  }

  /**
   * Get suppliers count by status
   */
  static async getCountByStatus(status: SupplierStatus): Promise<number> {
    try {
      const suppliers = await SupplierBaseCrud.getAll({ status });
      return suppliers.length;
    } catch (error) {
      log.error(`Error getting supplier count for status ${status}:`, { data: error }, 'extended');
      return 0;
    }
  }

  /**
   * Check if supplier code is unique
   */
  static async isCodeUnique(code: string, excludeId?: string): Promise<boolean> {
    try {
      const suppliers = await SupplierBaseCrud.getAll();
      const existingSupplier = suppliers.find(s => s.code === code);

      if (!existingSupplier) return true;
      if (excludeId && existingSupplier.id === excludeId) return true;

      return false;
    } catch (error) {
      log.error('Error checking code uniqueness:', { data: error }, 'extended');
      return false;
    }
  }

  /**
   * Check if supplier email is unique
   */
  static async isEmailUnique(email: string, excludeId?: string): Promise<boolean> {
    try {
      const suppliers = await SupplierBaseCrud.getAll();
      const existingSupplier = suppliers.find(s => s.email === email);

      if (!existingSupplier) return true;
      if (excludeId && existingSupplier.id === excludeId) return true;

      return false;
    } catch (error) {
      log.error('Error checking email uniqueness:', { data: error }, 'extended');
      return false;
    }
  }

  /**
   * Get preferred suppliers count
   */
  static async getPreferred(): Promise<number> {
    try {
      const suppliers = await SupplierBaseCrud.getAll({ isPreferred: true });
      return suppliers.length;
    } catch (error) {
      log.error('Error getting preferred supplier count:', { data: error }, 'extended');
      return 0;
    }
  }

  /**
   * Reactivate supplier (undo soft delete)
   */
  static async reactivate(id: string): Promise<void> {
    try {
      const updateData = {
        status: SupplierStatus.ACTIVE,
        isActive: true,
        updatedAt: new Date().toISOString(),
        lastModifiedBy: 'current-user-id', // TODO: Get from auth context
        inactiveReason: null,
        inactivatedAt: null
      };

      await SupplierBaseCrud.update(id, updateData);
    } catch (error) {
      log.error(`Error reactivating supplier ${id}:`, { data: error }, 'extended');
      throw error;
    }
  }
}
