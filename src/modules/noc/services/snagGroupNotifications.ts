/**
 * Snag WhatsApp Group Notifications
 *
 * Sends ticket lifecycle updates to the project's WhatsApp group
 * when the ticket source is 'snags'.
 *
 * Lookup: projects.project_name → wa_group_config.project_name → group_jid
 */

import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { sendWhatsAppGroup } from '@/modules/notifications/services/whatsappDelivery';
import type { Ticket } from '../types/ticket';

const sql = neon(process.env.DATABASE_URL!);
const logger = createLogger('noc:snag-group-notifications');

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app';

// =============================================================================
// Group JID Lookup
// =============================================================================

/**
 * Resolve a ticket's project to a snags-specific WhatsApp group JID.
 * Looks up wa_group_config where group_type = 'snags'.
 * Returns null if no snags group is configured or enabled.
 */
async function resolveGroupJid(projectId: string): Promise<string | null> {
  try {
    const rows = await sql`
      SELECT wg.group_jid
      FROM projects p
      JOIN wa_group_config wg ON LOWER(wg.project_name) = LOWER(p.project_name)
      WHERE p.id = ${projectId}::uuid
        AND wg.group_type = 'snags'
        AND wg.enabled = true
      LIMIT 1
    ` as Array<{ group_jid: string }>;
    return rows[0]?.group_jid ?? null;
  } catch (err) {
    logger.error('Failed to resolve WA group for project', {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Resolve assignee name from staff.id
 */
async function resolveAssigneeName(staffId: string): Promise<string> {
  try {
    const rows = await sql`
      SELECT COALESCE(first_name || ' ' || last_name, first_name, 'Unknown') AS name
      FROM staff WHERE id = ${staffId}::uuid LIMIT 1
    ` as Array<{ name: string }>;
    return rows[0]?.name ?? 'Unassigned';
  } catch {
    return 'Unassigned';
  }
}

// =============================================================================
// Message Builders
// =============================================================================

function buildTicketCreatedMessage(ticket: Ticket, assigneeName: string): string {
  const lines = [
    `🔧 *New Snag Ticket Created*`,
    '',
    `*${ticket.ticket_uid}*`,
    ticket.title,
    '',
    `Priority: ${(ticket.priority || 'normal').toUpperCase()}`,
    `Assigned to: ${assigneeName}`,
  ];
  if (ticket.dr_number) lines.push(`DR: ${ticket.dr_number}`);
  lines.push('', `${APP_URL}/noc/tickets/${ticket.id}`);
  return lines.join('\n');
}

function buildStatusUpdateMessage(
  ticket: Ticket,
  oldStatus: string,
  newStatus: string
): string {
  const statusLabel = newStatus.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const emoji = STATUS_EMOJI[newStatus] || '📋';

  const lines = [
    `${emoji} *Snag Ticket Update*`,
    '',
    `*${ticket.ticket_uid}* → *${statusLabel}*`,
    ticket.title,
  ];
  if (ticket.dr_number) lines.push(`DR: ${ticket.dr_number}`);
  lines.push('', `${APP_URL}/noc/tickets/${ticket.id}`);
  return lines.join('\n');
}

const STATUS_EMOJI: Record<string, string> = {
  open: '🔴',
  assigned: '👤',
  in_progress: '🔨',
  pending_qa: '🔍',
  qa_in_progress: '🔍',
  qa_rejected: '❌',
  qa_approved: '✅',
  pending_handover: '🤝',
  handed_to_ops: '🤝',
  resolved: '✅',
  closed: '🏁',
};

// =============================================================================
// Public API
// =============================================================================

/**
 * Send a WhatsApp group message when a snag ticket is created.
 * Non-blocking — catches all errors internally.
 */
export async function notifySnagGroupOnCreate(ticket: Ticket): Promise<void> {
  if (ticket.source !== 'snags' || !ticket.project_id) return;

  try {
    const groupJid = await resolveGroupJid(ticket.project_id);
    if (!groupJid) {
      logger.debug('No WA group for snag ticket project', { ticketId: ticket.id, projectId: ticket.project_id });
      return;
    }

    const assigneeName = ticket.assigned_to
      ? await resolveAssigneeName(ticket.assigned_to)
      : 'Unassigned';

    const message = buildTicketCreatedMessage(ticket, assigneeName);
    await sendWhatsAppGroup(groupJid, message);

    logger.info('Snag ticket creation sent to WA group', {
      ticketId: ticket.id,
      ticketUid: ticket.ticket_uid,
      groupJid,
    });
  } catch (err) {
    logger.error('Failed to send snag creation WA group message', {
      ticketId: ticket.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Send a WhatsApp group message when a snag ticket status changes.
 * Non-blocking — catches all errors internally.
 */
export async function notifySnagGroupOnStatusChange(
  ticket: Ticket,
  oldStatus: string,
  newStatus: string
): Promise<void> {
  if (ticket.source !== 'snags' || !ticket.project_id) return;
  if (oldStatus === newStatus) return;

  try {
    const groupJid = await resolveGroupJid(ticket.project_id);
    if (!groupJid) return;

    const message = buildStatusUpdateMessage(ticket, oldStatus, newStatus);
    await sendWhatsAppGroup(groupJid, message);

    logger.info('Snag ticket status update sent to WA group', {
      ticketId: ticket.id,
      ticketUid: ticket.ticket_uid,
      oldStatus,
      newStatus,
      groupJid,
    });
  } catch (err) {
    logger.error('Failed to send snag status WA group message', {
      ticketId: ticket.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
