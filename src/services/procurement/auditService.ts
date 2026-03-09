/**
 * Audit Service — Lightweight neon-serverless audit trail for procurement entities.
 * Uses raw SQL (matching API route patterns) rather than Drizzle ORM.
 *
 * For the batching/Drizzle-based logger, see ./audit/AuditLoggerCore.ts.
 * This service is designed for direct use inside API route handlers.
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import type {
  AuditActionValue,
  AuditEntityTypeValue,
  AuditLog,
  AuditLogListItem,
  AuditLogFilter,
} from '@/types/procurement/audit.types';

const sql: any = neon(process.env.DATABASE_URL!);

// ============= Types =============

interface CreateAuditLogParams {
  entityType: AuditEntityTypeValue;
  entityId: string;
  action: AuditActionValue;
  performedBy: string;
  performedByName?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  changedFields?: string[];
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

// ============= Service Functions =============

/**
 * Insert a single audit log row. Fire-and-forget safe — errors are logged, not thrown.
 */
export async function createAuditLog(params: CreateAuditLogParams): Promise<string | null> {
  try {
    const rows = await sql`
      INSERT INTO audit_logs (
        entity_type,
        entity_id,
        action,
        performed_by,
        performed_by_name,
        old_values,
        new_values,
        changed_fields,
        reason,
        ip_address,
        user_agent
      ) VALUES (
        ${params.entityType},
        ${params.entityId},
        ${params.action},
        ${params.performedBy},
        ${params.performedByName ?? null},
        ${params.oldValues ? JSON.stringify(params.oldValues) : null},
        ${params.newValues ? JSON.stringify(params.newValues) : null},
        ${params.changedFields ?? null},
        ${params.reason ?? null},
        ${params.ipAddress ?? null},
        ${params.userAgent ?? null}
      )
      RETURNING id
    `;
    return (rows[0]?.id as string) ?? null;
  } catch (error) {
    log.error('[AuditService] Failed to create audit log', { data: error }, 'auditService');
    return null;
  }
}

/**
 * Fetch audit logs for a specific entity.
 */
export async function getAuditLogs(
  entityType: AuditEntityTypeValue,
  entityId: string,
  limit = 50,
  offset = 0,
): Promise<AuditLog[]> {
  const rows = await sql`
    SELECT *
    FROM audit_logs
    WHERE entity_type = ${entityType}
      AND entity_id = ${entityId}::uuid
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return rows.map(mapRowToAuditLog);
}

/**
 * Fetch all audit actions performed by a specific user.
 */
export async function getAuditLogsByUser(
  userId: string,
  limit = 50,
  offset = 0,
): Promise<AuditLog[]> {
  const rows = await sql`
    SELECT *
    FROM audit_logs
    WHERE performed_by = ${userId}::uuid
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return rows.map(mapRowToAuditLog);
}

/**
 * Paginated, filterable audit log listing.
 */
export async function listAuditLogs(
  filter: AuditLogFilter,
  page = 1,
  pageSize = 50,
): Promise<{ items: AuditLogListItem[]; total: number }> {
  const offset = (page - 1) * pageSize;

  // Build WHERE clauses — explicit branches to avoid conditional SQL fragments
  let rows: Record<string, unknown>[];
  let countRows: Record<string, unknown>[];

  if (filter.entityType && filter.entityId) {
    rows = await sql`
      SELECT * FROM audit_logs
      WHERE entity_type = ${filter.entityType}
        AND entity_id = ${filter.entityId}::uuid
      ORDER BY created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    countRows = await sql`
      SELECT COUNT(*)::int AS total FROM audit_logs
      WHERE entity_type = ${filter.entityType}
        AND entity_id = ${filter.entityId}::uuid
    `;
  } else if (filter.entityType && filter.action) {
    rows = await sql`
      SELECT * FROM audit_logs
      WHERE entity_type = ${filter.entityType}
        AND action = ${filter.action}
      ORDER BY created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    countRows = await sql`
      SELECT COUNT(*)::int AS total FROM audit_logs
      WHERE entity_type = ${filter.entityType}
        AND action = ${filter.action}
    `;
  } else if (filter.entityType) {
    rows = await sql`
      SELECT * FROM audit_logs
      WHERE entity_type = ${filter.entityType}
      ORDER BY created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    countRows = await sql`
      SELECT COUNT(*)::int AS total FROM audit_logs
      WHERE entity_type = ${filter.entityType}
    `;
  } else if (filter.action) {
    rows = await sql`
      SELECT * FROM audit_logs
      WHERE action = ${filter.action}
      ORDER BY created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    countRows = await sql`
      SELECT COUNT(*)::int AS total FROM audit_logs
      WHERE action = ${filter.action}
    `;
  } else if (filter.performedBy) {
    rows = await sql`
      SELECT * FROM audit_logs
      WHERE performed_by = ${filter.performedBy}::uuid
      ORDER BY created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    countRows = await sql`
      SELECT COUNT(*)::int AS total FROM audit_logs
      WHERE performed_by = ${filter.performedBy}::uuid
    `;
  } else {
    rows = await sql`
      SELECT * FROM audit_logs
      ORDER BY created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    countRows = await sql`
      SELECT COUNT(*)::int AS total FROM audit_logs
    `;
  }

  const items: AuditLogListItem[] = rows.map(mapRowToListItem);
  const total = Number(countRows[0]?.total ?? 0);

  return { items, total };
}

// ============= Row Mappers =============

function mapRowToAuditLog(r: Record<string, unknown>): AuditLog {
  return {
    id: r.id as string,
    entityType: r.entity_type as AuditEntityTypeValue,
    entityId: r.entity_id as string,
    action: r.action as AuditActionValue,
    performedBy: r.performed_by as string,
    performedByName: r.performed_by_name as string | undefined,
    performedAt: new Date(r.created_at as string),
    previousValue: r.old_values as Record<string, unknown> | undefined,
    newValue: r.new_values as Record<string, unknown> | undefined,
    changedFields: r.changed_fields as string[] | undefined,
    reason: r.reason as string | undefined,
    ipAddress: r.ip_address as string | undefined,
    userAgent: r.user_agent as string | undefined,
    createdAt: new Date(r.created_at as string),
  };
}

function mapRowToListItem(r: Record<string, unknown>): AuditLogListItem {
  return {
    id: r.id as string,
    entityType: r.entity_type as AuditEntityTypeValue,
    entityId: r.entity_id as string,
    action: r.action as AuditActionValue,
    performedByName: r.performed_by_name as string | undefined,
    performedAt: new Date(r.created_at as string),
    changedFields: r.changed_fields as string[] | undefined,
  };
}
