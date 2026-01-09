/**
 * Specialized Supplier Subscriptions
 * Handle specific subscriptions for ratings and compliance
 *
 * NOTE: Firebase Firestore has been removed. This service now uses API endpoints.
 * Real-time subscriptions are converted to one-time fetches with no-op unsubscribe.
 */

import { SupplierStatus } from '@/types/supplier/base.types';
import { SubscriptionOptions, SupplierRatingData, SupplierComplianceData } from './types';
import { SupplierCrudService } from '../supplier.crud';
import { log } from '@/lib/logger';

export class SpecializedSubscriptions {
  /**
   * Subscribe to supplier rating changes
   * NOTE: This is now a one-time fetch, not a real-time subscription
   */
  static subscribeToSupplierRatings(
    callback: (suppliers: SupplierRatingData[]) => void,
    options?: SubscriptionOptions
  ): () => void {
    // Perform initial fetch
    this.fetchSupplierRatings(callback, options);

    // Return no-op unsubscribe function
    return () => {};
  }

  /**
   * Fetch supplier ratings
   */
  private static async fetchSupplierRatings(
    callback: (suppliers: SupplierRatingData[]) => void,
    options?: SubscriptionOptions
  ): Promise<void> {
    try {
      const suppliers = await SupplierCrudService.getAll();

      // Filter active suppliers and map to rating data
      const supplierRatings = suppliers
        .filter(s => s.status === SupplierStatus.ACTIVE)
        .map(supplier => ({
          id: supplier.id,
          rating: supplier.rating,
          companyName: supplier.companyName || supplier.name || 'Unknown'
        }))
        .sort((a, b) => {
          const aRating = (a.rating as { overall?: number })?.overall || 0;
          const bRating = (b.rating as { overall?: number })?.overall || 0;
          return bRating - aRating;
        })
        .slice(0, 50); // Limit to top 50 rated suppliers

      callback(supplierRatings);
    } catch (error) {
      log.error('Error fetching supplier ratings:', { data: error }, 'specializedSubscriptions');
      const errorObj = error instanceof Error ? error : new Error('Unknown error');
      options?.onError?.(errorObj);
    }
  }

  /**
   * Subscribe to compliance status changes
   * NOTE: This is now a one-time fetch, not a real-time subscription
   */
  static subscribeToComplianceStatus(
    callback: (suppliers: SupplierComplianceData[]) => void,
    options?: SubscriptionOptions
  ): () => void {
    // Perform initial fetch
    this.fetchComplianceStatus(callback, options);

    // Return no-op unsubscribe function
    return () => {};
  }

  /**
   * Fetch compliance status data
   */
  private static async fetchComplianceStatus(
    callback: (suppliers: SupplierComplianceData[]) => void,
    options?: SubscriptionOptions
  ): Promise<void> {
    try {
      const suppliers = await SupplierCrudService.getAll();

      // Filter and map to compliance data
      const complianceData = suppliers
        .filter(s => s.status === SupplierStatus.ACTIVE || s.status === SupplierStatus.PENDING)
        .map(supplier => ({
          id: supplier.id,
          companyName: supplier.companyName || supplier.name || 'Unknown',
          complianceStatus: (supplier as { complianceStatus?: Record<string, unknown> }).complianceStatus || {},
          status: supplier.status as SupplierStatus
        }))
        .sort((a, b) => a.companyName.localeCompare(b.companyName));

      callback(complianceData);
    } catch (error) {
      log.error('Error fetching compliance status:', { data: error }, 'specializedSubscriptions');
      const errorObj = error instanceof Error ? error : new Error('Unknown error');
      options?.onError?.(errorObj);
    }
  }
}
