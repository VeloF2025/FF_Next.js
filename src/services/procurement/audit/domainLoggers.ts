/**
 * Domain-Specific Audit Loggers
 * Specialized logging methods for different procurement modules
 */

import { AuditAction, AuditEntityType, AuditContext, SecurityEventType } from './types';
import type { AuditLoggerCore } from './AuditLoggerCore';

export class DomainLoggers {
  constructor(private logger: AuditLoggerCore) {}

  /**
   * Log BOQ-specific actions
   */
  async logBOQAction(
    context: AuditContext,
    action: AuditAction,
    boqId: string,
    oldValue?: unknown,
    newValue?: unknown,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.logger.logAction(
      context,
      action,
      AuditEntityType.BOQ,
      boqId,
      oldValue,
      newValue,
      {
        ...metadata,
        module: 'procurement',
        subModule: 'boq'
      }
    );
  }

  /**
   * Log RFQ-specific actions
   */
  async logRFQAction(
    context: AuditContext,
    action: AuditAction,
    rfqId: string,
    oldValue?: unknown,
    newValue?: unknown,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.logger.logAction(
      context,
      action,
      AuditEntityType.RFQ,
      rfqId,
      oldValue,
      newValue,
      {
        ...metadata,
        module: 'procurement',
        subModule: 'rfq'
      }
    );
  }

  /**
   * Log Quote-specific actions
   */
  async logQuoteAction(
    context: AuditContext,
    action: AuditAction,
    quoteId: string,
    oldValue?: unknown,
    newValue?: unknown,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.logger.logAction(
      context,
      action,
      AuditEntityType.QUOTE,
      quoteId,
      oldValue,
      newValue,
      {
        ...metadata,
        module: 'procurement',
        subModule: 'quote'
      }
    );
  }

  /**
   * Log Stock-specific actions
   */
  async logStockAction(
    context: AuditContext,
    action: AuditAction,
    entityType: AuditEntityType.STOCK_POSITION | AuditEntityType.STOCK_MOVEMENT | AuditEntityType.CABLE_DRUM,
    entityId: string,
    oldValue?: unknown,
    newValue?: unknown,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.logger.logAction(
      context,
      action,
      entityType,
      entityId,
      oldValue,
      newValue,
      {
        ...metadata,
        module: 'procurement',
        subModule: 'stock'
      }
    );
  }

  /**
   * Log bulk operations
   */
  async logBulkOperation(
    context: AuditContext,
    action: AuditAction,
    entityType: AuditEntityType | string,
    entityIds: string[],
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const bulkMetadata = {
      ...metadata,
      bulkOperation: true,
      entityCount: entityIds.length,
      entityIds: entityIds.slice(0, 10) // Log first 10 IDs to avoid too much data
    };

    await this.logger.logAction(
      context,
      action,
      entityType,
      'bulk_operation',
      null,
      null,
      bulkMetadata
    );
  }

  /**
   * Log security-related events
   */
  async logSecurityEvent(
    context: AuditContext,
    event: SecurityEventType,
    entityType: AuditEntityType | string,
    entityId: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.logger.logAction(
      context,
      `security_${event}`,
      entityType,
      entityId,
      null,
      null,
      {
        ...metadata,
        securityEvent: true,
        severity: 'high'
      }
    );
  }
}