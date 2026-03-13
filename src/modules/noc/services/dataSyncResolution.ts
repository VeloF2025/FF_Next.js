/**
 * Data Sync Resolution Service
 *
 * When a NOC ticket is resolved/closed, marks linked records in
 * oes_pp_data and olt_mismatch_records as resolved so they
 * disappear from the Data Sync investigation lists.
 */

import { createLogger } from '@/lib/logger';
import pool from '@/lib/db';

const logger = createLogger('noc:dataSyncResolution');

/**
 * Mark all Data Sync records linked to a ticket as resolved.
 * - oes_pp_data: set resolution_status = 'ticket_resolved'
 * - olt_mismatch_records: set fix_status = 'resolved', resolved_at = NOW()
 */
export async function markLinkedDataSyncResolved(ticketId: string): Promise<void> {
  try {
    // 1. Resolve linked PP Data records
    const ppResult = await pool.query(
      `UPDATE oes_pp_data
       SET resolution_status = 'ticket_resolved', resolved_at = NOW()
       WHERE maintenance_ticket_id = $1
         AND resolution_status NOT IN ('activated', 'ticket_resolved')`,
      [ticketId]
    );

    // 2. Resolve linked OLT mismatch records
    const oltResult = await pool.query(
      `UPDATE olt_mismatch_records
       SET fix_status = 'resolved',
           resolution_type = 'ticket_closed',
           resolution_notes = 'Auto-resolved: linked NOC ticket closed',
           resolved_at = NOW()
       WHERE maintenance_ticket_id = $1
         AND fix_status NOT IN ('fixed', 'resolved')`,
      [ticketId]
    );

    const ppCount = ppResult.rowCount || 0;
    const oltCount = oltResult.rowCount || 0;

    if (ppCount > 0 || oltCount > 0) {
      logger.info('Marked Data Sync records as resolved', {
        ticketId,
        pp_records: ppCount,
        olt_records: oltCount,
      });
    }
  } catch (error) {
    logger.error('Failed to mark Data Sync records as resolved', {
      ticketId,
      error: error instanceof Error ? error.message : 'Unknown',
    });
    throw error;
  }
}
