/**
 * Pole CRUD Operations
 * Basic create, read, update, delete operations for poles
 */

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  query,
  orderBy,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { Pole, POLE_COLLECTION } from './types';

export class PoleCrudService {
  /**
   * Create a new pole
   */
  static async create(data: Omit<Pole, 'id'>): Promise<string> {
    const poleData = {
      ...data,
      metadata: {
        ...data.metadata,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        syncStatus: 'synced'
      }
    };

    const docRef = await addDoc(collection(db, POLE_COLLECTION), poleData);
    return docRef.id;
  }

  /**
   * Update an existing pole
   */
  static async update(id: string, updates: Partial<Pole>): Promise<void> {
    const poleRef = doc(db, POLE_COLLECTION, id);
    
    const updateData = {
      ...updates,
      metadata: {
        ...updates.metadata,
        updatedAt: serverTimestamp()
      }
    };

    await updateDoc(poleRef, updateData);
  }

  /**
   * Delete a pole
   */
  static async delete(id: string): Promise<void> {
    await deleteDoc(doc(db, POLE_COLLECTION, id));
  }

  /**
   * Get all poles
   */
  static async getAll(): Promise<Pole[]> {
    const q = query(collection(db, POLE_COLLECTION), orderBy('poleNumber'));
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map((doc: { id: string; data: () => Record<string, any> }) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      id: doc.id,
      ...doc.data()
    } as Pole));
  }

  /**
   * Get a single pole by ID
   */
  static async getById(id: string): Promise<Pole | null> {
    const docSnap = await getDoc(doc(db, POLE_COLLECTION, id));
    
    if (!docSnap.exists()) {
      return null;
    }

    return {
      id: docSnap.id,
      ...docSnap.data()
    } as Pole;
  }

  /**
   * Check if pole exists
   */
  static async exists(id: string): Promise<boolean> {
    const docSnap = await getDoc(doc(db, POLE_COLLECTION, id));
    return docSnap.exists();
  }
}