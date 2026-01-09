/**
 * Single Supplier Subscription Service
 * Handle subscriptions for individual suppliers
 *
 * NOTE: Firebase Firestore has been removed. This service now uses API endpoints.
 * Real-time subscriptions are converted to one-time fetches with no-op unsubscribe.
 */

import { Supplier } from '@/types/supplier/base.types';
import { SupplierCallback, SubscriptionOptions } from './types';
import { SupplierCrudService } from '../supplier.crud';
import { log } from '@/lib/logger';

export class SingleSupplierSubscription {
  /**
   * Subscribe to a single supplier's changes
   * NOTE: This is now a one-time fetch, not a real-time subscription
   */
  static subscribeToSupplier(
    supplierId: string,
    callback: SupplierCallback,
    options?: SubscriptionOptions
  ): () => void {
    // Perform initial fetch
    this.fetchSupplier(supplierId, callback, options);

    // Return no-op unsubscribe function
    return () => {};
  }

  /**
   * Fetch a single supplier
   */
  private static async fetchSupplier(
    supplierId: string,
    callback: SupplierCallback,
    options?: SubscriptionOptions
  ): Promise<void> {
    try {
      const supplier = await SupplierCrudService.getById(supplierId);

      if (supplier) {
        callback(supplier as Supplier);
      } else {
        options?.onError?.(new Error(`Supplier ${supplierId} not found`));
      }
    } catch (error) {
      log.error(`Error fetching supplier ${supplierId}:`, { data: error }, 'singleSupplier');
      const errorObj = error instanceof Error ? error : new Error('Unknown error');
      options?.onError?.(errorObj);
    }
  }
}
