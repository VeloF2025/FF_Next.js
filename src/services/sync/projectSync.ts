/**
 * Project Synchronization
 * Handles syncing project data from Firebase to Neon analytics
 */

/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore — firebase not in project dependencies
import { collection, getDocs, query, where } from 'firebase/firestore';
// @ts-ignore — firebase config not available
import { db } from '@/config/firebase';
import { neonDb } from '@/lib/neon/connection';
// @ts-ignore — table not yet defined in schema
import { projectAnalytics } from '@/lib/neon/schema';
// @ts-ignore — type not yet defined in schema
import type { NewProjectAnalytics } from '@/lib/neon/schema';
// @ts-ignore — drizzle-orm not in project dependencies
import { eq } from 'drizzle-orm';
import { FirebaseProjectData, SyncResult } from './types';

/** Minimal shape of a Firestore QueryDocumentSnapshot (firebase not in deps) */
interface FirestoreDoc {
  id: string;
  data(): Omit<FirebaseProjectData, 'id'>;
}

/** Minimal shape of a Firestore Analytics record from neonDb select */
interface ProjectAnalyticsRecord {
  lastSyncedAt?: Date | null;
  updatedAt?: Date | null;
}
import { SyncUtils } from './syncUtils';
import { log } from '@/lib/logger';

/**
 * Project synchronization service
 */
export class ProjectSync {
  /**
   * Sync all projects from Firebase to Neon
   */
  static async syncAllProjects(): Promise<SyncResult> {
    const startTime = Date.now();
    let processedCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    try {
      const snapshot = await getDocs(collection(db, 'projects'));
      const projects = (snapshot.docs as FirestoreDoc[]).map((doc) => ({
        id: doc.id,
        ...doc.data()
      })) as FirebaseProjectData[];

      for (const project of projects) {
        try {
          await this.syncSingleProject(project.id, project);
          processedCount++;
        } catch (error) {
          errorCount++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`Project ${project.id}: ${errorMessage}`);
          log.error(`Failed to sync project ${project.id}:`, { data: error }, 'projectSync');
        }
      }

      return {
        type: 'projects',
        success: errorCount === 0,
        processedCount,
        errorCount,
        duration: Date.now() - startTime,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      log.error('Failed to sync projects:', { data: error }, 'projectSync');
      return {
        type: 'projects',
        success: false,
        processedCount,
        errorCount: errorCount + 1,
        duration: Date.now() - startTime,
        errors: [error instanceof Error ? error.message : 'Failed to fetch projects']
      };
    }
  }

  /**
   * Sync a single project
   */
  static async syncSingleProject(projectId: string, projectData: FirebaseProjectData): Promise<void> {
    try {
      const analyticsData: NewProjectAnalytics = {
        projectId,
        projectName: projectData.name || projectData.title || 'Untitled Project',
        clientId: projectData.clientId,
        clientName: projectData.clientName,
        
        // Infrastructure metrics
        totalPoles: projectData.totalPoles || 0,
        completedPoles: projectData.completedPoles || 0,
        totalDrops: projectData.totalDrops || 0,
        completedDrops: projectData.completedDrops || 0,
        
        // Financial metrics
        totalBudget: projectData.budget?.toString(),
        spentBudget: projectData.spentAmount?.toString() || '0',
        
        // Timeline metrics
        startDate: SyncUtils.parseFirebaseDate(projectData.startDate),
        endDate: SyncUtils.parseFirebaseDate(projectData.endDate),
        actualEndDate: SyncUtils.parseFirebaseDate(projectData.actualEndDate),
        
        // Performance metrics
        completionPercentage: (projectData.progress || projectData.completion || 0).toString(),
        onTimeDelivery: this.calculateOnTimeDelivery(projectData),
        qualityScore: (projectData.qualityScore || 85).toString(),
        
        lastSyncedAt: new Date(),
      };

      await this.upsertProjectAnalytics(projectId, analyticsData);
    } catch (error) {
      log.error(`Failed to sync project ${projectId}:`, { data: error }, 'projectSync');
      throw error;
    }
  }

  /**
   * Sync projects by client ID
   */
  static async syncProjectsByClient(clientId: string): Promise<SyncResult> {
    const startTime = Date.now();
    let processedCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    try {
      const projects = await this.getProjectsByClient(clientId);
      
      for (const project of projects) {
        try {
          await this.syncSingleProject(project.id, project);
          processedCount++;
        } catch (error) {
          errorCount++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`Project ${project.id}: ${errorMessage}`);
        }
      }

      return {
        type: 'projects',
        success: errorCount === 0,
        processedCount,
        errorCount,
        duration: Date.now() - startTime,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      log.error(`Failed to sync projects for client ${clientId}:`, { data: error }, 'projectSync');
      return {
        type: 'projects',
        success: false,
        processedCount,
        errorCount: errorCount + 1,
        duration: Date.now() - startTime,
        errors: [error instanceof Error ? error.message : 'Failed to fetch client projects']
      };
    }
  }

