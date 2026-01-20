/**
 * Create Maintenance Ticket for Serial Mismatch
 *
 * POST: Create a maintenance ticket for investigating serial mismatch
 *
 * Body:
 * - id: offline_devices record ID
 * - priority?: Ticket priority (default: 'medium')
 * - notes?: Additional notes for the ticket
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

interface CreateTicketBody {
  id: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  notes?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { id, priority = 'medium', notes } = req.body as CreateTicketBody;

    // Validate required fields
    if (!id) {
      return apiResponse.badRequest(res, 'id is required');
    }

    // Get the offline device record
    const deviceQuery = `
      SELECT
        id, drop_number, zone, planned_pon, address,
        serial_number, expected_serial, serial_mismatch_type,
        mismatch_status, mismatch_ticket_id, last_down_reason,
        days_since_last_inform
      FROM offline_devices
      WHERE id = $1 AND serial_mismatch = true
    `;

    const deviceResult = await pool.query(deviceQuery, [id]);

    if (deviceResult.rows.length === 0) {
      return apiResponse.notFound(res, 'Serial mismatch record', id);
    }

    const device = deviceResult.rows[0];
    if (!device) {
      return apiResponse.notFound(res, 'Serial mismatch record', id);
    }

    // Check if ticket already exists
    if (device.mismatch_ticket_id) {
      return apiResponse.success(res, {
        success: false,
        message: 'Ticket already exists for this mismatch',
        ticket_id: String(device.mismatch_ticket_id),
      });
    }

    // Create the maintenance ticket
    const ticketTitle = `Serial Mismatch Investigation: ${device.drop_number}`;
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

    const createTicketQuery = `
      INSERT INTO maintenance_tickets (
        title, description, status, priority, ticket_type, source,
        drop_number, zone, created_at, updated_at
      )
      VALUES ($1, $2, 'open', $3, 'serial_mismatch', 'qa_dashboard', $4, $5, NOW(), NOW())
      RETURNING id, title, status, priority
    `;

    const ticketResult = await pool.query(createTicketQuery, [
      ticketTitle,
      ticketDescription,
      priority,
      device.drop_number,
      device.zone,
    ]);

    if (ticketResult.rows.length === 0) {
      return apiResponse.internalError(res, new Error('Failed to create ticket'));
    }

    const ticket = ticketResult.rows[0];
    if (!ticket) {
      return apiResponse.internalError(res, new Error('Failed to create ticket'));
    }

    // Update offline_devices with ticket reference and status
    const updateDeviceQuery = `
      UPDATE offline_devices
      SET
        mismatch_status = 'ticket_created',
        mismatch_ticket_id = $1,
        mismatch_investigated_at = COALESCE(mismatch_investigated_at, NOW()),
        mismatch_investigated_by = COALESCE(mismatch_investigated_by, 'qa_dashboard')
      WHERE id = $2
    `;

    await pool.query(updateDeviceQuery, [ticket.id, id]);

    log.info('SerialMismatchTicket', `Created ticket for mismatch ${device.drop_number}`, {
      deviceId: id,
      dropNumber: device.drop_number,
      ticketId: ticket.id,
      priority,
    });

    return apiResponse.success(res, {
      success: true,
      ticket_id: String(ticket.id),
      ticket_title: String(ticket.title),
      ticket_status: String(ticket.status),
      ticket_priority: String(ticket.priority),
      drop_number: String(device.drop_number),
      message: `Maintenance ticket created for ${device.drop_number}`,
    });
  } catch (error) {
    log.error('SerialMismatchTicket', 'Failed to create ticket', { error });
    return apiResponse.internalError(res, error);
  }
}
