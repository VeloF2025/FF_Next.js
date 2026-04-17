/**
 * Convenience logging functions for specific event types
 */

import { log } from '@/lib/logger';
import { logActivity } from './coreLogger';
import { getDb } from './_shared';

/**
 * Log WhatsApp submission
 */
export async function logWhatsAppSubmission(
  drNumber: string,
  sender: string,
  group: string,
  messageId?: string
): Promise<string> {
  return logActivity(drNumber, 'whatsapp_submitted', { sender, group, messageId }, 'whatsapp-bridge');
}

/**
 * Log DR acknowledgment
 */
export async function logAcknowledgment(
  drNumber: string,
  photoCount: number,
  ontSerial?: string,
  upsSerial?: string
): Promise<string> {
  return logActivity(
    drNumber,
    'dr_acknowledged',
    { photoCount, ontSerial, upsSerial },
    'whatsapp-bridge'
  );
}

/**
 * Log photos fetched
 */
export async function logPhotosFetched(
  drNumber: string,
  source: string,
  count: number
): Promise<string> {
  return logActivity(drNumber, 'photos_fetched', { source, count }, 'onemap-api');
}

/**
 * Log photos synced (when new photos are downloaded from 1Map)
 */
export async function logPhotosSynced(
  drNumber: string,
  previousCount: number,
  newCount: number,
  source: string = '1Map',
  trigger: string = 'user'
): Promise<string> {
  return logActivity(
    drNumber,
    'PHOTOS_SYNCED',
    {
      previousCount,
      newCount,
      newPhotos: newCount - previousCount,
      source,
      trigger,
    },
    trigger === 'user' ? 'user' : 'system'
  );
}

/**
 * Log attribute categorization
 */
export async function logAttributeCategorization(
  drNumber: string,
  total: number,
  categorized: number,
  needsVlm: number,
  processingTimeMs: number
): Promise<string> {
  return logActivity(
    drNumber,
    'attribute_categorized',
    { total, categorized, needsVlm, processingTimeMs },
    'step-mapper'
  );
}

/**
 * Log VLM QA started
 */
export async function logVlmQaStarted(drNumber: string, photoCount: number): Promise<string> {
  return logActivity(drNumber, 'vlm_qa_started', { photoCount }, 'qwen3-vl');
}

/**
 * Log VLM QA completed
 */
export async function logVlmQaCompleted(
  drNumber: string,
  total: number,
  passed: number,
  passRate: number,
  processingTimeMs: number
): Promise<string> {
  return logActivity(
    drNumber,
    'vlm_qa_completed',
    { total, passed, passRate, processingTimeMs },
    'qwen3-vl'
  );
}

/**
 * Log VLM QA failed
 */
export async function logVlmQaFailed(drNumber: string, error: string): Promise<string> {
  return logActivity(drNumber, 'vlm_qa_failed', { error }, 'qwen3-vl');
}

/**
 * Log human review started
 */
export async function logHumanReviewStarted(drNumber: string, userId: string): Promise<string> {
  return logActivity(drNumber, 'human_review_started', {}, userId);
}

/**
 * Log human review completed
 */
export async function logHumanReviewCompleted(
  drNumber: string,
  userId: string,
  approved: number,
  rejected: number
): Promise<string> {
  // Look up the user's name for display
  let reviewerName = 'unknown';
  try {
    const sql = getDb();
    const userRows = await sql`
      SELECT first_name, last_name FROM users WHERE id = ${userId}::uuid
    `;
    const firstRow = userRows[0];
    if (firstRow && (firstRow.first_name || firstRow.last_name)) {
      reviewerName = [firstRow.first_name, firstRow.last_name].filter(Boolean).join(' ');
    }
  } catch (err) {
    log.warn(`Could not look up user name for ${userId}: ${err}`, undefined, 'ActivityLog');
  }

  return logActivity(
    drNumber,
    'human_review_completed',
    { reviewer: reviewerName, reviewerId: userId, approved, rejected },
    userId
  );
}

/**
 * Log step approval
 */
export async function logStepApproval(
  drNumber: string,
  step: number,
  stepLabel: string,
  userId: string
): Promise<string> {
  return logActivity(drNumber, 'step_approved', { step, stepLabel }, userId);
}

/**
 * Log step rejection
 */
export async function logStepRejection(
  drNumber: string,
  step: number,
  stepLabel: string,
  reason: string,
  userId: string
): Promise<string> {
  return logActivity(drNumber, 'step_rejected', { step, stepLabel, reason }, userId);
}

/**
 * Log feedback generated
 */
export async function logFeedbackGenerated(drNumber: string, feedbackLength: number): Promise<string> {
  return logActivity(drNumber, 'feedback_generated', { feedbackLength }, 'feedback-agent');
}

/**
 * Log feedback sent
 */
export async function logFeedbackSent(drNumber: string, group: string, messageId?: string): Promise<string> {
  return logActivity(drNumber, 'feedback_sent', { group, messageId }, 'whatsapp-sender');
}

/**
 * Log error
 */
export async function logError(drNumber: string, message: string, details?: unknown): Promise<string> {
  return logActivity(drNumber, 'error', { message, details }, 'error-handler');
}

/**
 * Log ONT swap reported via WhatsApp pre-provision group
 */
export async function logOntSwapReported(
  drNumber: string,
  oldSerial: string | null,
  newSerial: string,
  swapType: string,
  senderName: string
): Promise<string> {
  return logActivity(
    drNumber,
    'ONT_SWAP_REPORTED',
    { oldSerial, newSerial, swapType, reportedBy: senderName },
    'whatsapp-bridge'
  );
}

// ─── Action Centre event loggers (RFC Phase 2) ────────────────────────────────
// These feed the unified DR timeline that the Action Centre + QA Centre render.
// See docs/rfcs/2026-04-17-action-centre-and-dr-timeline.md §5.3