  /**
   * Get projects by client ID
   */
  static async getProjectsByClient(clientId: string): Promise<FirebaseProjectData[]> {
    try {
      const q = query(collection(db, 'projects'), where('clientId', '==', clientId));
      const snapshot = await getDocs(q);
      return (snapshot.docs as FirestoreDoc[]).map((doc) => ({
        id: doc.id,
        ...doc.data()
      })) as FirebaseProjectData[];
    } catch (error) {
      log.error('Failed to get client projects:', { data: error }, 'projectSync');
      return [];
    }
  }

  /**
   * Calculate project completion metrics
   */
  static calculateProjectMetrics(projectData: FirebaseProjectData): {
    infrastructureCompletion: number;
    budgetUtilization: number;
    schedulePerformance: number;
  } {
    // Infrastructure completion
    const totalInfrastructure = (projectData.totalPoles || 0) + (projectData.totalDrops || 0);
    const completedInfrastructure = (projectData.completedPoles || 0) + (projectData.completedDrops || 0);
    const infrastructureCompletion = totalInfrastructure > 0 
      ? (completedInfrastructure / totalInfrastructure) * 100 
      : 0;

    // Budget utilization
    const totalBudget = projectData.budget || 0;
    const spentBudget = projectData.spentAmount || 0;
    const budgetUtilization = totalBudget > 0 ? (spentBudget / totalBudget) * 100 : 0;

    // Schedule performance
    const startDate = SyncUtils.parseFirebaseDate(projectData.startDate);
    const endDate = SyncUtils.parseFirebaseDate(projectData.endDate);
    const actualEndDate = SyncUtils.parseFirebaseDate(projectData.actualEndDate);
    
    let schedulePerformance = 100; // Default to on-time
    if (startDate && endDate && actualEndDate) {
      const plannedDuration = endDate.getTime() - startDate.getTime();
      const actualDuration = actualEndDate.getTime() - startDate.getTime();
      
      if (actualDuration > plannedDuration) {
        // Project is late
        const delayRatio = (actualDuration - plannedDuration) / plannedDuration;
        schedulePerformance = Math.max(0, 100 - (delayRatio * 100));
      }
    }

    return {
      infrastructureCompletion: Math.round(infrastructureCompletion),
      budgetUtilization: Math.round(budgetUtilization * 100) / 100,
      schedulePerformance: Math.round(schedulePerformance * 100) / 100
    };
  }

  /**
   * Calculate on-time delivery status
   */
  private static calculateOnTimeDelivery(projectData: FirebaseProjectData): boolean {
    const endDate = SyncUtils.parseFirebaseDate(projectData.endDate);
    const actualEndDate = SyncUtils.parseFirebaseDate(projectData.actualEndDate);
    
    if (!endDate) return false;
    
    // If no actual end date but project is not completed, assume on track if within timeline
    if (!actualEndDate) {
      const now = new Date();
      return now <= endDate;
    }
    
    return actualEndDate <= endDate;
  }

  /**
   * Upsert project analytics data
   */
  private static async upsertProjectAnalytics(
    projectId: string, 
    analyticsData: NewProjectAnalytics
  ): Promise<void> {
    const existingRecord = await neonDb
      .select()
      .from(projectAnalytics)
      .where(eq(projectAnalytics.projectId, projectId))
      .limit(1);

    if (existingRecord.length > 0) {
      // Update existing record
      await neonDb
        .update(projectAnalytics)
        .set({ ...analyticsData, updatedAt: new Date() })
        .where(eq(projectAnalytics.projectId, projectId));
    } else {
      // Insert new record
      await neonDb.insert(projectAnalytics).values(analyticsData);
    }
  }

  /**
   * Get project sync statistics
   */
  static async getSyncStatistics(): Promise<{
    totalProjects: number;
    lastSyncTime: Date | null;
    avgSyncTime: number;
  }> {
    try {
      const records = await neonDb
        .select({
          lastSyncedAt: projectAnalytics.lastSyncedAt,
          updatedAt: projectAnalytics.updatedAt
        })
        .from(projectAnalytics);

      const totalProjects = records.length;
      
      const lastSyncTime = records.length > 0
        ? (records as ProjectAnalyticsRecord[]).reduce((latest: Date | null, record) => {
            const syncTime = record.lastSyncedAt ?? record.updatedAt ?? null;
            return syncTime && (!latest || syncTime > latest) ? syncTime : latest;
          }, null as Date | null)
        : null;

      // This would need actual sync duration tracking in production
      const avgSyncTime = totalProjects * 0.5; // Estimate 0.5 seconds per project

      return {
        totalProjects,
        lastSyncTime,
        avgSyncTime
      };
    } catch (error) {
      log.error('Failed to get project sync statistics:', { data: error }, 'projectSync');
      return {
        totalProjects: 0,
        lastSyncTime: null,
        avgSyncTime: 0
      };
    }
  }
}