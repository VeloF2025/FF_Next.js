/**
 * Supplier Batch Operations
 * Batch processing and multiple supplier operations
 *
 * NOTE: Firebase Firestore has been removed. This service now uses API endpoints.
 */

import { Supplier } from '@/types/supplier/base.types';
import { SupplierBatchOptions } from './types';
import { SupplierBaseCrud } from './base';
import { log } from '@/lib/logger';

/**
 * Supplier batch operations
 */
export class SupplierBatchOperations {
  /**
   * Get suppliers by multiple IDs
   */
  static async getByIds(ids: string[], options?: SupplierBatchOptions): Promise<Supplier[]> {
    try {
      if (ids.length === 0) return [];

      // Fetch all suppliers and filter by IDs
      const allSuppliers = await SupplierBaseCrud.getAll();
      return allSuppliers.filter(supplier => ids.includes(supplier.id));
    } catch (error) {
      log.error('Error fetching suppliers by IDs:', { data: error }, 'batch');
      throw new Error(`Failed to fetch suppliers by IDs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Process suppliers in batches
   */
  static async processBatch<T>(
    ids: string[],
    processor: (supplier: Supplier) => Promise<T>,
    options?: SupplierBatchOptions
  ): Promise<T[]> {
    try {
      const batchSize = options?.batchSize || 10;
      const maxConcurrent = options?.maxConcurrent || 3;

      const results: T[] = [];
      const chunks = this.chunkArray(ids, batchSize);

      for (let i = 0; i < chunks.length; i += maxConcurrent) {
        const concurrentChunks = chunks.slice(i, i + maxConcurrent);

        const chunkPromises = concurrentChunks.map(async (chunk) => {
          const suppliers = await this.getByIds(chunk);
          return Promise.all(suppliers.map(processor));
        });

        const chunkResults = await Promise.all(chunkPromises);
        results.push(...chunkResults.flat());
      }

      return results;
    } catch (error) {
      log.error('Error processing supplier batch:', { data: error }, 'batch');
      throw new Error(`Failed to process supplier batch: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Utility function to chunk array into smaller arrays
   */
  private static chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
