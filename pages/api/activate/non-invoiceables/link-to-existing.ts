/**
 * Link a non-invoiceable source item to an existing maintenance ticket.
 *
 * POST /api/activate/non-invoiceables/link-to-existing
 * Body: { source: 'offline_devices' | 'oes_pp_data' | 'olt_mismatch_records',
 *         source_id: string | number,
 *         target_ticket_id: string (UUID),
 *         source_variant?: 'mismatch' | 'offline' }  // offline_devices only
 *
 * Use case: the create-ticket flow has just detected a duplicate and the
 * user picked "link this item to the existing ticket" rather than creating
 * a new one. We stamp the source row's ticket_id FK and drop a note on
 * the target ticket so the link is visible in the ticket's history.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import pool from '@/lib/db';
import {
  linkSourceToTicket,
  type LinkSourceTable,
} from '@/modules/noc/services/duplicateTicketService';

type Source = 'offline_devices' | 'oes_pp_data' | 'olt_mismatch_records';
type OfflineVariant = 'mismatch' | 'offline';

interface Body {
  source?: Source;
  source_id?: string | number;
  target_ticket_id?: string;
  source_variant?: OfflineVariant;
}

function resolveColumn(source: Source, variant: OfflineVariant | undefined): LinkSourceTable | null {
  if (source === 'oes_pp_data') return 'oes_pp_data.maintenance_ticket_id';
  if (source === 'olt_mismatch_records') return 'olt_mismatch_records.maintenance_ticket_id';
  if (source === 'offline_devices') {
    return variant === 'mismatch'
      ? 'offline_devices.mismatch_ticket_id'
      : 'offline_devices.offline_ticket_id';
  }
  return null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['POST']);
  }

  const body = (req.body ?? {}) as Body;
  const { source, source_id, target_ticket_id, source_variant } = body;

  if (!source || source_id === undefined || !target_ticket_id) {
    return apiResponse.badRequest(res, 'source, source_id, target_ticket_id are required');
  }

  const column = resolveColumn(source, source_variant);
  if (!column) {
    return apiResponse.badRequest(res, `Unknown source "${source}"`);
  }

  try {
    const { updated } = await linkSourceToTicket(column, String(source_id), target_ticket_id);
    if (!updated) {
      return apiResponse.badRequest(
        res,
        'Source row not found or already linked to a ticket',
      );
    }

    const user = getAuthUser(req);
    const actorName = user?.name ?? user?.email ?? 'System';
    const actorEmail = user?.email ?? null;
    const actorId = user?.id ?? null;

    // Audit trail: activity entry + note on the target ticket
    await pool.query(
      `INSERT INTO maintenance_activities
         (ticket_id, activity_type, description, field_changes,
          created_by_name, created_by_email, source, external_timestamp)
       VALUES ($1, 'source_linked', $2, $3, $4, $5, 'fibreflow', now())`,
      [
        target_ticket_id,
        `Linked ${source} item ${source_id} to this ticket (duplicate of existing DR/serial/pole — new ticket not created).`,
        JSON.stringify({ source, source_id: String(source_id), source_variant: source_variant ?? null }),
        actorName,
        actorEmail,
      ],
    );

    if (actorId) {
      await pool.query(
        `INSERT INTO maintenance_notes (ticket_id, content, note_type, visibility, created_by)
         VALUES ($1, $2, 'system', 'public', $3)`,
        [
          target_ticket_id,
          `Non-invoiceable item linked: **${source}** id \`${source_id}\`${
            source_variant ? ` (variant: ${source_variant})` : ''
          }. Linked by ${actorName} instead of opening a duplicate ticket.`,
          actorId,
        ],
      );
    }

    return apiResponse.success(res, {
      linked: true,
      source,
      source_id: String(source_id),
      target_ticket_id,
    });
  } catch (error) {
    log.error('Failed to link source to existing ticket', {
      data: {
        error: error instanceof Error ? error.message : String(error),
        source,
        source_id,
        target_ticket_id,
      },
    });
    return apiResponse.internalError(res, 'Failed to link item to existing ticket');
  }
}

export default withAuth(handler);
