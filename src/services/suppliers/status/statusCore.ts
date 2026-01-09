/**
 * Supplier Status - Core Status Operations
 * Handles fundamental status update operations
 *
 * NOTE: Firebase Firestore has been removed. This service now uses API endpoints.
 */

import { log } from '@/lib/logger';
import { SupplierCrudService } from '../supplier.crud';
import {
  SupplierStatus,
  StatusUpdateData
} from './types';

export class StatusCore {
  /**
   * Update supplier status with reason tracking
   */
  static async updateStatus(
    id: string,
    { status, reason, userId }: StatusUpdateData
  ): Promise<void> {
    try {
      const updateData = this.buildStatusUpdateData(status, reason, userId);
      await SupplierCrudService.update(id, updateData);
    } catch (error) {
      log.error(`Error updating supplier status for ${id}:`, { data: error }, 'statusCore');
      throw new Error(`Failed to update supplier status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build status update data based on status type
   */
  private static buildStatusUpdateData(
    status: SupplierStatus,
    reason?: string,
    userId?: string
  ): Record<string, unknown> {
    const baseData: Record<string, unknown> = {
      status,
      updatedAt: new Date().toISOString(),
      lastModifiedBy: userId || 'current-user-id' // TODO: Get from auth context
    };

    // Add specific status-related fields
    switch (status) {
      case SupplierStatus.BLACKLISTED:
        return this.buildBlacklistData(baseData, reason, userId);

      case SupplierStatus.INACTIVE:
        return this.buildInactiveData(baseData, reason);

      case SupplierStatus.ACTIVE:
        return this.buildActiveData(baseData, userId);

      case SupplierStatus.PENDING:
        return this.buildPendingData(baseData);

      default:
        return baseData;
    }
  }

  /**
   * Build blacklist-specific update data
   */
  private static buildBlacklistData(
    baseData: Record<string, unknown>,
    reason?: string,
    userId?: string
  ): Record<string, unknown> {
    const data: Record<string, unknown> = { ...baseData, isActive: false };

    if (reason) {
      data.blacklistReason = reason;
      data.blacklistedAt = new Date().toISOString();
      data.blacklistedBy = userId || 'current-user-id';
    }

    return data;
  }

  /**
   * Build inactive-specific update data
   */
  private static buildInactiveData(
    baseData: Record<string, unknown>,
    reason?: string
  ): Record<string, unknown> {
    const data: Record<string, unknown> = { ...baseData, isActive: false };

    if (reason) {
      data.inactiveReason = reason;
      data.inactivatedAt = new Date().toISOString();
    }

    return data;
  }

  /**
   * Build active-specific update data
   */
  private static buildActiveData(
    baseData: Record<string, unknown>,
    userId?: string
  ): Record<string, unknown> {
    return {
      ...baseData,
      isActive: true,
      activatedAt: new Date().toISOString(),
      activatedBy: userId || 'current-user-id',
      // Clear blacklist/inactive reasons if reactivating
      blacklistReason: null,
      inactiveReason: null
    };
  }

  /**
   * Build pending-specific update data
   */
  private static buildPendingData(
    baseData: Record<string, unknown>
  ): Record<string, unknown> {
    return {
      ...baseData,
      isActive: false,
      pendingSince: new Date().toISOString()
    };
  }

  /**
   * Set supplier as preferred or remove preference
   */
  static async setPreferred(
    id: string,
    isPreferred: boolean,
    userId?: string
  ): Promise<void> {
    try {
      const updateData = this.buildPreferenceUpdateData(isPreferred, userId);
      await SupplierCrudService.update(id, updateData);
    } catch (error) {
      log.error(`Error updating supplier preference for ${id}:`, { data: error }, 'statusCore');
      throw new Error(`Failed to update supplier preference: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build preference update data
   */
  private static buildPreferenceUpdateData(
    isPreferred: boolean,
    userId?: string
  ): Record<string, unknown> {
    const updateData: Record<string, unknown> = {
      isPreferred,
      updatedAt: new Date().toISOString(),
      lastModifiedBy: userId || 'current-user-id'
    };

    if (isPreferred) {
      updateData.preferredSince = new Date().toISOString();
      updateData.preferredBy = userId || 'current-user-id';
    } else {
      updateData.preferredSince = null;
      updateData.preferredBy = null;
    }

    return updateData;
  }
}
