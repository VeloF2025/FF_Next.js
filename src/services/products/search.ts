/**
 * Product Search and Query Operations
 * Handle product searching, filtering, and queries
 */

import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { Product, ProductAvailability } from './types';
import { log } from '@/lib/logger';

interface FirestoreDoc {
  id: string;
  data(): Record<string, unknown>;
}

const PRODUCTS_COLLECTION = 'products';

/**
 * Product search and query service
 */
export class ProductSearchService {
  /**
   * Search products by term
   */
  static async searchProducts(searchTerm: string): Promise<Product[]> {
    try {
      const q = query(
        collection(db, PRODUCTS_COLLECTION),
        orderBy('name'),
        limit(100)
      );
      
      const snapshot = await getDocs(q);
      const products = snapshot.docs.map((doc: FirestoreDoc) => ({
        id: doc.id,
        ...doc.data()
      } as Product));

      // Client-side filtering for search
      const term = searchTerm.toLowerCase();
      return products.filter((product: Product) =>
        product.name.toLowerCase().includes(term) ||
        product.code.toLowerCase().includes(term) ||
        product.description?.toLowerCase().includes(term) ||
        product.brand?.toLowerCase().includes(term)
      );
    } catch (error) {
      log.error('Error searching products:', { data: error }, 'search');
      throw error;
    }
  }

  /**
   * Get products by supplier
   */
  static async getProductsBySupplier(supplierId: string): Promise<Product[]> {
    try {
      const q = query(
        collection(db, PRODUCTS_COLLECTION),
        where('supplierId', '==', supplierId),
        where('isActive', '==', true),
        orderBy('name')
      );
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map((doc: FirestoreDoc) => ({
        id: doc.id,
        ...doc.data()
      } as Product));
    } catch (error) {
      log.error('Error fetching supplier products:', { data: error }, 'search');
      throw error;
    }
  }

  /**
   * Get available products (in stock or low stock)
   */
  static async getAvailableProducts(): Promise<Product[]> {
    try {
      const q = query(
        collection(db, PRODUCTS_COLLECTION),
        where('availability', 'in', [
          ProductAvailability.IN_STOCK,
          ProductAvailability.LOW_STOCK
        ]),
        where('isActive', '==', true),
        orderBy('name')
      );
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map((doc: FirestoreDoc) => ({
        id: doc.id,
        ...doc.data()
      } as Product));
    } catch (error) {
      log.error('Error fetching available products:', { data: error }, 'search');
      throw error;
    }
  }

  /**
   * Get products by category
   */
  static async getProductsByCategory(category: string): Promise<Product[]> {
    try {
      const q = query(
        collection(db, PRODUCTS_COLLECTION),
        where('category', '==', category),
        where('isActive', '==', true),
        orderBy('name')
      );
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map((doc: FirestoreDoc) => ({
        id: doc.id,
        ...doc.data()
      } as Product));
    } catch (error) {
      log.error('Error fetching category products:', { data: error }, 'search');
      throw error;
    }
  }

  /**
   * Get low stock products
   */
  static async getLowStockProducts(): Promise<Product[]> {
    try {
      const q = query(
        collection(db, PRODUCTS_COLLECTION),
        where('availability', '==', ProductAvailability.LOW_STOCK),
        where('isActive', '==', true),
        orderBy('name')
      );
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map((doc: FirestoreDoc) => ({
        id: doc.id,
        ...doc.data()
      } as Product));
    } catch (error) {
      log.error('Error fetching low stock products:', { data: error }, 'search');
      throw error;
    }
  }
}