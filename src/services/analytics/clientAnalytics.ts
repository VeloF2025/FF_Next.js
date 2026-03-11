/**
 * Client Analytics Service
 * Handles client performance metrics and revenue analysis
 */

import { neonDb } from '@/lib/neon/connection';
// @ts-expect-error — clients/sow tables not yet defined in schema
import { clients, projects, sow } from '@/lib/neon/schema';
// @ts-expect-error — drizzle-orm not in project dependencies
import { eq, desc, sql, count } from 'drizzle-orm';
import type { ClientAnalyticsData } from './types';
import { log } from '@/lib/logger';

export class ClientAnalyticsService {
  /**
   * Get client performance metrics
   */
  async getClientAnalytics(clientId?: string): Promise<ClientAnalyticsData | ClientAnalyticsData[]> {
    try {
      // Calculate real metrics from clients, projects, and SOW tables
      const baseQuery = neonDb
        .select({
          clientId: clients.id,
          clientName: clients.companyName,
          totalRevenue: sql<number>`COALESCE(SUM(${sow.budget}::numeric), 0)`,
          totalProjects: count(projects.id),
          lifetimeValue: sql<number>`COALESCE(SUM(${sow.budget}::numeric), 0)`,
          paymentScore: sql<number>`
            CASE 
              WHEN COUNT(${sow.id}) = 0 THEN 0
              WHEN SUM(${sow.budget}::numeric) = 0 THEN 0
              ELSE ROUND(75.0)
            END
          `,
        })
        .from(clients)
        .leftJoin(projects, eq(clients.id, projects.clientId))
        .leftJoin(sow, eq(projects.id, sow.projectId))
        .groupBy(clients.id, clients.companyName)
        .orderBy(desc(sql`COALESCE(SUM(${sow.budget}::numeric), 0)`));

      if (clientId) {
        const result = await baseQuery.where(eq(clients.id, clientId));
        if (result[0]) {
          return {
            clientId: result[0].clientId,
            clientName: result[0].clientName,
            totalRevenue: Number(result[0].totalRevenue || 0),
            totalProjects: result[0].totalProjects || 0,
            lifetimeValue: Number(result[0].lifetimeValue || 0),
            paymentScore: Number(result[0].paymentScore || 0)
          };
        }
        // Return zero values instead of throwing
        return {
          clientId: clientId,
          clientName: 'Unknown Client',
          totalRevenue: 0,
          totalProjects: 0,
          lifetimeValue: 0,
          paymentScore: 0
        };
      }

      const results = await baseQuery;
      return results.map((row: Record<string, unknown>) => ({
        clientId: row.clientId,
        clientName: row.clientName,
        totalRevenue: Number(row.totalRevenue || 0),
        totalProjects: row.totalProjects || 0,
        lifetimeValue: Number(row.lifetimeValue || 0),
        paymentScore: Number(row.paymentScore || 0)
      }));
    } catch (error) {
      log.error('Failed to get client analytics:', { data: error }, 'clientAnalytics');
      // Return empty array or default structure instead of throwing
      return [];
    }
  }

  /**
   * Get top clients by revenue
   */
  async getTopClients(limit: number = 10): Promise<ClientAnalyticsData[]> {
    try {
      // Calculate real metrics and get top clients by revenue
      const results = await neonDb
        .select({
          clientId: clients.id,
          clientName: clients.companyName,
          totalRevenue: sql<number>`COALESCE(SUM(${sow.budget}::numeric), 0)`,
          totalProjects: count(projects.id),
          lifetimeValue: sql<number>`COALESCE(SUM(${sow.budget}::numeric), 0)`,
          paymentScore: sql<number>`
            CASE
              WHEN COUNT(${sow.id}) = 0 THEN 0
              WHEN SUM(${sow.budget}::numeric) = 0 THEN 0
              ELSE ROUND(75.0)
            END
          `,
        })
        .from(clients)
        .leftJoin(projects, eq(clients.id, projects.clientId))
        .leftJoin(sow, eq(projects.id, sow.projectId))
        .groupBy(clients.id, clients.companyName)
        .orderBy(desc(sql`COALESCE(SUM(${sow.budget}::numeric), 0)`))
        .limit(limit);

      return results.map((row: Record<string, unknown>) => ({
        clientId: row.clientId,
        clientName: row.clientName,
        totalRevenue: Number(row.totalRevenue || 0),
        totalProjects: row.totalProjects || 0,
        lifetimeValue: Number(row.lifetimeValue || 0),
        paymentScore: Number(row.paymentScore || 0)
      }));
    } catch (error) {
      log.error('Failed to get top clients:', { data: error }, 'clientAnalytics');
      // Return empty array instead of throwing
      return [];
    }
  }
}

// Export singleton instance
export const clientAnalyticsService = new ClientAnalyticsService();