/**
 * Suppliers List Subscription Service
 * Handle subscriptions for supplier collections with filtering
 *
 * NOTE: Firebase Firestore has been removed. This service now uses API endpoints.
 * Real-time subscriptions are converted to one-time fetches with no-op unsubscribe.
 */

import { SupplierStatus } from '@/types/supplier/base.types';
import { SuppliersCallback, SupplierSubscriptionFilter, SubscriptionOptions } from './types';
import { SupplierCrudService } from '../supplier.crud';
import { log } from '@/lib/logger';

export class SuppliersListSubscription {
  /**
   * Subscribe to all suppliers with optional filtering
   * NOTE: This is now a one-time fetch, not a real-time subscription
   */
  static subscribeToSuppliers(
    callback: SuppliersCallback,
    filter?: SupplierSubscriptionFilter,
    options?: SubscriptionOptions
  ): () => void {
    // Perform initial fetch
    this.fetchSuppliers(callback, filter, options);

    // Return no-op unsubscribe function
    return () => {};
  }

  /**
   * Fetch suppliers with filters
   */
  private static async fetchSuppliers(
    callback: SuppliersCallback,
    filter?: SupplierSubscriptionFilter,
    options?: SubscriptionOptions
  ): Promise<void> {
    try {
      let suppliers = await SupplierCrudService.getAll();

      // Apply filters
      if (filter?.status) {
        suppliers = suppliers.filter(s => s.status === filter.status);
      }
      if (filter?.isPreferred !== undefined) {
        suppliers = suppliers.filter(s => s.isPreferred === filter.isPreferred);
      }
      if (filter?.category) {
        suppliers = suppliers.filter(s =>
          s.categories && s.categories.includes(filter.category! as unknown as import('@/types/supplier/common.types').ProductCategory)
        );
      }

      // Sort by company name
      suppliers.sort((a, b) => (a.companyName || '').localeCompare(b.companyName || ''));

      // Apply limit
      if (filter?.limit) {
        suppliers = suppliers.slice(0, filter.limit);
      }

      callback(suppliers);
    } catch (error) {
      log.error('Error fetching suppliers:', { data: error }, 'suppliersList');
      const errorObj = error instanceof Error ? error : new Error('Unknown error');
      options?.onError?.(errorObj);
    }
  }

  /**
   * Subscribe to preferred suppliers only
   * NOTE: This is now a one-time fetch
   */
  static subscribeToPreferredSuppliers(
    callback: SuppliersCallback,
    options?: SubscriptionOptions
  ): () => void {
    return this.subscribeToSuppliers(
      callback,
      {
        status: SupplierStatus.ACTIVE,
        isPreferred: true
      },
      options
    );
  }

  /**
   * Subscribe to suppliers by category
   * NOTE: This is now a one-time fetch
   */
  static subscribeToCategorySuppliers(
    category: string,
    callback: SuppliersCallback,
    options?: SubscriptionOptions
  ): () => void {
    return this.subscribeToSuppliers(
      callback,
      {
        status: SupplierStatus.ACTIVE,
        category
      },
      options
    );
  }

  /**
   * Subscribe to suppliers pending approval
   * NOTE: This is now a one-time fetch
   */
  static subscribeToPendingSuppliers(
    callback: SuppliersCallback,
    options?: SubscriptionOptions
  ): () => void {
    return this.subscribeToSuppliers(
      callback,
      { status: SupplierStatus.PENDING },
      options
    );
  }
}
