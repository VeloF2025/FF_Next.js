/**
 * Create Maintenance Ticket for Serial Mismatch
 *
 * POST: Create a maintenance ticket for investigating serial mismatch
 * Uses standard createTicket() for proper UID generation and audit trail
 *
 * Body:
 * - id: offline_devices record ID
 * - priority?: Ticket priority (default: 'normal')
 * - notes?: Additional notes for the ticket
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth';
import { log } from '@/lib/logger';
import { createTicket } from '@/modules/noc/services/ticketService';
import {
  TicketSource,
  TicketType,
  TicketPriority,
} from '@/modules/noc/types/ticket';

interface CreateTicketBody {
  id: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  notes?: string;
}

const PRIORITY_MAP: Record<string, TicketPriority> = {
  low: TicketPriority.LOW,
  medium: TicketPriority.NORMAL,
  normal: TicketPriority.NORMAL,
  high: TicketPriority.HIGH,
  critical: TicketPriority.CRITICAL,
};

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { id, priority = 'normal', notes } = req.body as CreateTicketBody;

    if (!id) {
      return apiResponse.badRequest(res, 'id is required');
    }

    // Get the offline device record
    const deviceResult = await pool.query(
      `SELECT
        id, drop_number, zone, planned_pon, address,
        serial_number, expected_serial, serial_mismatch_type,
        mismatch_status, mismatch_ticket_id, last_down_reason,
        days_since_last_inform
      FROM offline_devices
      WHERE id = $1 AND serial_mismatch = true`,
      [id]
    );

    if (deviceResult.rows.length === 0) {
      return apiResponse.notFound(res, 'Serial mismatch record', id);
    }

    const device = deviceResult.rows[0];

    // Check if ticket already exists
    if (device.mismatch_ticket_id) {
      return apiResponse.success(res, {
        success: false,
        message: 'Ticket already exists for this mismatch',
        ticket_id: String(device.mismatch_ticket_id),
      });
    }

    // Build description
    const ticketDescription = `
**Serial Mismatch Detected**

**DR Number:** ${device.drop_number}
**Zone:** ${device.zone ?? 'N/A'}
**PON:** ${device.planned_pon ?? 'N/A'}
**Address:** ${device.address ?? 'N/A'}

**Current Serial (Offline Report):** ${device.serial_number}
**Expected Serial (OES Activation):** ${device.expected_serial}
**Mismatch Type:** ${device.serial_mismatch_type ?? 'Different Serial'}

**Days Offline:** ${device.days_since_last_inform ?? 0}
**Last Down Reason:** ${device.last_down_reason ?? 'Unknown'}

**Investigation Notes:**
${notes ?? 'Please investigate the serial number discrepancy. Possible causes: ONT replacement, data entry error, or unauthorized swap.'}

**Action Required:**
1. Verify current ONT at site
2. Check if ONT was replaced
3. Update 1Map or OES records accordingly
4. Report findings
`.trim();

    // Create ticket via standard service
    const ticket = await createTicket({
      source: TicketSource.QA_REVIEW,
      ticket_type: TicketType.MAINTENANCE,
      title: `Serial Mismatch Investigation: ${device.drop_number}`,
      description: ticketDescription,
      priority: PRIORITY_MAP[priority] || TicketPriority.NORMAL,
      dr_number: device.drop_number,
      zone_id: device.zone?.toString() || undefined,
      pon_number: device.planned_pon?.toString() || undefined,
      address: device.address || undefined,
      ont_serial: device.serial_number || undefined,
    });

    // Update offline_devices with ticket reference
    await pool.query(
      `UPDATE offline_devices
       SET
         mismatch_status = 'ticket_created',
         mismatch_ticket_id = $1,
         mismatch_investigated_at = COALESCE(mismatch_investigated_at, NOW()),
         mismatch_investigated_by = COALESCE(mismatch_investigated_by, 'qa_dashboard')
       WHERE id = $2`,
      [ticket.id, id]
    );

    log.info(`Created ticket for mismatch ${device.drop_number}`, {
      deviceId: id,
      dropNumber: device.drop_number,
      ticketId: ticket.id,
      ticketUid: ticket.ticket_uid,
      priority,
    }, 'SerialMismatchTicket');


    return apiResponse.success(res, {
      ticket_id: ticket.id,
      ticket_uid: ticket.ticket_uid,
      ticket_title: ticket.title,
      ticket_status: ticket.status,
      ticket_priority: ticket.priority,
      drop_number: String(device.drop_number),
      message: `Maintenance ticket created for ${device.drop_number}`,
    });
  } catch (error) {
    log.error('Failed to create ticket', { error: { error } }, 'SerialMismatchTicket');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('manager')(handler));
