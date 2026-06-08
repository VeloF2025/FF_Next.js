/**
 * Ticket resolution side-effects (shared).
 *
 * The cascade that must fire whenever a maintenance ticket transitions to
 * `resolved`: optional resolution note, creator notification, linked Data Sync
 * record resolution, snag back-sync, and an AI history-summary refresh.
 *
 * Extracted from the NOC ticket PUT route (`app/api/noc/tickets/[id]/route.ts`)
 * so the OLT investigate resolve endpoint can trigger the IDENTICAL cascade
 * without duplicating it — the two paths must never drift.
 *
 * Every step is best-effort: failures are logged, never thrown. The ticket is
 * already resolved by the time this runs; a failed notification or summary must
 * not roll that back.
 *
 * Status: WORKING | NLNH Confidence: HIGH
 */

import { createLogger } from '@/lib/logger';
import { query } from '../utils/db';
import { logTicketActivity } from './ticketService';
import { triggerOnTicketResolution } from './notificationTriggers';
import { markLinkedDataSyncResolved } from './dataSyncResolution';
import type { Ticket } from '../types/ticket';

const logger = createLogger('noc:ticketResolution');

export interface ResolvedActingUser {
  id?: string;
  name?: string;
  email?: string;
}

export interface ResolvedSideEffectOptions {
  /** Who triggered the resolution (note attribution + activity author). */
  actingUser?: ResolvedActingUser;
  /** When provided, a resolution note is added to the ticket + activity feed. */
  note?: string;
  /** Note visibility. Public notes are surfaced in the public notes view. */
  noteVisibility?: 'public' | 'private';
}

/**
 * Run all side-effects for a ticket that has just transitioned to `resolved`.
 * Safe to call from any resolve path; never throws.
 */
export async function applyTicketResolvedSideEffects(
  ticket: Ticket,
  options: ResolvedSideEffectOptions = {},
): Promise<void> {
  const { actingUser, note, noteVisibility = 'public' } = options;
  const trimmedNote = note?.trim();

  // 1. Resolution note (+ matching activity-feed entry) — only when supplied.
  //    note_type is constrained to internal|external|system; an auto-generated
  //    note is 'system'. is_resolution flags it for the resolution UI.
  if (trimmedNote) {
    try {
      await query(
        `INSERT INTO maintenance_notes
           (ticket_id, content, note_type, visibility, created_by, is_resolution)
         VALUES ($1, $2, 'system', $3, $4, true)`,
        [ticket.id, trimmedNote, noteVisibility, actingUser?.id ?? null],
      );
      await logTicketActivity({
        ticketId: ticket.id,
        activityType: 'note',
        description: trimmedNote,
        userId: actingUser?.id,
        userName: actingUser?.name,
        userEmail: actingUser?.email,
      });
    } catch (err) {
      logger.error('Resolution note insert failed', {
        ticketId: ticket.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. Notify the ticket creator (email + in-app). Fire-and-forget.
  triggerOnTicketResolution(ticket).catch((err) =>
    logger.error('Resolution notification error', {
      ticketId: ticket.id,
      error: err instanceof Error ? err.message : String(err),
    }),
  );

  // 3. Resolve linked Data Sync records (OLT mismatch + PP data). Awaited so the
  //    AI summary regen below observes the resolved state, not the stale one.
  try {
    await markLinkedDataSyncResolved(ticket.id);
  } catch (err) {
    logger.error('Data Sync resolution error', {
      ticketId: ticket.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 4. Bi-directional snag sync: resolved ticket → snag.status = 'fixed'.
  if (ticket.source === 'snags') {
    query(
      `UPDATE snags SET status = 'fixed', updated_at = NOW() WHERE noc_ticket_id = $1`,
      [ticket.id],
    ).catch((err) =>
      logger.error('Snag status sync error', {
        ticketId: ticket.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  // 5. Refresh the AI history summary so it reflects the closure. Flag-gated,
  //    fire-and-forget — mirrors the regenerate-ai-summary route (drop the
  //    single ai_summary row, then regenerate).
  const drNumber = ticket.dr_number;
  if (process.env.FF_AI_TICKET_SUMMARY === '1' && drNumber) {
    const ontSerial = ticket.ont_serial ?? null;
    void (async () => {
      try {
        await query(
          `DELETE FROM maintenance_activities
           WHERE ticket_id = $1 AND activity_type = 'ai_summary'`,
          [ticket.id],
        );
        const { summarizeAndAttachDrHistory } = await import('./drHistoryService');
        await summarizeAndAttachDrHistory(ticket.id, drNumber, ontSerial);
      } catch (err) {
        logger.warn('AI summary regen on resolve skipped', {
          ticketId: ticket.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }
}
