/**
 * Audit Log Types - Procurement audit trail
 * Tracks all create/update/delete/approve/reject actions across procurement entities
 */

// ============= Enums =============

export enum AuditAction {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  APPROVE = 'approve',
  REJECT = 'reject',
  OVERRIDE = 'override',
  REVERSE = 'reverse',
}

export type AuditActionValue =
  | 'create'
  | 'update'
  | 'delete'
  | 'approve'
  | 'reject'
  | 'override'
  | 'reverse';

export enum AuditEntityType {
  PURCHASE_ORDER = 'purchase_order',
  GOODS_RECEIPT = 'goods_receipt',
  STOCK_MOVEMENT = 'stock_movement',
  STOCK_SERIAL = 'stock_serial',
  FAULT_REPORT = 'fault_report',
  BOQ = 'boq',
  RFQ = 'rfq',
  PICKING = 'picking',
  REQUISITION = 'requisition',
}

export type AuditEntityTypeValue =
  | 'purchase_order'
  | 'goods_receipt'
  | 'stock_movement'
  | 'stock_serial'
  | 'fault_report'
  | 'boq'
  | 'rfq'
  | 'picking'
  | 'requisition';

// ============= Core Interfaces =============

/** Full audit log record matching DB table (camelCase) */
export interface AuditLog {
  id: string;

  // What was affected
  entityType: AuditEntityTypeValue;
  entityId: string;
  entityLabel?: string;

  // What happened
  action: AuditActionValue;

  // Who did it
  performedBy: string;
  performedByName?: string;
  performedAt: Date;

  // Change payload
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  changedFields?: string[];

  // Context
  projectId?: string;
  ipAddress?: string;
  userAgent?: string;
  reason?: string;

  // Timestamps
  createdAt: Date;
}

// ============= List / Filter Types =============

/** Lightweight row for audit log table display */
export interface AuditLogListItem {
  id: string;
  entityType: AuditEntityTypeValue;
  entityId: string;
  entityLabel?: string;
  action: AuditActionValue;
  performedByName?: string;
  performedAt: Date;
  changedFields?: string[];
  projectId?: string;
}

/** Filter parameters for audit log queries */
export interface AuditLogFilter {
  entityType?: AuditEntityTypeValue;
  entityId?: string;
  action?: AuditActionValue;
  performedBy?: string;
  projectId?: string;
  startDate?: Date;
  endDate?: Date;
  searchTerm?: string;
}

/** Aggregated audit summary for dashboards */
export interface AuditSummary {
  totalActions: number;
  actionsByType: Record<AuditActionValue, number>;
  actionsByEntity: Record<AuditEntityTypeValue, number>;
  recentActivity: AuditLogListItem[];
}
