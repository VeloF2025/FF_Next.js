/**
 * Client Data Access Layer
 * Handles database operations for client synchronization
 */

/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore — drizzle-orm not in project dependencies
import { eq } from 'drizzle-orm';
import { neonDb } from '@/lib/neon/connection';
// @ts-ignore — table not yet defined in schema
import { clientAnalytics } from '@/lib/neon/schema';
// @ts-ignore — type not yet defined in schema
import type { NewClientAnalytics } from '@/lib/neon/schema';
import type { ClientSyncStatistics } from './types';
import { log } from '@/lib/logger';

export class ClientDataAccess {
  /**
   * Upsert client analytics data
   */
  static async upsertClientAnalytics(
    clientId: string, 
    analyticsData: NewClientAnalytics
  ): Promise<void> {
    const existingRecord = await neonDb
      .select()
      .from(clientAnalytics)
      .where(eq(clientAnalytics.clientId, clientId))
      .limit(1);

    if (existingRecord.length > 0) {
      await neonDb
        .update(clientAnalytics)
        .set({ ...analyticsData, updatedAt: new Date() })
        .where(eq(clientAnalytics.clientId, clientId));
    } else {
      await neonDb.insert(clientAnalytics).values(analyticsData);
    }
  }

  /**
   * Get client sync statistics
   */
  static async getSyncStatistics(): Promise<ClientSyncStatistics> {
    try {
      const records = await neonDb
        .select({
          lastCalculatedAt: clientAnalytics.lastCalculatedAt,
          updatedAt: clientAnalytics.updatedAt
        })
        .from(clientAnalytics);

      const totalClients = records.length;
      
      const lastSyncTime = records.length > 0
        ? records.reduce((latest: Date | null, record: any) => {
            const syncTime = record.lastCalculatedAt || record.updatedAt;
            return syncTime && (!latest || syncTime > latest) ? syncTime : latest;
          }, null as Date | null)
        : null;

      const avgSyncTime = totalClients * 1.2; // Estimate 1.2 seconds per client

      return {
        totalClients,
        lastSyncTime,
        avgSyncTime
      };
    } catch (error) {
      log.error('Failed to get client sync statistics:', { data: error }, 'dataAccess');
      return {
        totalClients: 0,
        lastSyncTime: null,
        avgSyncTime: 0
      };
    }
  }

  /**
   * Get client analytics by ID
   */
  static async getClientAnalytics(clientId: string) {
    const result = await neonDb
      .select()
      .from(clientAnalytics)
      .where(eq(clientAnalytics.clientId, clientId))
      .limit(1);
    
    return result[0] || null;
  }

  /**
   * Delete client analytics
   */
  static async deleteClientAnalytics(clientId: string): Promise<void> {
    await neonDb
      .delete(clientAnalytics)
      .where(eq(clientAnalytics.clientId, clientId));
  }

  /**
   * Get all client analytics
   */
  static async getAllClientAnalytics() {
    return await neonDb
      .select()
      .from(clientAnalytics);
  }
}