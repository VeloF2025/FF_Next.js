/**
 * WhatsApp Maintenance Ticket Creation Endpoint
 *
 * POST /api/noc/wa-ticket
 * Creates a maintenance ticket from a WA maintenance flag
 *
 * @module api/noc/wa-ticket
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { createTicket } from '@/modules/noc/services/ticketService';
import {
  TicketSource,
  TicketType,
  TicketPriority,
  TicketStatus,
} from '@/modules/noc/types/ticket';
import { updateMaintenanceFlagStatus } from '@/modules/noc/services/waMaintenanceProcessor';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';

const logger = createLogger('api:maintenance:wa-ticket');

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return neon(databaseUrl);
}

interface CreateWATicketRequest {
  drop_number: string;
  issue_type?: string;
  issue_description?: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  created_by?: string;
  assigned_team_id?: string;
}

interface ApiResponse {
  success: boolean;
  data?: {
    ticket_id: string;
    ticket_uid: string;
    drop_number: string;
  };
  error?: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  try {
    const body = req.body as CreateWATicketRequest;

    // Validate required fields
    if (!body.drop_number) {
      return res.status(400).json({
        success: false,
        error: 'drop_number is required',
      });
    }

    const sql = getDb();

    // Get maintenance flag and messages for context
    const flagResult = await sql`
      SELECT
        f.*,
        (
          SELECT string_agg(m.message_text, ' | ')
          FROM maintenance_wa_messages m
          WHERE m.drop_number = f.drop_number
          ORDER BY m.message_timestamp DESC
          LIMIT 5
        ) as recent_messages
      FROM dr_maintenance_flags f
      WHERE f.drop_number = ${body.drop_number}
    `;

    if (flagResult.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No maintenance flag found for ${body.drop_number}`,
      });
    }

    const flag = flagResult[0] as {
      maintenance_ticket_id: string | null;
      issue_description: string | null;
      recent_messages: string | null;
      wa_message_count: number;
      wa_photo_count: number;
      first_reported_at: string;
    };

    // Check if ticket already exists
    if (flag.maintenance_ticket_id) {
      return res.status(400).json({
        success: false,
        error: `Ticket already exists for ${body.drop_number}`,
      });
    }

    // Get project info from drops table
    const projectResult = await sql`
      SELECT p.id as project_id, p.project_name
      FROM drops d
      JOIN projects p ON d.project_id = p.id
      WHERE d.drop_number = ${body.drop_number}
      LIMIT 1
    `;

    const projectId = projectResult.length > 0
      ? (projectResult[0] as { project_id: string }).project_id
      : undefined;

    // Build description from messages
    const description = [
      body.issue_description || flag.issue_description || 'Maintenance issue reported via WhatsApp',
      '',
      '--- WhatsApp Messages ---',
      flag.recent_messages || 'No messages available',
      '',
      `Total messages: ${flag.wa_message_count || 0}`,
      `Total photos: ${flag.wa_photo_count || 0}`,
      `First reported: ${flag.first_reported_at}`,
    ].join('\n');

    // Map priority
    const priorityMap: Record<string, TicketPriority> = {
      low: TicketPriority.LOW,
      normal: TicketPriority.NORMAL,
      high: TicketPriority.HIGH,
      critical: TicketPriority.CRITICAL,
    };
    const priority = priorityMap[body.priority || 'normal'] || TicketPriority.NORMAL;

    // Create the ticket (with optional team assignment)
    const ticket = await createTicket({
      source: TicketSource.WA_MAINTENANCE,
      ticket_type: TicketType.MAINTENANCE,
      title: `Maintenance Issue - ${body.drop_number}`,
      description,
      priority,
      dr_number: body.drop_number,
      project_id: projectId,
      created_by: body.created_by,
      assigned_team_id: body.assigned_team_id || undefined,
      status: body.assigned_team_id ? TicketStatus.ASSIGNED : undefined,
    });

    // Update maintenance flag with ticket ID
    await updateMaintenanceFlagStatus(body.drop_number, 'ticket_created', ticket.id);

    logger.info(
      {
        ticketId: ticket.id,
        ticketUid: ticket.ticket_uid,
        dropNumber: body.drop_number,
      },
      'Maintenance ticket created from WA tracking'
    );

    return res.status(201).json({
      success: true,
      data: {
        ticket_id: ticket.id,
        ticket_uid: ticket.ticket_uid,
        drop_number: body.drop_number,
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    logger.error({ error: errorMessage }, 'Failed to create WA maintenance ticket');

    return res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
}

export default withAuth(handler);
