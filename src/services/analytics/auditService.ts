/**
 * Audit Service
 * Handles audit logging and compliance tracking
 */

import { neonDb } from '@/lib/neon/connection';
// @ts-expect-error — auditLog table not yet defined in schema
import { auditLog } from '@/lib/neon/schema';
// @ts-expect-error — drizzle-orm not in project dependencies
import { eq, and, desc } from 'drizzle-orm';
import type { AuditEntry, AuditChanges, AuditMetadata } from './types';
import { log } from '@/lib/logger';

export class AuditService {
  /**
   * Log user action for audit trail
   */
  async logAction(
    action: string,
    entityType: string,
    entityId: string,
    userId: string,
    userName: string,
    changes?: AuditChanges,
    metadata?: AuditMetadata
  ): Promise<void> {
    try {
      await neonDb.insert(auditLog).values({
        action,
        entityType,
        entityId,
        userId,
        userName,
        oldValue: changes?.old,
        newValue: changes?.new,
        ipAddress: metadata?.ip,
        userAgent: metadata?.userAgent,
        sessionId: metadata?.sessionId,
        source: 'web',
      });
    } catch (error) {
      log.error('Failed to log audit action:', { data: error }, 'auditService');
      // Don't throw - audit logging shouldn't break main functionality
    }
  }

  /**
   * Get audit trail for entity
   */
  async getAuditTrail(
    entityType: string, 
    entityId: string, 
    limit: number = 50
  ): Promise<AuditEntry[]> {
    try {
      const results = await neonDb
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityType, entityType),
            eq(auditLog.entityId, entityId)
          )
        )
        .orderBy(desc(auditLog.timestamp))
        .limit(limit);
      
      // Map database results to AuditEntry type
      return results.map((row: Record<string, unknown>) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        userId: row.userId,
        userName: row.userName || '',
        oldValue: row.oldValue,
        newValue: row.newValue,
        ipAddress: row.ipAddress || '',
        userAgent: row.userAgent || '',
        sessionId: row.sessionId || '',
        source: row.source || '',
        timestamp: row.timestamp
      }));
    } catch (error) {
      log.error('Failed to get audit trail:', { data: error }, 'auditService');
      throw error;
    }
  }
}

// Export singleton instance
export const auditService = new AuditService();