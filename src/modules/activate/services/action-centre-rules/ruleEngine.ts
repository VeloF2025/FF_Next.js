/**
 * Action Centre rule engine
 *
 * RFC Phase 3 — docs/rfcs/2026-04-17-action-centre-and-dr-timeline.md §5.4
 *
 * Cron-driven worker scheduled DAILY (not 5-min) because the PP activation
 * rule depends on pre_prov_resolved events emitted by the OES import, which
 * runs once a day. Running faster than that just wastes invocations —
 * there's nothing to process. Reads dr_activity_log events since each rule's
 * last watermark and applies rules. Each rule is idempotent (checkpoint per
 * rule) and defensive (dry-run mode, 48h human-edit skip).
 *
 * Initial rule set:
 * - pre_prov_activated_close_tickets: on pre_prov_resolved, close matching tickets
 * - serial_reconciled_close_tickets: on serial_reconciled, close N4 escalation tickets
 * - n4_after_fix_dispute_candidate: on non_invoiceable_flagged (N4) where a prior
 *   serial_reconciled exists, emit anomaly_fixed_still_billed
 */

import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';
import {
  logTicketAutoClosed,
  logAnomalyFixedStillBilled,
  type NoteCode,
} from '@/modules/activate/services/activity-log/eventLoggers';

const logger = createLogger('ActionCentreRuleEngine');

const AUTO_CLOSE_ACTOR = 'action-centre-rule-engine';
const RECENT_HUMAN_EDIT_WINDOW_HOURS = 48;

interface EventRow {
  id: string;
  drop_number: string;
  event_type: string;
  event_data: Record<string, unknown>;
  actor: string | null;
  created_at: Date;
}

export interface RuleRunSummary {
  runId: string;
  dryRun: boolean;
  eventsProcessed: number;
  actionsTaken: number;
  perRule: Record<string, { processed: number; actions: number }>;
  errors: Array<{ rule: string; message: string }>;
}

type RuleHandler = (event: EventRow, ctx: RuleContext) => Promise<number>;

interface RuleContext {
  dryRun: boolean;
  actor: string;
}

const RULES: Array<{ name: string; triggerEvent: string; handler: RuleHandler }> = [
  {
    name: 'pre_prov_activated_close_tickets',
    triggerEvent: 'pre_prov_resolved',
    handler: handlePreProvResolved,
  },
  {
    name: 'serial_reconciled_close_tickets',
    triggerEvent: 'serial_reconciled',
    handler: handleSerialReconciled,
  },
  {
    name: 'n4_after_fix_dispute_candidate',
    triggerEvent: 'non_invoiceable_flagged',
    handler: handleN4AfterFix,
  },
];

/**
 * Entry point: run every rule, update per-rule watermarks, return summary.
 */
