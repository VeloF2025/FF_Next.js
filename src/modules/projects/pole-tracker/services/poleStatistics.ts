import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';

/** Firestore QueryDocumentSnapshot shape (firebase types are ts-ignored) */
interface FirestoreDocSnapshot {
  id: string;
  data: () => Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface PoleStatistics {
  total: number;
  byStatus: Record<string, number>;
  byPhase: Record<string, number>;
  completionRate: number;
  averageDropCount: number;
  photosCompleted: number;
  qualityChecksPassed: number;
  pendingSyncCount: number;
}

export class PoleStatisticsService {
  /**
   * Get statistics for a project
   */
  async getProjectStatistics(projectId: string): Promise<PoleStatistics> {
    const polesRef = collection(db, 'poles');
    const q = query(polesRef, where('projectId', '==', projectId));
    const snapshot = await getDocs(q);

    const stats: PoleStatistics = {
      total: snapshot.size,
      byStatus: {},
      byPhase: {},
      completionRate: 0,
      averageDropCount: 0,
      photosCompleted: 0,
      qualityChecksPassed: 0,
      pendingSyncCount: 0
    };

    let totalDropCount = 0;
    let completedCount = 0;
    let photosCompletedCount = 0;
    let qualityPassedCount = 0;

    snapshot.forEach((doc: FirestoreDocSnapshot) => {
      const data = doc.data();
      
      // Status counts
      const status = data.status || 'pending';
      stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
      
      // Phase counts
      const phase = data.phase || 'Unknown';
      stats.byPhase[phase] = (stats.byPhase[phase] || 0) + 1;
      
      // Completion tracking
      if (status === 'completed') {
        completedCount++;
      }
      
      // Drop count
      totalDropCount += data.dropCount || 0;
      
      // Photos check
      if (data.photos) {
        const photoValues = Object.values(data.photos);
        if (photoValues.every(photo => photo !== null)) {
          photosCompletedCount++;
        }
      }
      
      // Quality checks
      if (data.qualityChecks) {
        const checkValues = Object.values(data.qualityChecks);
        if (checkValues.every(check => check === true)) {
          qualityPassedCount++;
        }
      }
      
      // Sync status
      if (data.metadata?.syncStatus === 'pending') {
        stats.pendingSyncCount++;
      }
    });

    // Calculate averages and rates
    if (stats.total > 0) {
      stats.completionRate = Math.round((completedCount / stats.total) * 100);
      stats.averageDropCount = Math.round(totalDropCount / stats.total);
      stats.photosCompleted = photosCompletedCount;
      stats.qualityChecksPassed = qualityPassedCount;
    }

    return stats;
  }

  /**
   * Get daily progress statistics
   */
  async getDailyProgress(projectId: string, days: number = 7): Promise<Array<{
    date: Date;
    completed: number;
    started: number;
  }>> {
    const polesRef = collection(db, 'poles');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const q = query(
      polesRef,
      where('projectId', '==', projectId),
      where('metadata.lastUpdated', '>=', Timestamp.fromDate(startDate))
    );
    
    const snapshot = await getDocs(q);
    const dailyStats = new Map<string, { completed: number; started: number }>();

    snapshot.forEach((doc: FirestoreDocSnapshot) => {
      const data = doc.data();
      const date = data.metadata?.lastUpdated?.toDate();
      
      if (date) {
        const dateKey = date.toISOString().split('T')[0];
        const existing = dailyStats.get(dateKey) || { completed: 0, started: 0 };
        
        if (data.status === 'completed') {
          existing.completed++;
        } else if (data.status === 'in_progress') {
          existing.started++;
        }
        
        dailyStats.set(dateKey, existing);
      }
    });

    // Convert to array and fill missing days
    const result = [];
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];
      const stats = dailyStats.get(dateKey) || { completed: 0, started: 0 };
      
      result.unshift({
        date,
        completed: stats.completed,
        started: stats.started
      });
    }

    return result;
  }

  /**
   * Get poles requiring attention
   */
  async getPolesRequiringAttention(projectId: string): Promise<Array<{
    id: string;
    poleNumber: string;
    issue: string;
  }>> {
    const polesRef = collection(db, 'poles');
    const q = query(polesRef, where('projectId', '==', projectId));
    const snapshot = await getDocs(q);
    
    const issues: Array<{ id: string; poleNumber: string; issue: string }> = [];

    snapshot.forEach((doc: FirestoreDocSnapshot) => {
      const data = doc.data();
      
      // Check for quality failures
      if (data.qualityChecks) {
        const failedChecks = Object.entries(data.qualityChecks)
          .filter(([, value]) => value === false)
          .map(([key]) => key);
          
        if (failedChecks.length > 0) {
          issues.push({
            id: doc.id,
            poleNumber: data.poleNumber,
            issue: `Failed quality checks: ${failedChecks.join(', ')}`
          });
        }
      }
      
      // Check for missing photos
      if (data.photos) {
        const missingPhotos = Object.entries(data.photos)
          .filter(([, value]) => value === null)
          .map(([key]) => key);
          
        if (missingPhotos.length > 0 && data.status === 'in_progress') {
          issues.push({
            id: doc.id,
            poleNumber: data.poleNumber,
            issue: `Missing photos: ${missingPhotos.join(', ')}`
          });
        }
      }
      
      // Check for sync issues
      if (data.metadata?.syncStatus === 'error') {
        issues.push({
          id: doc.id,
          poleNumber: data.poleNumber,
          issue: 'Sync error - data not uploaded'
        });
      }
    });

    return issues;
  }
}

export const poleStatisticsService = new PoleStatisticsService();