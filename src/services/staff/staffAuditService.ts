/**
 * Staff Audit Service
 * Records all actions performed on staff records for compliance and auditing
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

export type AuditActionType =
  // Document actions
  | 'document_uploaded'
  | 'document_verified'
  | 'document_rejected'
  | 'document_deleted'
  | 'document_downloaded'
  // Profile actions
  | 'profile_created'
  | 'profile_updated'
  | 'profile_viewed'
  | 'profile_deleted'
  // Data actions
  | 'data_exported'
  | 'report_generated'
  // Access actions
  | 'permission_changed'
  | 'note_added'
  | 'note_deleted';

export interface AuditLogEntry {
  staffId: string;
  actionType: AuditActionType;
  actionDescription: string;
  details?: Record<string, unknown>;
  performedBy?: string;
  performedByName?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Record an audit log entry for a staff action
 * Includes duplicate prevention - skips if same action logged in last 10 seconds
 */
export async function recordAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    // Prevent duplicates - check if same action was logged in last 10 seconds
    const [existing] = await sql`
      SELECT id FROM staff_audit_log
      WHERE staff_id = ${entry.staffId}::uuid
        AND action_type = ${entry.actionType}
        AND action_description = ${entry.actionDescription}
        AND created_at > NOW() - INTERVAL '10 seconds'
      LIMIT 1
    `;

    if (existing) {
      log.debug('Skipping duplicate audit log', {
        staffId: entry.staffId,
        action: entry.actionType,
      });
      return;
    }

    await sql`
      INSERT INTO staff_audit_log (
        staff_id, action_type, action_description, details,
        performed_by, performed_by_name, ip_address, user_agent
      ) VALUES (
        ${entry.staffId}::uuid,
        ${entry.actionType},
        ${entry.actionDescription},
        ${JSON.stringify(entry.details || {})}::jsonb,
        ${entry.performedBy || null}::uuid,
        ${entry.performedByName || null},
        ${entry.ipAddress || null},
        ${entry.userAgent || null}
      )
    `;

    log.debug('Audit log recorded', {
      staffId: entry.staffId,
      action: entry.actionType,
    });
  } catch (error) {
    // Don't fail the main operation if audit logging fails
    log.error('Failed to record audit log', {
      staffId: entry.staffId,
      action: entry.actionType,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Get audit log entries for a staff member
 */
export async function getAuditLog(
  staffId: string,
  options?: {
    limit?: number;
    offset?: number;
    actionTypes?: AuditActionType[];
  }
): Promise<{
  entries: Array<{
    id: string;
    actionType: AuditActionType;
    actionDescription: string;
    details: Record<string, unknown>;
    performedByName: string | null;
    createdAt: string;
  }>;
  total: number;
}> {
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  // Get entries
  const entries = await sql`
    SELECT
      id,
      action_type as "actionType",
      action_description as "actionDescription",
      details,
      performed_by_name as "performedByName",
      created_at as "createdAt"
    FROM staff_audit_log
    WHERE staff_id = ${staffId}::uuid
    ${options?.actionTypes?.length ? sql`AND action_type = ANY(${options.actionTypes})` : sql``}
    ORDER BY created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  // Get total count
  const [countResult] = await sql`
    SELECT COUNT(*) as total
    FROM staff_audit_log
    WHERE staff_id = ${staffId}::uuid
    ${options?.actionTypes?.length ? sql`AND action_type = ANY(${options.actionTypes})` : sql``}
  `;

  return {
    entries: entries as Array<{
      id: string;
      actionType: AuditActionType;
      actionDescription: string;
      details: Record<string, unknown>;
      performedByName: string | null;
      createdAt: string;
    }>,
    total: parseInt(countResult.total as string),
  };
}

// Convenience functions for common actions

export async function logDocumentUploaded(
  staffId: string,
  documentType: string,
  documentName: string,
  performedByName?: string,
  ipAddress?: string
): Promise<void> {
  await recordAuditLog({
    staffId,
    actionType: 'document_uploaded',
    actionDescription: `Uploaded ${documentType.replace(/_/g, ' ')}: ${documentName}`,
    details: { documentType, documentName },
    performedByName,
    ipAddress,
  });
}

export async function logDocumentVerified(
  staffId: string,
  documentType: string,
  syncedFields: string[],
  performedByName?: string,
  ipAddress?: string
): Promise<void> {
  await recordAuditLog({
    staffId,
    actionType: 'document_verified',
    actionDescription: `Verified ${documentType.replace(/_/g, ' ')} - ${syncedFields.length} fields synced`,
    details: { documentType, syncedFields },
    performedByName,
    ipAddress,
  });
}

export async function logDocumentRejected(
  staffId: string,
  documentType: string,
  reason: string,
  performedByName?: string,
  ipAddress?: string
): Promise<void> {
  await recordAuditLog({
    staffId,
    actionType: 'document_rejected',
    actionDescription: `Rejected ${documentType.replace(/_/g, ' ')}: ${reason}`,
    details: { documentType, reason },
    performedByName,
    ipAddress,
  });
}

export async function logDocumentDownloaded(
  staffId: string,
  documentType: string,
  documentName: string,
  performedByName?: string,
  ipAddress?: string
): Promise<void> {
  await recordAuditLog({
    staffId,
    actionType: 'document_downloaded',
    actionDescription: `Downloaded ${documentType.replace(/_/g, ' ')}: ${documentName}`,
    details: { documentType, documentName },
    performedByName,
    ipAddress,
  });
}

export async function logProfileUpdated(
  staffId: string,
  changedFields: string[],
  performedByName?: string,
  ipAddress?: string
): Promise<void> {
  await recordAuditLog({
    staffId,
    actionType: 'profile_updated',
    actionDescription: `Updated profile: ${changedFields.slice(0, 3).join(', ')}${changedFields.length > 3 ? ` +${changedFields.length - 3} more` : ''}`,
    details: { changedFields },
    performedByName,
    ipAddress,
  });
}

export async function logDataExported(
  staffId: string,
  exportType: string,
  performedByName?: string,
  ipAddress?: string
): Promise<void> {
  await recordAuditLog({
    staffId,
    actionType: 'data_exported',
    actionDescription: `Exported staff data as ${exportType}`,
    details: { exportType },
    performedByName,
    ipAddress,
  });
}

export async function logNoteAdded(
  staffId: string,
  noteTitle: string,
  performedByName?: string,
  ipAddress?: string
): Promise<void> {
  await recordAuditLog({
    staffId,
    actionType: 'note_added',
    actionDescription: `Added note: ${noteTitle}`,
    details: { noteTitle },
    performedByName,
    ipAddress,
  });
}
