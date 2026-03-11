/**
 * Client Sync Core Service
 * Core synchronization logic for clients
 */

/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore — firebase not in project dependencies
import { collection, getDocs } from 'firebase/firestore';
// @ts-ignore — firebase config not available
import { db } from '@/config/firebase';
// @ts-ignore — type not yet defined in schema
import type { NewClientAnalytics } from '@/lib/neon/schema';
import { ProjectSync } from '../projectSync';
import { SyncUtils } from '../syncUtils';
import { ClientMetricsCalculator } from './metrics';
import { ClientClassification } from './classification';
import { ClientDataAccess } from './dataAccess';
import type { FirebaseClientData, SyncResult } from './types';
import { log } from '@/lib/logger';

export class ClientSyncCore {
  /**
   * Sync all clients from Firebase to Neon
   */
  static async syncAllClients(): Promise<SyncResult> {
    const startTime = Date.now();
    let processedCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    try {
      const snapshot = await getDocs(collection(db, 'clients'));
      const clients = snapshot.docs.map((doc: any) => ({
        id: doc.id, 
        ...doc.data() 
      })) as FirebaseClientData[];

      for (const client of clients) {
        try {
          await this.syncSingleClient(client.id!, client);
          processedCount++;
        } catch (error) {
          errorCount++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`Client ${client.id}: ${errorMessage}`);
          log.error(`Failed to sync client ${client.id}:`, { data: error }, 'clientSyncCore');
        }
      }

      return {
        type: 'clients',
        success: errorCount === 0,
        processedCount,
        errorCount,
        duration: Date.now() - startTime,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      log.error('Failed to sync clients:', { data: error }, 'clientSyncCore');
      return {
        type: 'clients',
        success: false,
        processedCount,
        errorCount: errorCount + 1,
        duration: Date.now() - startTime,
        errors: [error instanceof Error ? error.message : 'Failed to fetch clients']
      };
    }
  }

  /**
   * Sync a single client
   */
  static async syncSingleClient(clientId: string, clientData: FirebaseClientData): Promise<void> {
    try {
      // Calculate client metrics from projects
      const clientProjects = await ProjectSync.getProjectsByClient(clientId);
      const clientMetrics = ClientMetricsCalculator.calculateMetrics(clientProjects);

      const analyticsData: NewClientAnalytics = {
        clientId,
        clientName: clientData.name || 'Unknown Client',
        
        // Project metrics
        totalProjects: clientMetrics.totalProjects,
        activeProjects: clientMetrics.activeProjects,
        completedProjects: clientMetrics.completedProjects,
        
        // Financial metrics
        totalRevenue: clientMetrics.totalRevenue.toString(),
        outstandingBalance: (clientData.currentBalance || 0).toString(),
        averageProjectValue: clientMetrics.averageProjectValue.toString(),
        paymentScore: ClientMetricsCalculator.calculatePaymentScore(clientData),
        
        // Performance metrics
        averageProjectDuration: clientMetrics.averageProjectDuration,
        onTimeCompletionRate: clientMetrics.onTimeCompletionRate.toString(),
        satisfactionScore: (clientData.satisfactionScore || 85).toString(),
        
        // Engagement metrics
        lastProjectDate: clientMetrics.lastProjectDate,
        nextFollowUpDate: SyncUtils.parseFirebaseDate(clientData.nextFollowUpDate),
        totalInteractions: clientData.totalInteractions || 0,
        
        // Classification
        clientCategory: ClientClassification.classifyClient(clientMetrics),
        lifetimeValue: clientMetrics.lifetimeValue.toString(),
        
        lastCalculatedAt: new Date(),
      };

      await ClientDataAccess.upsertClientAnalytics(clientId, analyticsData);
    } catch (error) {
      log.error(`Failed to sync client ${clientId}:`, { data: error }, 'clientSyncCore');
      throw error;
    }
  }
}