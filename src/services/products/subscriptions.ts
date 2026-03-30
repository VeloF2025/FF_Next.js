/**
 * Product Real-time Subscriptions
 * Handle real-time data subscriptions for product management
 */

// @ts-ignore — firebase not installed
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
// @ts-ignore — firebase config
import { db } from '@/config/firebase';
import { Product, ProductCallback } from './types';

const PRODUCTS_COLLECTION = 'products';

/**
 * Product subscription service for real-time updates
 */
export class ProductSubscriptionService {
  /**
   * Subscribe to products for a supplier
   */
  static subscribeToProducts(supplierId: string, callback: ProductCallback): () => void {
    const q = query(
      collection(db, PRODUCTS_COLLECTION),
      where('supplierId', '==', supplierId),
      orderBy('name')
    );
    
    return onSnapshot(q, (snapshot: any) => {
      const products = snapshot.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data()
      } as Product));
      callback(products);
    });
  }

  /**
   * Subscribe to all active products
   */
  static subscribeToActiveProducts(callback: ProductCallback): () => void {
    const q = query(
      collection(db, PRODUCTS_COLLECTION),
      where('isActive', '==', true),
      orderBy('name')
    );
    
    return onSnapshot(q, (snapshot: any) => {
      const products = snapshot.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data()
      } as Product));
      callback(products);
    });
  }

  /**
   * Subscribe to products by category
   */
  static subscribeToProductsByCategory(category: string, callback: ProductCallback): () => void {
    const q = query(
      collection(db, PRODUCTS_COLLECTION),
      where('category', '==', category),
      where('isActive', '==', true),
      orderBy('name')
    );
    
    return onSnapshot(q, (snapshot: any) => {
      const products = snapshot.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data()
      } as Product));
      callback(products);
    });
  }
}