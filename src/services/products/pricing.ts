/**
 * Product Pricing and Price List Management
 * Handle price lists, pricing updates, and bulk price operations
 */

// @ts-expect-error — firebase not installed
import { collection, doc, getDocs, getDoc, addDoc, updateDoc, query, where, orderBy, limit, Timestamp } from 'firebase/firestore';
// @ts-expect-error — firebase config
import { db } from '@/config/firebase';
import { Product, PriceList, PriceListItem, CreatePriceListData, PriceAdjustment } from './types';
import { Currency } from '@/types/supplier/common.types';
import { log } from '@/lib/logger';

const PRODUCTS_COLLECTION = 'products';
const PRICE_LISTS_COLLECTION = 'price_lists';

/**
 * Product pricing and price list service
 */
export class ProductPricingService {
  /**
   * Create new price list
   */
  static async createPriceList(supplierId: string, data: CreatePriceListData): Promise<string> {
    try {
      const priceList = {
        supplierId,
        name: data.name,
        description: data.description || '',
        items: data.items,
        effectiveDate: data.effectiveFrom,
        ...(data.effectiveTo && { expiryDate: data.effectiveTo }),
        version: '1.0',
        status: 'active',
        currency: Currency.ZAR,
        createdBy: 'current-user',
        createdAt: new Date(),
        updatedAt: new Date()
      } as Omit<PriceList, 'id'>;
      
      const docRef = await addDoc(collection(db, PRICE_LISTS_COLLECTION), priceList);
      return docRef.id;
    } catch (error) {
      log.error('Error creating price list:', { data: error }, 'pricing');
      throw error;
    }
  }

  /**
   * Get price lists for supplier
   */
  static async getPriceLists(supplierId: string): Promise<PriceList[]> {
    try {
      const q = query(
        collection(db, PRICE_LISTS_COLLECTION),
        where('supplierId', '==', supplierId),
        orderBy('effectiveFrom', 'desc')
      );
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map((docSnap: { id: string; data: () => Record<string, unknown> }) => ({
        id: docSnap.id,
        ...docSnap.data()
      } as PriceList));
    } catch (error) {
      log.error('Error fetching price lists:', { data: error }, 'pricing');
      throw error;
    }
  }

  /**
   * Get active price list for supplier
   */
  static async getActivePriceList(supplierId: string): Promise<PriceList | null> {
    try {
      const now = Timestamp.now();
      const q = query(
        collection(db, PRICE_LISTS_COLLECTION),
        where('supplierId', '==', supplierId),
        where('isActive', '==', true),
        where('effectiveFrom', '<=', now),
        orderBy('effectiveFrom', 'desc'),
        limit(1)
      );
      
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        return null;
      }
      
      const priceList = {
        id: snapshot.docs[0].id,
        ...snapshot.docs[0].data()
      } as PriceList;
      
      // Check if within validity period
      const expiryDate = priceList.expiryDate ? new Date(priceList.expiryDate) : null;
      const nowDate = now.toDate();
      if (expiryDate && expiryDate < nowDate) {
        return null;
      }
      
      return priceList;
    } catch (error) {
      log.error('Error fetching active price list:', { data: error }, 'pricing');
      throw error;
    }
  }

  /**
   * Update price list items
   */
  static async updatePriceList(id: string, items: PriceListItem[]): Promise<void> {
    try {
      const docRef = doc(db, PRICE_LISTS_COLLECTION, id);
      const snapshot = await getDoc(docRef);
      
      if (!snapshot.exists()) {
        throw new Error('Price list not found');
      }
      
      const currentData = snapshot.data();
      
      await updateDoc(docRef, {
        items,
        version: (currentData.version || 1) + 1,
        updatedAt: Timestamp.now(),
        approvedBy: 'current-user-id', // TODO: Get from auth context
        approvedDate: Timestamp.now()
      });
    } catch (error) {
      log.error('Error updating price list:', { data: error }, 'pricing');
      throw error;
    }
  }

  /**
   * Bulk update product prices
   */
  static async bulkUpdatePrices(supplierId: string, priceAdjustment: PriceAdjustment): Promise<void> {
    try {
      let q = query(
        collection(db, PRODUCTS_COLLECTION),
        where('supplierId', '==', supplierId)
      );
      
      if (priceAdjustment.category) {
        q = query(q, where('category', '==', priceAdjustment.category));
      }
      
      const snapshot = await getDocs(q);
      
      const batch = snapshot.docs.map(async (docSnapshot: { id: string; data: () => Record<string, unknown> }) => {
        const product = docSnapshot.data() as unknown as Product;
        let newPrice = product.pricing.unitPrice;
        
        if (priceAdjustment.type === 'percentage') {
          newPrice = product.pricing.unitPrice * (1 + priceAdjustment.value / 100);
        } else {
          newPrice = product.pricing.unitPrice + priceAdjustment.value;
        }
        
        await updateDoc(doc(db, PRODUCTS_COLLECTION, docSnapshot.id), {
          unitPrice: newPrice,
          updatedAt: Timestamp.now()
        });
      });
      
      await Promise.all(batch);
    } catch (error) {
      log.error('Error bulk updating prices:', { data: error }, 'pricing');
      throw error;
    }
  }
}