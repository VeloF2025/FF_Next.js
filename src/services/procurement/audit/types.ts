/**
 * Audit System Types and Enums
 * Type definitions for the procurement audit logging system
 */

// Audit action types
export enum AuditAction {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  VIEW = 'view',
  EXPORT = 'export',
  IMPORT = 'import',
  APPROVE = 'approve',
  REJECT = 'reject',
  ISSUE = 'issue',
  CLOSE = 'close',
  AWARD = 'award',
  INVITE = 'invite',
  SUBMIT = 'submit',
  EVALUATE = 'evaluate'
}

// Entity types for procurement
export enum AuditEntityType {
  BOQ = 'boq',
  BOQ_ITEM = 'boq_item',
  BOQ_EXCEPTION = 'boq_exception',
  RFQ = 'rfq',
  RFQ_ITEM = 'rfq_item',
  QUOTE = 'quote',
  QUOTE_ITEM = 'quote_item',
  SUPPLIER_INVITATION = 'supplier_invitation',
  STOCK_POSITION = 'stock_position',
  STOCK_MOVEMENT = 'stock_movement',
  CABLE_DRUM = 'cable_drum',
  PROCUREMENT_REPORT = 'procurement_report'
}

// Audit context interface
export interface AuditContext {
  userId: string;
  userName?: string;
  userRole?: string;
  projectId?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  source?: 'web' | 'mobile' | 'api';
}

// Audit trail query options
export interface AuditTrailOptions {
  limit?: number;
  offset?: number;
  actions?: string[];
  dateFrom?: Date;
  dateTo?: Date;
}

// Audit summary result
export interface AuditSummary {
  totalActions: number;
  actionsByType: Record<string, number>;
  actionsByUser: Record<string, number>;
  recentActions: unknown[];
}

// Security event types
export type SecurityEventType = 
  | 'access_denied' 
  | 'invalid_token' 
  | 'permission_escalation' 
  | 'suspicious_activity';