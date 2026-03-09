/**
 * Product Status Management
 * Handle product availability, activation, and discontinuation
 */

// @ts-ignore — firebase not installed
import { doc, updateDoc, Timestamp } from 'firebase/firestore';
// @ts-ignore — firebase config
import { db } from '@/config/firebase';
import { ProductAvailability } from './types';
import { log } from '@/lib/logger';

const PRODUCTS_COLLECTION = 'products';

/**
 * Product status management service
 */
export class ProductStatusService {
  /**
   * Update product availability status
   */
  static async updateAvailability(id: string, availability: ProductAvailability): Promise<void> {
    try {
      await updateDoc(doc(db, PRODUCTS_COLLECTION, id), {
        availability,
        updatedAt: Timestamp.now()
      });
    } catch (error) {
      log.error('Error updating product availability:', { data: error }, 'status');
      throw error;
    }
  }

  /**
   * Discontinue a product
   */
  static async discontinueProduct(id: string, replacementId?: string): Promise<void> {
    try {
      const updateData: any = {
        isDiscontinued: true,
        isActive: false,
        availability: ProductAvailability.DISCONTINUED,
        updatedAt: Timestamp.now()
      };
      
      if (replacementId) {
        updateData.replacementProductId = replacementId;
      }
      
      await updateDoc(doc(db, PRODUCTS_COLLECTION, id), updateData);
    } catch (error) {
      log.error('Error discontinuing product:', { data: error }, 'status');
      throw error;
    }
  }

  /**
   * Activate product
   */
  static async activateProduct(id: string): Promise<void> {
    try {
      await updateDoc(doc(db, PRODUCTS_COLLECTION, id), {
        isActive: true,
        isDiscontinued: false,
        availability: ProductAvailability.IN_STOCK,
        updatedAt: Timestamp.now()
      });
    } catch (error) {
      log.error('Error activating product:', { data: error }, 'status');
      throw error;
    }
  }

  /**
   * Deactivate product
   */
  static async deactivateProduct(id: string): Promise<void> {
    try {
      await updateDoc(doc(db, PRODUCTS_COLLECTION, id), {
        isActive: false,
        availability: ProductAvailability.OUT_OF_STOCK,
        updatedAt: Timestamp.now()
      });
    } catch (error) {
      log.error('Error deactivating product:', { data: error }, 'status');
      throw error;
    }
  }
}