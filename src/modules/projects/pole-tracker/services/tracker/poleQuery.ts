/**
 * Pole Query Service
 * Advanced query operations for poles
 */

import {
  collection,
  query,
  where,
  orderBy,
  getDocs
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { Pole, PoleFilters, POLE_COLLECTION } from './types';

/** Firestore QueryDocumentSnapshot shape (firebase types are ts-ignored) */
interface FirestoreDocSnapshot {
  id: string;
  ref: unknown;
  data: () => Record<string, unknown>;
}

export class PoleQueryService {
  /**
   * Get poles for a project with filters
   */
  static async getByProject(
    projectId: string,
    filters?: PoleFilters
  ): Promise<Pole[]> {
    let q = query(
      collection(db, POLE_COLLECTION),
      where('projectId', '==', projectId),
      orderBy('poleNumber')
    );

    // Apply status filter
    if (filters?.status) {
      q = query(q, where('status', '==', filters.status));
    }

    // Apply phase filter
    if (filters?.phase) {
      q = query(q, where('phase', '==', filters.phase));
    }

    const snapshot = await getDocs(q);
    let poles = snapshot.docs.map((doc: FirestoreDocSnapshot) => ({
      id: doc.id,
      ...doc.data()
    } as Pole));

    // Apply search filter (client-side)
    if (filters?.search) {
      const searchLower = filters.search.toLowerCase();
      poles = poles.filter((pole: Pole) =>
        pole.poleNumber.toLowerCase().includes(searchLower) ||
        pole.location.toLowerCase().includes(searchLower)
      );
    }

    return poles;
  }

  /**
   * Get poles by status
   */
  static async getByStatus(
    projectId: string,
    status: string
  ): Promise<Pole[]> {
    const q = query(
      collection(db, POLE_COLLECTION),
      where('projectId', '==', projectId),
      where('status', '==', status),
      orderBy('poleNumber')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc: FirestoreDocSnapshot) => ({
      id: doc.id,
      ...doc.data()
    } as Pole));
  }

  /**
   * Get poles by phase
   */
  static async getByPhase(
    projectId: string,
    phase: string
  ): Promise<Pole[]> {
    const q = query(
      collection(db, POLE_COLLECTION),
      where('projectId', '==', projectId),
      where('phase', '==', phase),
      orderBy('poleNumber')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc: FirestoreDocSnapshot) => ({
      id: doc.id,
      ...doc.data()
    } as Pole));
  }

  /**
   * Search poles by text
   */
  static async searchPoles(
    projectId: string,
    searchText: string
  ): Promise<Pole[]> {
    const q = query(
      collection(db, POLE_COLLECTION),
      where('projectId', '==', projectId),
      orderBy('poleNumber')
    );

    const snapshot = await getDocs(q);
    const searchLower = searchText.toLowerCase();
    
    return snapshot.docs
      .map((doc: FirestoreDocSnapshot) => ({
        id: doc.id,
        ...doc.data()
      } as Pole))
      .filter((pole: Pole) =>
        pole.poleNumber.toLowerCase().includes(searchLower) ||
        pole.location.toLowerCase().includes(searchLower) ||
        pole.phase.toLowerCase().includes(searchLower)
      );
  }

  /**
   * Get poles with issues
   */
  static async getPolesWithIssues(projectId: string): Promise<Pole[]> {
    const q = query(
      collection(db, POLE_COLLECTION),
      where('projectId', '==', projectId),
      where('status', '==', 'issue'),
      orderBy('poleNumber')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc: FirestoreDocSnapshot) => ({
      id: doc.id,
      ...doc.data()
    } as Pole));
  }
}