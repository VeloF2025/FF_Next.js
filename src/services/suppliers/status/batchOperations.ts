/**
 * Supplier Status - Batch Operations
 * Handles bulk status updates and preference changes
 */

import {
  SupplierStatus,
  BatchOperationResult,
  PreferenceUpdateResult,
  PreferenceUpdate,
  StatusUpdateData
} from './types';
import { StatusCore } from './statusCore';

export class BatchOperations {
  /**
   * Activate multiple suppliers in batch
   */
  static async activateMultiple(
    supplierIds: string[],
    userId?: string
  ): Promise<BatchOperationResult> {
    const success: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const id of supplierIds) {
      try {
        const updateData: StatusUpdateData = { status: SupplierStatus.ACTIVE };
        if (userId) updateData.userId = userId;
        await StatusCore.updateStatus(id, updateData);
        success.push(id);
      } catch (error) {
        failed.push({
          id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return { success, failed };
  }

  /**
   * Deactivate multiple suppliers in batch
   */
  static async deactivateMultiple(
    supplierIds: string[],
    reason?: string,
    userId?: string
  ): Promise<BatchOperationResult> {
    const success: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const id of supplierIds) {
      try {
        const updateData: StatusUpdateData = { status: SupplierStatus.INACTIVE };
        if (reason) updateData.reason = reason;
        if (userId) updateData.userId = userId;
        await StatusCore.updateStatus(id, updateData);
        success.push(id);
      } catch (error) {
        failed.push({
          id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return { success, failed };
  }

  /**
   * Bulk update supplier preferences
   */
  static async updatePreferences(
    updates: PreferenceUpdate[],
    userId?: string
  ): Promise<PreferenceUpdateResult> {
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const update of updates) {
      try {
        await StatusCore.setPreferred(update.id, update.isPreferred, userId);
        success++;
      } catch (error) {
        failed++;
        errors.push(`Failed to update ${update.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return { success, failed, errors };
  }

  /**
   * Blacklist multiple suppliers in batch
   */
  static async blacklistMultiple(
    supplierIds: string[],
    reason?: string,
    userId?: string
  ): Promise<BatchOperationResult> {
    const success: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const id of supplierIds) {
      try {
        const updateData: StatusUpdateData = { status: SupplierStatus.BLACKLISTED };
        if (reason) updateData.reason = reason;
        if (userId) updateData.userId = userId;
        await StatusCore.updateStatus(id, updateData);
        success.push(id);
      } catch (error) {
        failed.push({
          id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return { success, failed };
  }

  /**
   * Batch operation with custom status
   */
  static async updateStatusBatch(
    supplierIds: string[],
    status: SupplierStatus,
    reason?: string,
    userId?: string
  ): Promise<BatchOperationResult> {
    const success: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const id of supplierIds) {
      try {
        const updateData: StatusUpdateData = { status };
        if (reason) updateData.reason = reason;
        if (userId) updateData.userId = userId;
        await StatusCore.updateStatus(id, updateData);
        success.push(id);
      } catch (error) {
        failed.push({
          id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return { success, failed };
  }
}