export async function runActionCentreRules(
  dryRun = false,
): Promise<RuleRunSummary> {
  const runResult = await pool.query<{ id: string }>(
    `INSERT INTO action_centre_rule_runs (dry_run) VALUES ($1) RETURNING id`,
    [dryRun],
  );
  const runId = runResult.rows[0]!.id;

  const summary: RuleRunSummary = {
    runId,
    dryRun,
    eventsProcessed: 0,
    actionsTaken: 0,
    perRule: {},
    errors: [],
  };

  const ctx: RuleContext = { dryRun, actor: AUTO_CLOSE_ACTOR };

  for (const rule of RULES) {
    const perRule = { processed: 0, actions: 0 };
    summary.perRule[rule.name] = perRule;

    try {
      const events = await fetchEventsSinceWatermark(rule.name, rule.triggerEvent);
      perRule.processed = events.length;
      summary.eventsProcessed += events.length;

      for (const e of events) {
        const actions = await rule.handler(e, ctx).catch((err) => {
          logger.warn(`Rule ${rule.name} failed on event`, {
            event_id: e.id,
            dr: e.drop_number,
            error: err instanceof Error ? err.message : String(err),
          });
          summary.errors.push({ rule: rule.name, message: err instanceof Error ? err.message : String(err) });
          return 0;
        });
        perRule.actions += actions;
        summary.actionsTaken += actions;
      }

      // Advance watermark to the last event seen (even if no action taken,
      // so we don't reprocess on next run).
      if (events.length > 0 && !dryRun) {
        const last = events[events.length - 1]!;
        await upsertCheckpoint(rule.name, last.id, last.created_at);
      }
    } catch (err) {
      logger.error(`Rule ${rule.name} setup failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
      summary.errors.push({
        rule: rule.name,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await pool.query(
    `UPDATE action_centre_rule_runs
     SET completed_at = NOW(), events_processed = $1, actions_taken = $2,
         rules_summary = $3, errors = $4
     WHERE id = $5`,
    [
      summary.eventsProcessed,
      summary.actionsTaken,
      JSON.stringify(summary.perRule),
      JSON.stringify(summary.errors),
      runId,
    ],
  );

  return summary;
}

// ─── Rule handlers ─────────────────────────────────────────────────────────

/**
 * When a pre-provisioned serial transitions to active on OES, close any open
 * tickets for that DR that were raised due to the PP stalling.
 */
async function handlePreProvResolved(event: EventRow, ctx: RuleContext): Promise<number> {
  const tickets = await findCloseableTickets(event.drop_number, {
    sourceTypes: ['pp_unresolved', 'pp_investigation'],
    categories: ['pre_prov_unresolved'],
  });
  return autoCloseTickets(
    tickets,
    `Pre-provisioned ONT activated on OES (${event.event_data.activationDate ?? 'unknown date'}) — auto-closed`,
    'pre_prov_activated_close_tickets',
    event,
    ctx,
  );
}

/**
 * When a 1Map write landed (serial_reconciled), close any open N4 escalation
 * tickets for that DR.
 */
async function handleSerialReconciled(event: EventRow, ctx: RuleContext): Promise<number> {
  // Only act when the reconciled value actually matches OES
  if (event.event_data.matchesOes !== true) return 0;

  const tickets = await findCloseableTickets(event.drop_number, {
    sourceTypes: ['n4_unresolved', 'olt_mismatch'],
    categories: ['N4_serial_drop_mismatch'],
  });
  return autoCloseTickets(
    tickets,
    `1Map serial matched OES on prop ${event.event_data.propId ?? 'unknown'} — auto-closed`,
    'serial_reconciled_close_tickets',
    event,
    ctx,
  );
}

/**
 * When a N4 deduction is flagged AND this DR previously had a serial_reconciled,
 * emit anomaly_fixed_still_billed so the Disputes workflow can pick it up.
 */
async function handleN4AfterFix(event: EventRow, ctx: RuleContext): Promise<number> {
  const noteCode = event.event_data.noteCode as string | undefined;
  if (noteCode !== 'note4') return 0;

  const weekEnding = event.event_data.weekEnding as string | undefined;
  if (!weekEnding) return 0;

  // Find any serial_reconciled event for this DR before this flagging
  const { rows } = await pool.query<{ created_at: Date }>(
    `SELECT created_at FROM dr_activity_log
     WHERE drop_number = $1 AND event_type = 'serial_reconciled'
       AND created_at < $2
     ORDER BY created_at DESC LIMIT 1`,
    [event.drop_number, event.created_at],
  );
  const priorFix = rows[0];
  if (!priorFix) return 0;

  const weeksSinceFix = Math.floor(
    (event.created_at.getTime() - priorFix.created_at.getTime()) / (7 * 24 * 3600 * 1000),
  );

  if (ctx.dryRun) {
    logger.info('[dry-run] would emit anomaly_fixed_still_billed', {
      dr: event.drop_number,
      weekEnding,
      weeksSinceFix,
    });
    return 1;
  }

  await logAnomalyFixedStillBilled(event.drop_number, {
    noteCode: noteCode as NoteCode,
    weekEnding,
    ourFixDate: priorFix.created_at.toISOString(),
    weeksSinceFix,
  });

  // Also flag the deduction row itself so the Disputes view picks it up.
  await pool.query(
    `UPDATE ft_billing_deductions
     SET resolution_status = 'disputing',
         dispute_opened_at = COALESCE(dispute_opened_at, NOW()),
         dispute_reason    = COALESCE(dispute_reason, 'auto-flagged: fixed on 1Map ' || $3 || ' week(s) prior')
     WHERE dr_number = $1 AND week_ending = $2::date AND deduction_note = 'note4'
       AND resolution_status IN ('open', 'in_progress')`,
    [event.drop_number, weekEnding, weeksSinceFix],
  );

  return 1;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function fetchEventsSinceWatermark(
  ruleName: string,
  eventType: string,
  limit = 500,
): Promise<EventRow[]> {
  const { rows: checkpointRows } = await pool.query<{ last_event_at: Date | null }>(
    `SELECT last_event_at FROM action_centre_rule_checkpoints WHERE rule_name = $1`,
    [ruleName],
  );
  const watermark = checkpointRows[0]?.last_event_at ?? null;

  const { rows } = await pool.query<EventRow>(
    `SELECT id, drop_number, event_type, event_data, actor, created_at
     FROM dr_activity_log
     WHERE event_type = $1
       AND ($2::timestamptz IS NULL OR created_at > $2)
     ORDER BY created_at ASC
     LIMIT $3`,
    [eventType, watermark, limit],
  );
  return rows;
}

async function upsertCheckpoint(
  ruleName: string,
  lastEventId: string,
  lastEventAt: Date,
): Promise<void> {
  await pool.query(
    `INSERT INTO action_centre_rule_checkpoints (rule_name, last_event_id, last_event_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (rule_name) DO UPDATE
       SET last_event_id = EXCLUDED.last_event_id,
           last_event_at = EXCLUDED.last_event_at,
           updated_at    = NOW()`,
    [ruleName, lastEventId, lastEventAt],
  );
}

interface TicketMatcher {
  sourceTypes: string[];
  categories: string[];
}

async function findCloseableTickets(
  drNumber: string,
  matcher: TicketMatcher,
): Promise<Array<{ id: string; ticket_uid: string; status: string }>> {
  // Safety rail: skip tickets updated within the last 48h. A recent
  // updated_at implies a human is actively working the ticket (status
  // change, assignment, note, etc.), so auto-closing would clobber their
  // work. This is a conservative proxy; the RFC notes a richer
  // "ticket_activity" table may come later.
  const { rows } = await pool.query<{
    id: string;
    ticket_uid: string;
    status: string;
  }>(
    `SELECT t.id, t.ticket_uid, t.status
     FROM maintenance_tickets t
     WHERE t.dr_number = $1
       AND t.status NOT IN ('closed', 'cancelled', 'resolved', 'verified', 'qa_approved')
       AND (
         t.source_type = ANY($2::text[])
         OR t.ticket_category = ANY($3::text[])
       )
       AND t.updated_at < NOW() - ($4 || ' hours')::interval`,
    [drNumber, matcher.sourceTypes, matcher.categories, RECENT_HUMAN_EDIT_WINDOW_HOURS],
  );

  return rows;
}

async function autoCloseTickets(
  tickets: Array<{ id: string; ticket_uid: string; status: string }>,
  resolutionNote: string,
  ruleName: string,
  triggeringEvent: EventRow,
  ctx: RuleContext,
): Promise<number> {
  if (tickets.length === 0) return 0;

  let closed = 0;
  for (const t of tickets) {
    if (ctx.dryRun) {
      logger.info('[dry-run] would auto-close ticket', {
        ticket_uid: t.ticket_uid,
        rule: ruleName,
        dr: triggeringEvent.drop_number,
      });
      closed++;
      continue;
    }

    try {
      await pool.query(
        `UPDATE maintenance_tickets
         SET status = 'resolved',
             resolved_at = NOW(),
             updated_at = NOW(),
             assessment_comment = COALESCE(assessment_comment || E'\n\n', '') || $1
         WHERE id = $2 AND status NOT IN ('closed', 'cancelled', 'resolved', 'verified', 'qa_approved')`,
        [`[auto-closed by ${ruleName}] ${resolutionNote}`, t.id],
      );

      await logTicketAutoClosed(triggeringEvent.drop_number, {
        ticketId: t.id,
        ticketUid: t.ticket_uid,
        triggeringEvent: triggeringEvent.event_type,
        ruleName,
      });

      closed++;
    } catch (err) {
      logger.warn('auto-close failed', {
        ticket_uid: t.ticket_uid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return closed;
}
