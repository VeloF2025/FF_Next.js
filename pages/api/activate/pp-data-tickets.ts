/**
 * API Route: /api/activate/pp-data-tickets
 *
 * POST: Create maintenance tickets for selected PP Data records
 * Links located PP records to maintenance tickets for investigation/verification.
 */

import type { NextApiResponse } from 'next';

import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
import pool from '@/lib/db';
import { createTicket } from '@/modules/maintenance/services/ticketService';
import { TicketSource, TicketType, TicketPriority } from '@/modules/maintenance/types/ticket';
import { createLogger } from '@/lib/logger';

const logger = createLogger('activate:pp-data-tickets');

const VALID_TICKET_TYPES: string[] = [
  TicketType.FAULT_REPAIR,
  TicketType.MODIFICATION,
  TicketType.ONT_SWAP,
  TicketType.NEW_INSTALLATION,
];

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { pp_data_ids, ticket_type, priority, notes } = req.body;

  if (!Array.isArray(pp_data_ids) || pp_data_ids.length === 0) {
    return res.status(400).json({ error: 'pp_data_ids must be a non-empty array' });
  }

  if (!ticket_type || !VALID_TICKET_TYPES.includes(ticket_type)) {
    return res.status(400).json({
      error: `ticket_type must be one of: ${VALID_TICKET_TYPES.join(', ')}`,
    });
  }

  const ticketPriority = priority && Object.values(TicketPriority).includes(priority)
    ? priority
    : TicketPriority.NORMAL;

  try {
    // Fetch eligible records: located (has DR) and not yet ticketed
    const eligible = await pool.query(
      `SELECT id, serial_number, resolved_drop_number, project
       FROM oes_pp_data
       WHERE id = ANY($1)
         AND resolved_drop_number IS NOT NULL
         AND maintenance_ticket_id IS NULL`,
      [pp_data_ids]
    );

    const records = eligible.rows;
    const skipped = pp_data_ids.length - records.length;

    if (records.length === 0) {
      return res.status(200).json({
        success: true,
        data: { created: 0, skipped: pp_data_ids.length, tickets: [] },
      });
    }

    logger.info('Creating PP Data maintenance tickets', {
      eligible: records.length,
      skipped,
      ticket_type,
    });

    const tickets: { id: string; ticket_uid: string; pp_data_id: number }[] = [];

    for (const record of records) {
      const dr = record.resolved_drop_number;
      const serial = record.serial_number;

      const ticket = await createTicket({
        source: TicketSource.PP_DATA,
        title: `PP ONT ${serial} at ${dr}`,
        ticket_type: ticket_type as TicketType,
        priority: ticketPriority,
        description: notes || `PP Data investigation: ONT ${serial} located at DR ${dr} (Project: ${record.project})`,
        dr_number: dr,
        ont_serial: serial,
        created_by: req.user.id,
      });

      // Link ticket back to PP data record
      await pool.query(
        `UPDATE oes_pp_data SET maintenance_ticket_id = $1 WHERE id = $2`,
        [ticket.id, record.id]
      );

      tickets.push({
        id: ticket.id,
        ticket_uid: ticket.ticket_uid,
        pp_data_id: record.id,
      });
    }

    logger.info('PP Data tickets created', { created: tickets.length, skipped });

    return res.status(200).json({
      success: true,
      data: { created: tickets.length, skipped, tickets },
    });
  } catch (err) {
    logger.error('Failed to create PP Data tickets', { error: err });
    return res.status(500).json({ error: 'Failed to create tickets' });
  }
}

export default withAuth(withRole('manager')(handler));
