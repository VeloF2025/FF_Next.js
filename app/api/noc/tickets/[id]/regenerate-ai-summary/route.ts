/**
 * POST /api/noc/tickets/[id]/regenerate-ai-summary
 *
 * Regenerates the PRD-062 AI history summary for a ticket. Manager+ only.
 * Concurrent calls are made safe by the unique partial index on
 * maintenance_activities (migration 333) which guarantees at most one
 * ai_summary row per ticket — duplicate INSERTs raise a constraint error
 * which the service swallows, and the post-write SELECT confirms a row
 * actually exists.
 *
 * Returns 200 on success, 401/403 on auth failure, 404 if the ticket has no
 * dr_number to summarize, 503 if the LLM call fails or the feature flag is
 * disabled.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db-pool';
import { createLogger } from '@/lib/logger';
import { requireAuth } from '@/lib/auth/app-router';
import {
  gatherDrFacts,
  summarizeAndAttachDrHistory,
} from '@/modules/noc/services/drHistoryService';

const logger = createLogger('ticket-ai-summary-regenerate');

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager']);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const [user, authError] = await requireAuth(request);
  if (authError) return authError;

  if (!ALLOWED_ROLES.has(user.role)) {
    return NextResponse.json(
      { success: false, error: { message: 'manager+ role required' } },
      { status: 403 },
    );
  }

  const { id: ticketId } = await params;

  try {
    const ticketResult = await pool.query<{
      dr_number: string | null;
      ont_serial: string | null;
    }>(
      `SELECT dr_number, ont_serial FROM maintenance_tickets WHERE id = $1 LIMIT 1`,
      [ticketId],
    );
    const ticket = ticketResult.rows[0];
    if (!ticket) {
      return NextResponse.json(
        { success: false, error: { message: 'Ticket not found' } },
        { status: 404 },
      );
    }
    const { dr_number: drNumber, ont_serial: ontSerial } = ticket;

    if (!drNumber) {
      return NextResponse.json(
        { success: false, error: { message: 'Ticket has no dr_number — cannot summarize' } },
        { status: 404 },
      );
    }

    // Route-level flag guard is intentional: blocks the DELETE below from
    // running when the feature is disabled, even though the service has
    // its own internal guard for the INSERT.
    if (process.env.FF_AI_TICKET_SUMMARY !== '1') {
      return NextResponse.json(
        { success: false, error: { message: 'AI summary feature is disabled (FF_AI_TICKET_SUMMARY)' } },
        { status: 503 },
      );
    }

    // Pre-flight: empty history → fail fast with no DB mutation so any
    // existing summary survives.
    const facts = await gatherDrFacts(drNumber, ontSerial, ticketId);
    const empty =
      !facts.drop &&
      facts.qa_photos.length === 0 &&
      !facts.oes_activation &&
      facts.serial_changes.length === 0 &&
      !facts.olt_mismatch &&
      facts.onemap_props.length === 0 &&
      facts.prior_tickets.length === 0 &&
      facts.offline_devices.length === 0;
    if (empty) {
      return NextResponse.json(
        { success: false, error: { message: 'No DR history found in any source table' } },
        { status: 404 },
      );
    }

    // Drop the existing ai_summary row before regenerating. The unique
    // partial index (migration 333) ensures at most one ai_summary per
    // ticket — concurrent regenerate calls cannot stack duplicates.
    await pool.query(
      `DELETE FROM maintenance_activities
       WHERE ticket_id = $1 AND activity_type = 'ai_summary'`,
      [ticketId],
    );

    await summarizeAndAttachDrHistory(ticketId, drNumber, ontSerial);

    // Confirm a row was actually written. If summarizeAndAttachDrHistory
    // failed silently (LLM error, unique-constraint conflict from a
    // concurrent regenerate that won the race) the row will be missing.
    const after = await pool.query<{ id: string; created_at: string }>(
      `SELECT id, created_at FROM maintenance_activities
       WHERE ticket_id = $1 AND activity_type = 'ai_summary'
       ORDER BY created_at DESC LIMIT 1`,
      [ticketId],
    );
    const written = after.rows[0];
    if (!written) {
      return NextResponse.json(
        { success: false, error: { message: 'Summary generation failed — see server logs' } },
        { status: 503 },
      );
    }

    logger.info('AI summary regenerated', {
      ticketId,
      drNumber,
      requestedBy: user.email,
    });

    return NextResponse.json({
      success: true,
      data: { activity_id: written.id, created_at: written.created_at },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('AI summary regenerate failed', { ticketId, error: message });
    return NextResponse.json(
      { success: false, error: { message } },
      { status: 500 },
    );
  }
}
