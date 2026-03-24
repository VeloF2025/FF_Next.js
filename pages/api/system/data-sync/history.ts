/**
 * Data Sync History API
 * Returns unified timeline of all sync/import operations
 *
 * GET /api/system/data-sync/history?limit=50&type=all
 *
 * Query params:
 *   limit  - Max records (default 50, max 200)
 *   type   - Filter by operation type: all | oes_import | arch_import | qcontact_sync | qfield_sync | olt_import
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import type { SyncHistoryEntry, SyncOperationType } from '@/modules/data-sync/types';
import { apiResponse } from '@/lib/apiResponse';

const rawSql = neon(process.env.DATABASE_URL!);

const VALID_TYPES: SyncOperationType[] = [
  'oes_import',
  'arch_import',
  'qcontact_sync',
  'qfield_sync',
  'olt_import',
];

/**
 * Auto-complete QField sync operations stuck in "running" for > 10 minutes.
 * QField syncs are fire-and-forget webhooks that don't callback on completion.
 * Typical sync takes 60-90 seconds, so > 10 min means it's either complete or failed.
 */
async function autoCompleteStaleOperations(): Promise<void> {
  try {
    const result = await rawSql`
      UPDATE data_sync_operations
      SET status = 'success',
          completed_at = NOW(),
          duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::int,
          details = details || '{"auto_completed": true, "reason": "stale_operation_cleanup"}'::jsonb
      WHERE status = 'running'
        AND operation_type = 'qfield_sync'
        AND started_at < NOW() - INTERVAL '10 minutes'
      RETURNING id
    `;
    if (result.length > 0) {
      log.info('DataSyncHistory', `Auto-completed ${result.length} stale QField sync(s)`);
    }
  } catch (err) {
    // Non-fatal - just log and continue
    log.warn('DataSyncHistory', 'Failed to auto-complete stale operations', err);
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const typeFilter = (req.query.type as string) || 'all';

    // Validate typeFilter against allowlist to prevent SQL injection
    if (typeFilter !== 'all' && !VALID_TYPES.includes(typeFilter as SyncOperationType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid type filter. Valid types: all, ${VALID_TYPES.join(', ')}`,
      });
    }

    // Auto-complete stale QField syncs (running > 10 min = likely finished but callback failed)
    await autoCompleteStaleOperations();

    // Build the UNION query across all sources
    const entries = await fetchHistory(limit, typeFilter);

    return res.status(200).json({
      success: true,
      data: entries,
      meta: { limit, type: typeFilter, total: entries.length },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error('Failed to fetch sync history', { error: errMsg });
    return res.status(500).json({ success: false, error: 'Failed to fetch history' });
  }
}

async function fetchHistory(
  limit: number,
  typeFilter: string
): Promise<SyncHistoryEntry[]> {
  // Build individual CTEs for each source
  const parts: string[] = [];

  // Only include relevant sources based on filter
  const includeAll = typeFilter === 'all';

  if (includeAll || typeFilter === 'oes_import') {
    parts.push(`
      SELECT
        id::text,
        'oes_import'::text AS operation_type,
        'success'::text AS status,
        imported_at AS started_at,
        imported_at AS completed_at,
        NULL::numeric AS duration_seconds,
        'Imported ' || COALESCE(total_rows, 0) || ' rows, ' || COALESCE(matched_drops, 0) || ' matched from ' || COALESCE(filename, 'unknown') AS summary,
        jsonb_build_object(
          'filename', filename,
          'total_rows', total_rows,
          'matched_drops', matched_drops,
          'unmatched_drops', unmatched_drops,
          'report_date', report_date
        ) AS details,
        NULL::text AS error_message,
        COALESCE(imported_by, 'manual') AS triggered_by
      FROM oes_import_batches
    `);
  }

  if (includeAll || typeFilter === 'arch_import') {
    parts.push(`
      SELECT
        id::text,
        'arch_import'::text AS operation_type,
        'success'::text AS status,
        imported_at AS started_at,
        imported_at AS completed_at,
        NULL::numeric AS duration_seconds,
        'Imported ' || COALESCE(total_rows, 0) || ' rows, ' || COALESCE(matched_drops, 0) || ' matched from ' || COALESCE(filename, 'unknown') AS summary,
        jsonb_build_object(
          'filename', filename,
          'total_rows', total_rows,
          'matched_drops', matched_drops,
          'matched_oes', matched_oes,
          'serial_mismatches', serial_mismatches,
          'report_date', report_date
        ) AS details,
        NULL::text AS error_message,
        COALESCE(imported_by, 'manual') AS triggered_by
      FROM offline_import_batches
    `);
  }

  if (includeAll || typeFilter === 'qcontact_sync') {
    parts.push(`
      SELECT
        id::text,
        'qcontact_sync'::text AS operation_type,
        status::text,
        started_at,
        completed_at,
        duration_seconds,
        'Processed ' || COALESCE(total_processed, 0) || ' tickets, ' || COALESCE(total_success, 0) || ' synced' AS summary,
        jsonb_build_object(
          'total_processed', total_processed,
          'total_success', total_success,
          'total_failed', total_failed,
          'success_rate', success_rate
        ) AS details,
        error_message::text,
        'cron'::text AS triggered_by
      FROM sync_job_history
    `);
  }

  // data_sync_operations covers qfield_sync, olt_import, and any other tracked ops
  if (includeAll || typeFilter === 'qfield_sync' || typeFilter === 'olt_import') {
    const typeClause = includeAll
      ? ''
      : ` WHERE operation_type = '${typeFilter}'`;
    parts.push(`
      SELECT
        id::text,
        operation_type::text,
        status::text,
        started_at,
        completed_at,
        duration_seconds,
        CASE
          WHEN operation_type = 'qfield_sync' THEN
            'QField sync: ' || COALESCE(details->>'projects_synced', '0') || ' projects, ' || COALESCE(details->>'total_records', '0') || ' records'
          WHEN operation_type = 'olt_import' THEN
            'OLT import: ' || COALESCE(details->>'total_rows', '0') || ' rows from ' || COALESCE(details->>'filename', 'unknown')
          ELSE
            'Operation: ' || operation_type
        END AS summary,
        details,
        error_message,
        triggered_by
      FROM data_sync_operations${typeClause}
    `);
  }

  if (parts.length === 0) {
    return [];
  }

  const unionQuery = parts.join('\nUNION ALL\n');
  const fullQuery = `
    WITH combined AS (
      ${unionQuery}
    )
    SELECT * FROM combined
    ORDER BY started_at DESC
    LIMIT ${limit}
  `;

  const results = await rawSql.query(fullQuery) as Record<string, unknown>[];

  return results.map((row) => ({
    id: row.id as string,
    operation_type: row.operation_type as SyncOperationType,
    status: row.status as SyncHistoryEntry['status'],
    started_at: row.started_at ? String(row.started_at) : new Date().toISOString(),
    completed_at: row.completed_at ? String(row.completed_at) : null,
    duration_seconds: row.duration_seconds ? Number(row.duration_seconds) : null,
    summary: row.summary as string,
    details: (typeof row.details === 'string' ? JSON.parse(row.details) : row.details || {}) as Record<string, unknown>,
    error_message: (row.error_message as string) || null,
    triggered_by: (row.triggered_by as string) || null,
  }));
}

export default withAuth(withErrorHandler(handler));
