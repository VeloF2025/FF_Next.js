/**
 * Core Audit Logger Implementation
 * Main audit logging functionality with batching and database operations
 */

import { db } from '@/lib/neon/connection';
// @ts-ignore
import { auditLog, type NewAuditLog } from '@/lib/neon/schema';
// @ts-ignore
import { eq, and, gte, lte, inArray, desc } from 'drizzle-orm';
import { 
  AuditAction, 
  AuditEntityType, 
  AuditContext, 
  AuditTrailOptions, 
  AuditSummary 
} from './types';
import { generateChangesSummary, sanitizeValue } from './utils';
import { log } from '@/lib/logger';

export class AuditLoggerCore {
  private pendingLogs: NewAuditLog[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 50;
  private readonly BATCH_TIMEOUT = 5000; // 5 seconds

  /**
   * Log a procurement action with full audit trail
   */
  async logAction(
    context: AuditContext,
    action: AuditAction | string,
    entityType: AuditEntityType | string,
    entityId: string,
    oldValue?: any,
    newValue?: any,
    metadata?: Record<string, any>
  ): Promise<void> {
    // Unused parameters are acceptable for interface compliance
    void metadata;
    try {
      // Generate changes summary
      const changesSummary = generateChangesSummary(action, entityType, oldValue, newValue);

      // Create audit log entry
      const auditEntry: NewAuditLog = {
        action,
        entityType,
        entityId,
        userId: context.userId,
        userName: context.userName || 'Unknown User',
        userRole: context.userRole,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        oldValue: oldValue ? sanitizeValue(oldValue) : null,
        newValue: newValue ? sanitizeValue(newValue) : null,
        changesSummary,
        timestamp: new Date(),
        sessionId: context.sessionId,
        source: context.source || 'web'
      };

      // Add to batch for efficient processing
      this.addToBatch(auditEntry);

      // Log to console for debugging (remove in production)
      log.info('[AuditLogger]', { data: {
        action,
        entityType,
        entityId,
        userId: context.userId,
        timestamp: new Date().toISOString()
      } }, 'AuditLoggerCore');
    } catch (error) {
      log.error('[AuditLogger] Failed to log audit entry:', { data: error }, 'AuditLoggerCore');
      // Don't throw error to avoid breaking business logic
    }
  }

  /**
   * Get audit trail for an entity
   */
  async getAuditTrail(
    entityType: AuditEntityType | string,
    entityId: string,
    options: AuditTrailOptions = {}
  ): Promise<any[]> {
    try {
      const { limit = 50, offset = 0 } = options;

      // Build query conditions
      const conditions: any[] = [
        eq(auditLog.entityType, entityType),
        eq(auditLog.entityId, entityId)
      ];

      // Add date filters if provided
      if (options.dateFrom) {
        conditions.push(gte(auditLog.timestamp, options.dateFrom));
      }
      if (options.dateTo) {
        conditions.push(lte(auditLog.timestamp, options.dateTo));
      }

      // Add action filters if provided
      if (options.actions && options.actions.length > 0) {
        conditions.push(inArray(auditLog.action, options.actions));
      }

      // Execute query
      const results = await db
        .select()
        .from(auditLog)
        .where(and(...conditions))
        .orderBy(desc(auditLog.timestamp))
        .limit(limit)
        .offset(offset);

      return results;
    } catch (error) {
      log.error('[AuditLogger] Failed to get audit trail:', { data: error }, 'AuditLoggerCore');
      throw error;
    }
  }

  /**
   * Get audit summary for reporting
   */
  async getAuditSummary(
    projectId?: string,
    dateFrom?: Date,
    dateTo?: Date
  ): Promise<AuditSummary> {
    try {
      // projectId parameter is available for future filtering
      void projectId;
      
      // Build conditions array
      const conditions: any[] = [];
      
      if (dateFrom) {
        conditions.push(gte(auditLog.timestamp, dateFrom));
      }
      if (dateTo) {
        conditions.push(lte(auditLog.timestamp, dateTo));
      }

      const results = await db
        .select()
        .from(auditLog)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(auditLog.timestamp))
        .limit(1000); // Limit for performance

      // Process results
      const actionsByType: Record<string, number> = {};
      const actionsByUser: Record<string, number> = {};

      for (const record of results) {
        // Count by action type
        actionsByType[record.action] = (actionsByType[record.action] || 0) + 1;
        
        // Count by user
        const userKey = record.userName || record.userId;
        actionsByUser[userKey] = (actionsByUser[userKey] || 0) + 1;
      }

      return {
        totalActions: results.length,
        actionsByType,
        actionsByUser,
        recentActions: results.slice(0, 20) // Last 20 actions
      };
    } catch (error) {
      log.error('[AuditLogger] Failed to get audit summary:', { data: error }, 'AuditLoggerCore');
      throw error;
    }
  }

  /**
   * Flush pending logs immediately
   */
  async flush(): Promise<void> {
    if (this.pendingLogs.length > 0) {
      await this.processBatch();
    }
  }

  // ==============================================
  // PRIVATE HELPER METHODS
  // ==============================================

  /**
   * Add audit entry to batch for efficient processing
   */
  private addToBatch(auditEntry: NewAuditLog): void {
    this.pendingLogs.push(auditEntry);

    // Process batch if it's full
    if (this.pendingLogs.length >= this.BATCH_SIZE) {
      this.processBatch();
      return;
    }

    // Set timeout to process batch
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }

    this.batchTimeout = setTimeout(() => {
      this.processBatch();
    }, this.BATCH_TIMEOUT);
  }

  /**
   * Process batch of audit logs
   */
  private async processBatch(): Promise<void> {
    if (this.pendingLogs.length === 0) {
      return;
    }

    const logsToProcess = [...this.pendingLogs];
    this.pendingLogs = [];

    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    try {
      await db.insert(auditLog).values(logsToProcess);

    } catch (error) {
      log.error('[AuditLogger] Failed to process audit log batch:', { data: error }, 'AuditLoggerCore');
      
      // Re-add failed logs to queue for retry
      this.pendingLogs.unshift(...logsToProcess);
    }
  }
}