export type NoteCode = 'note1' | 'note2' | 'note3' | 'note4' | 'note5';

/**
 * A Fibertime weekly-billing deduction has flagged this DR for the week.
 * Emitted once per (DR, week, note) combination from billing upload-weekly.
 */
export async function logNonInvoiceableFlagged(
  drNumber: string,
  payload: {
    weekEnding: string;
    noteCode: NoteCode;
    team?: string | null;
    project?: string | null;
    reason?: string | null;
    serial?: string | null;
  },
  actor: string = 'billing-import'
): Promise<string> {
  return logActivity(drNumber, 'non_invoiceable_flagged', payload, actor);
}

/**
 * A deduction has been resolved (billing reconcile, NOC ticket closed, dispute accepted).
 */
export async function logNonInvoiceableResolved(
  drNumber: string,
  payload: {
    weekEnding: string;
    noteCode: NoteCode;
    resolutionReason: string;
    disputeOutcome?: string | null;
  },
  actor: string
): Promise<string> {
  return logActivity(drNumber, 'non_invoiceable_resolved', payload, actor);
}

/**
 * Pre-provisioned ONT added to the oes_pp_data backlog.
 */
export async function logPreProvAdded(
  drNumber: string,
  payload: { serial: string; activationCode?: string | null; project?: string | null },
  actor: string = 'oes-pp-import'
): Promise<string> {
  return logActivity(drNumber, 'pre_prov_added', payload, actor);
}

/**
 * Pre-provisioned ONT resolved (activated or written off).
 */
export async function logPreProvResolved(
  drNumber: string,
  payload: { resolutionReason: string; activationDate?: string | null },
  actor: string
): Promise<string> {
  return logActivity(drNumber, 'pre_prov_resolved', payload, actor);
}

/**
 * NOC ticket created and bound to this DR.
 */
export async function logTicketCreated(
  drNumber: string,
  payload: {
    ticketId: string;
    ticketUid: string;
    category?: string | null;
    type?: string | null;
    priority?: string | null;
    source?: string | null;
    sourceType?: string | null;
  },
  actor: string
): Promise<string> {
  return logActivity(drNumber, 'ticket_created', payload, actor);
}

/**
 * NOC ticket status transitioned. Emitted on every status change so the
 * Timeline can render the full ticket lifecycle.
 */
export async function logTicketStatusChanged(
  drNumber: string,
  payload: {
    ticketId: string;
    ticketUid: string;
    fromStatus: string;
    toStatus: string;
  },
  actor: string
): Promise<string> {
  return logActivity(drNumber, 'ticket_status_changed', payload, actor);
}

/**
 * NOC ticket auto-closed by the rule engine (Phase 3) — e.g. pre-prov → active.
 */
export async function logTicketAutoClosed(
  drNumber: string,
  payload: {
    ticketId: string;
    ticketUid: string;
    triggeringEvent: string;
    ruleName: string;
  },
  actor: string = 'action-centre-rule-engine'
): Promise<string> {
  return logActivity(drNumber, 'ticket_auto_closed', payload, actor);
}

/**
 * 1Map ph_ont write landed AND a post-write read-back confirmed the value.
 * Stronger signal than a raw SERIAL_UPDATE log entry.
 */
export async function logSerialReconciled(
  drNumber: string,
  payload: {
    propId: string;
    oldValue: string | null;
    newValue: string;
    matchesOes?: boolean;
  },
  actor: string
): Promise<string> {
  return logActivity(drNumber, 'serial_reconciled', payload, actor);
}

/**
 * 1Map silently rejected a write (tenant ACL / record lock) — PR #1334 detects
 * this when the response body returns items:[] while claiming success:true.
 */
export async function log1MapWriteRejected(
  drNumber: string,
  payload: {
    propId: string;
    attemptedValue: string;
    reason: string;
    itemsReturned?: number;
  },
  actor: string
): Promise<string> {
  return logActivity(drNumber, '1map_write_rejected', payload, actor);
}

/**
 * Anomaly: a DR was previously reconciled on 1Map but still shows up in
 * Fibertime's weekly billing deductions. Dispute candidate.
 */
export async function logAnomalyFixedStillBilled(
  drNumber: string,
  payload: {
    noteCode: NoteCode;
    weekEnding: string;
    ourFixDate: string;
    weeksSinceFix: number;
  },
  actor: string = 'action-centre-recon'
): Promise<string> {
  return logActivity(drNumber, 'anomaly_fixed_still_billed', payload, actor);
}

/**
 * Anomaly: a DR has been flagged with the same note code for 3+ consecutive
 * weeks without a fix attempt — needs escalation.
 */
export async function logAnomalyPersistentNote(
  drNumber: string,
  payload: {
    noteCode: NoteCode;
    consecutiveWeeks: number;
    firstWeek: string;
    latestWeek: string;
  },
  actor: string = 'action-centre-recon'
): Promise<string> {
  return logActivity(drNumber, 'anomaly_persistent_note', payload, actor);
}

/**
 * A previously-resolved maintenance ticket transitioned back to an open-ish
 * status within 30 days. Pointer event into the Maintenance tab so the
 * Timeline renders "Maintenance reopened" with a link while the actual
 * content (photos, wizard) stays in the Maintenance tab (RFC §5.6 hybrid).
 */
export async function logMaintenanceReopened(
  drNumber: string,
  payload: {
    ticketId: string;
    ticketUid: string;
    daysSinceResolved: number;
    previousStatus: string;
    newStatus: string;
  },
  actor: string = 'action-centre-rule-engine',
): Promise<string> {
  return logActivity(drNumber, 'maintenance_reopened', payload, actor);
}
