/**
 * Pole Status Management Service
 * Handles status updates and history tracking
 */

import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { PoleStatusHistory, POLE_COLLECTION } from './types';

export class PoleStatusService {
  /**
   * Update pole status with history tracking
   */
  static async updateStatus(
    id: string,
    newStatus: string,
    changedBy: string,
    notes?: string
  ): Promise<void> {
    const poleRef = doc(db, POLE_COLLECTION, id);
    const existingDoc = await getDoc(poleRef);
    
    if (!existingDoc.exists()) {
      throw new Error('Pole not found');
    }

    const currentData = existingDoc.data();
    const currentStatus = currentData.status;
    
    // Only update if status actually changed
    if (currentStatus === newStatus) {
      return;
    }

    // Build status history entry
    const statusEntry: PoleStatusHistory = {
      status: newStatus,
      timestamp: new Date(),
      changedBy,
      previousStatus: currentStatus,
      ...(notes && { notes })
    };

    const statusHistory = currentData.statusHistory || [];
    statusHistory.push(statusEntry);

    await updateDoc(poleRef, {
      status: newStatus,
      statusHistory,
      'metadata.updatedAt': serverTimestamp()
    });
  }

  /**
   * Get status history for a pole
   */
  static async getStatusHistory(id: string): Promise<PoleStatusHistory[]> {
    const docSnap = await getDoc(doc(db, POLE_COLLECTION, id));
    
    if (!docSnap.exists()) {
      throw new Error('Pole not found');
    }

    return docSnap.data().statusHistory || [];
  }

  /**
   * Bulk update status for multiple poles
   */
  static async bulkUpdateStatus(
    poleIds: string[],
    newStatus: string,
    changedBy: string
  ): Promise<void> {
    const updates = poleIds.map(id =>
      this.updateStatus(id, newStatus, changedBy, 'Bulk status update')
    );

    await Promise.all(updates);
  }

  /**
   * Get latest status change
   */
  static async getLatestStatusChange(id: string): Promise<PoleStatusHistory | null> {
    const history = await this.getStatusHistory(id);
    return history.length > 0 ? history[history.length - 1] : null;
  }

  /**
   * Revert to previous status
   */
  static async revertStatus(id: string, changedBy: string): Promise<void> {
    const history = await this.getStatusHistory(id);
    
    if (history.length < 2) {
      throw new Error('No previous status to revert to');
    }

    const previousEntry = history[history.length - 2]!;
    await this.updateStatus(
      id,
      previousEntry.status,
      changedBy,
      'Status reverted'
    );
  }
}