/**
 * Activity Log Service
 *
 * Purpose: Track and query DR lifecycle events for the Activity tab timeline
 *
 * Events tracked:
 * - whatsapp_submitted: DR received via WhatsApp
 * - dr_acknowledged: Instant acknowledgment sent
 * - photos_fetched: Photos fetched from OneMap
 * - attribute_categorized: Phase 1 categorization complete
 * - vlm_qa_started: Phase 2 VLM QA started
 * - vlm_qa_completed: Phase 2 VLM QA finished
 * - human_review_started: Phase 3 human review started
 * - human_review_completed: Phase 3 human review finished
 * - feedback_generated: Feedback message generated
 * - feedback_sent: Feedback sent via WhatsApp
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Activity event types
 */
export type ActivityEventType =
  | 'whatsapp_submitted'
  | 'dr_acknowledged'
  | 'photos_fetched'
  | 'PHOTOS_SYNCED'
  | 'attribute_categorized'
  | 'vlm_qa_started'
  | 'vlm_qa_completed'
  | 'vlm_qa_failed'
  | 'human_review_started'
  | 'human_review_completed'
  | 'step_approved'
  | 'step_rejected'
  | 'feedback_generated'
  | 'feedback_sent'
  | 'error'
  | 'SERIAL_UPDATE'
  | 'SWAP_DETECTED'
  | 'INSTALLATION_MISMATCH'
  | 'SERIAL_HISTORY_ENTRY'
  | 'WA_PHOTO_VLM_PROCESSED'
  | 'SERIAL_CONFIRMED'
  | 'MANUAL_SERIAL_EDIT';

/**
 * Serial change source types
 */
export type SerialChangeSource =
  | 'onemap_sync'
  | 'manual_edit'
  | 'vlm_extraction'
  | 'wa_photo_vlm'
  | 'swap_correction'
  | 'migration';

/**
 * Serial change reason types
 */
export type SerialChangeReason =
  | 'technician_update'
  | 'swap_correction'
  | 'replacement'
  | 'data_fix'
  | 'initial_capture';

/**
 * Activity log entry
 */
export interface ActivityLogEntry {
  id: string;
  drop_number: string;
  event_type: ActivityEventType;
  event_data: Record<string, unknown>;
  actor: string | null;
  created_at: Date;
}

/**
 * Activity timeline entry (for UI display)
 */
export interface TimelineEntry {
  id: string;
  timestamp: Date;
  eventType: ActivityEventType;
  title: string;
  description: string;
  icon: string;
  iconColor: string;
  actor: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Activity summary for a DR
 */
export interface ActivitySummary {
  drNumber: string;
  totalEvents: number;
  firstEvent: Date | null;
  lastEvent: Date | null;
  currentPhase: 'submitted' | 'categorizing' | 'qa_validation' | 'human_review' | 'complete';
  phaseTimestamps: {
    submitted?: Date;
    categorized?: Date;
    qaStarted?: Date;
    qaCompleted?: Date;
    reviewStarted?: Date;
    reviewCompleted?: Date;
    feedbackSent?: Date;
  };
}

// ============================================================================
// EVENT METADATA
// ============================================================================

/**
 * Event display metadata
 */
const EVENT_METADATA: Record<ActivityEventType, { title: string; icon: string; iconColor: string }> = {
  whatsapp_submitted: {
    title: 'DR Submitted',
    icon: '📱',
    iconColor: 'text-green-500',
  },
  dr_acknowledged: {
    title: 'Acknowledgment Sent',
    icon: '✓',
    iconColor: 'text-blue-500',
  },
  photos_fetched: {
    title: 'Photos Fetched',
    icon: '📷',
    iconColor: 'text-purple-500',
  },
  PHOTOS_SYNCED: {
    title: 'Photos Synced',
    icon: '🔄',
    iconColor: 'text-blue-500',
  },
  attribute_categorized: {
    title: 'Photos Categorized',
    icon: '🏷️',
    iconColor: 'text-indigo-500',
  },
  vlm_qa_started: {
    title: 'QA Validation Started',
    icon: '🔍',
    iconColor: 'text-yellow-500',
  },
  vlm_qa_completed: {
    title: 'QA Validation Complete',
    icon: '✅',
    iconColor: 'text-green-500',
  },
  vlm_qa_failed: {
    title: 'QA Validation Failed',
    icon: '❌',
    iconColor: 'text-red-500',
  },
  human_review_started: {
    title: 'Human Review Started',
    icon: '👤',
    iconColor: 'text-blue-500',
  },
  human_review_completed: {
    title: 'Human Review Complete',
    icon: '✅',
    iconColor: 'text-green-500',
  },
  step_approved: {
    title: 'Step Approved',
    icon: '👍',
    iconColor: 'text-green-500',
  },
  step_rejected: {
    title: 'Step Rejected',
    icon: '👎',
    iconColor: 'text-red-500',
  },
  feedback_generated: {
    title: 'Feedback Generated',
    icon: '💬',
    iconColor: 'text-purple-500',
  },
  feedback_sent: {
    title: 'Feedback Sent',
    icon: '📤',
    iconColor: 'text-green-500',
  },
  error: {
    title: 'Error',
    icon: '⚠️',
    iconColor: 'text-red-500',
  },
  SERIAL_UPDATE: {
    title: 'Serial Changed',
    icon: '🔄',
    iconColor: 'text-orange-500',
  },
  SWAP_DETECTED: {
    title: 'Serials Swapped',
    icon: '⚠️',
    iconColor: 'text-red-500',
  },
  INSTALLATION_MISMATCH: {
    title: 'Installation Mismatch',
    icon: '🔴',
    iconColor: 'text-red-500',
  },
  SERIAL_HISTORY_ENTRY: {
    title: 'Serial Change Logged',
    icon: '📝',
    iconColor: 'text-blue-500',
  },
  WA_PHOTO_VLM_PROCESSED: {
    title: 'WA Photo Analyzed',
    icon: '🤖',
    iconColor: 'text-purple-500',
  },
  SERIAL_CONFIRMED: {
    title: 'Serial Confirmed',
    icon: '✓',
    iconColor: 'text-green-500',
  },
  MANUAL_SERIAL_EDIT: {
    title: 'Serial Manually Edited',
    icon: '✏️',
    iconColor: 'text-yellow-500',
  },
};

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

/**
 * Get database connection
 */
function getDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not configured');
  }
  return neon(connectionString);
}

/**
 * Log an activity event
 *
 * @param drNumber - DR number
 * @param eventType - Type of event
 * @param eventData - Additional event data
 * @param actorType - Who/what triggered the event
 * @param actorId - ID of the actor (user ID, system name, etc.)
 */
export async function logActivity(
  drNumber: string,
  eventType: ActivityEventType,
  eventData: Record<string, unknown> = {},
  actor: string = 'system'
): Promise<string> {
  const sql = getDb();

  try {
    const result = await sql`
      INSERT INTO dr_activity_log (drop_number, event_type, event_data, actor)
      VALUES (${drNumber}, ${eventType}, ${JSON.stringify(eventData)}, ${actor})
      RETURNING id
    `;

    const id = result[0]?.id;
    log.info('ActivityLog', `Logged ${eventType} for ${drNumber} (id: ${id})`);
    return id;
  } catch (error) {
    log.error('ActivityLog', `Failed to log activity for ${drNumber}: ${error}`);
    throw error;
  }
}

/**
 * Get activity history for a DR
 *
 * @param drNumber - DR number
 * @param limit - Max entries to return
 * @returns Array of activity log entries
 */
export async function getActivityHistory(
  drNumber: string,
  limit: number = 50
): Promise<ActivityLogEntry[]> {
  const sql = getDb();

  try {
    const rows = await sql`
      SELECT id, drop_number, event_type, event_data, actor, created_at
      FROM dr_activity_log
      WHERE drop_number = ${drNumber}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      id: row.id,
      drop_number: row.drop_number,
      event_type: row.event_type as ActivityEventType,
      event_data: row.event_data || {},
      actor: row.actor,
      created_at: new Date(row.created_at),
    }));
  } catch (error) {
    log.error('ActivityLog', `Failed to get activity history for ${drNumber}: ${error}`);
    throw error;
  }
}

/**
 * Get activity timeline for UI display
 * Combines activity log entries with DR timestamp fields for a complete timeline
 *
 * @param drNumber - DR number
 * @param limit - Max entries to return
 * @returns Array of timeline entries formatted for UI
 */
export async function getActivityTimeline(
  drNumber: string,
  limit: number = 50
): Promise<TimelineEntry[]> {
  const sql = getDb();
  const timeline: TimelineEntry[] = [];

  // 1. Get activity log entries
  const history = await getActivityHistory(drNumber, limit);

  // 2. Collect UUIDs that need name lookup (for legacy records)
  const uuidsToLookup = new Set<string>();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  for (const entry of history) {
    if (entry.event_type === 'human_review_completed') {
      const reviewer = entry.event_data?.reviewer;
      if (typeof reviewer === 'string' && uuidRegex.test(reviewer)) {
        uuidsToLookup.add(reviewer);
      }
    }
    // Also check actor field for UUID lookups
    if (entry.actor && uuidRegex.test(entry.actor)) {
      uuidsToLookup.add(entry.actor);
    }
  }

  // 3. Batch lookup user names for UUIDs
  const userNameMap = new Map<string, string>();
  if (uuidsToLookup.size > 0) {
    try {
      const uuidArray = Array.from(uuidsToLookup);
      const userRows = await sql`
        SELECT id::text, name FROM users WHERE id = ANY(${uuidArray}::uuid[])
      `;
      for (const row of userRows) {
        if (row.name) {
          userNameMap.set(row.id, row.name);
        }
      }
    } catch (err) {
      log.warn('ActivityLog', `Could not batch lookup user names: ${err}`);
    }
  }

  // 4. Build timeline entries with resolved names
  for (const entry of history) {
    const metadata = EVENT_METADATA[entry.event_type] || {
      title: entry.event_type,
      icon: '📌',
      iconColor: 'text-gray-500',
    };

    // Build description from event data
    let description = '';
    const data = entry.event_data;

    switch (entry.event_type) {
      case 'whatsapp_submitted':
        description = `Received from ${data.sender || 'unknown'} in ${data.group || 'unknown group'}`;
        break;
      case 'dr_acknowledged':
        description = `Acknowledgment sent with ${data.photoCount || 0} photos`;
        break;
      case 'photos_fetched':
        description = `${data.count || 0} photos from ${data.source || 'OneMap'}`;
        break;
      case 'PHOTOS_SYNCED':
        description = data.newPhotos
          ? `Synced ${data.newPhotos} new photos (${data.previousCount || 0} → ${data.newCount || 0})`
          : `${data.newCount || 0} photos synced from ${data.source || '1Map'}`;
        break;
      case 'attribute_categorized':
        description = `${data.categorized || 0}/${data.total || 0} photos categorized, ${data.needsVlm || 0} need VLM`;
        break;
      case 'vlm_qa_completed':
        description = `${data.passed || 0}/${data.total || 0} passed (${data.passRate || 0}%)`;
        break;
      case 'vlm_qa_failed':
        description = data.error ? String(data.error) : 'QA validation failed';
        break;
      case 'human_review_completed': {
        // Resolve reviewer name - check if it's a UUID and look it up
        let reviewerDisplay = data.reviewer || 'unknown';
        if (typeof reviewerDisplay === 'string' && uuidRegex.test(reviewerDisplay)) {
          reviewerDisplay = userNameMap.get(reviewerDisplay) || 'unknown';
        }
        const approvedCount = data.approved || 0;
        const rejectedCount = data.rejected || 0;
        description = `Reviewed by ${reviewerDisplay}. ${approvedCount} approved, ${rejectedCount} rejected`;
        break;
      }
      case 'step_approved':
        description = `Step ${data.step}: ${data.stepLabel || ''}`;
        break;
      case 'step_rejected':
        description = `Step ${data.step}: ${data.reason || 'No reason provided'}`;
        break;
      case 'feedback_sent':
        description = `Sent to ${data.group || 'WhatsApp group'}`;
        break;
      case 'error':
        description = data.message ? String(data.message) : 'An error occurred';
        break;
      case 'SERIAL_UPDATE':
        description = data.details ? String(data.details) : 'Serial number was updated';
        break;
      case 'SWAP_DETECTED':
        description = data.details ? String(data.details) : 'ONT and UPS serials appear swapped';
        break;
      case 'INSTALLATION_MISMATCH':
        description = data.details ? String(data.details) : '1Map serial differs from OES activated serial';
        break;
      default:
        description = JSON.stringify(data).slice(0, 100);
    }

    // Resolve actor name if it's a UUID
    let actorDisplay = entry.actor;
    if (actorDisplay && uuidRegex.test(actorDisplay)) {
      actorDisplay = userNameMap.get(actorDisplay) || actorDisplay;
    }

    timeline.push({
      id: entry.id,
      timestamp: entry.created_at,
      eventType: entry.event_type,
      title: metadata.title,
      description,
      icon: metadata.icon,
      iconColor: metadata.iconColor,
      actor: actorDisplay,
      metadata: entry.event_data,
    });
  }

  // 2. Get DR timestamps from dr_photo_unified_reviews
  log.info('ActivityLog', `Querying DR timestamps for ${drNumber}`);
  try {
    const drRows = await sql`
      SELECT
        wa_received_at,
        whatsapp_submitted_at,
        acknowledged_at,
        photos_fetched_at,
        vlm_categorized_at,
        ai_evaluated_at,
        vlm_qa_validated_at,
        human_review_completed_at,
        qa_decision_at,
        qa_decision,
        feedback_sent_at,
        serial_swap_detected_at,
        serial_swap_corrected_at,
        last_resubmitted_at,
        photo_count,
        sender_phone,
        project
      FROM dr_photo_unified_reviews
      WHERE drop_number = ${drNumber}
    `;

    log.info('ActivityLog', `DR query returned ${drRows.length} rows for ${drNumber}`);
    if (drRows.length > 0) {
      const dr = drRows[0];
      log.info('ActivityLog', `DR timestamps: wa_received=${dr.wa_received_at}, vlm_cat=${dr.vlm_categorized_at}`);

      // Add events from DR timestamps (only if not already in activity log)
      const existingEventTypes = new Set(history.map(h => h.event_type));

      // WhatsApp Received
      if (dr.wa_received_at && !existingEventTypes.has('whatsapp_submitted')) {
        timeline.push({
          id: `dr-wa-received-${drNumber}`,
          timestamp: new Date(dr.wa_received_at),
          eventType: 'whatsapp_submitted',
          title: '📱 DR Submitted via WhatsApp',
          description: dr.sender_phone ? `From ${dr.sender_phone}` : 'Received via WhatsApp',
          icon: '📱',
          iconColor: 'text-green-500',
          actor: 'whatsapp',
          metadata: { source: 'dr_record', sender: dr.sender_phone },
        });
      }

      // Acknowledgment sent
      if (dr.acknowledged_at && !existingEventTypes.has('dr_acknowledged')) {
        timeline.push({
          id: `dr-ack-${drNumber}`,
          timestamp: new Date(dr.acknowledged_at),
          eventType: 'dr_acknowledged',
          title: '✓ Acknowledgment Sent',
          description: dr.photo_count ? `${dr.photo_count} photos received` : 'DR acknowledged',
          icon: '✓',
          iconColor: 'text-blue-500',
          actor: 'system',
          metadata: { source: 'dr_record', photoCount: dr.photo_count },
        });
      }

      // Photos fetched
      if (dr.photos_fetched_at && !existingEventTypes.has('photos_fetched')) {
        timeline.push({
          id: `dr-photos-${drNumber}`,
          timestamp: new Date(dr.photos_fetched_at),
          eventType: 'photos_fetched',
          title: '📷 Photos Fetched',
          description: dr.photo_count ? `${dr.photo_count} photos from OneMap` : 'Photos fetched from OneMap',
          icon: '📷',
          iconColor: 'text-purple-500',
          actor: 'system',
          metadata: { source: 'dr_record', count: dr.photo_count },
        });
      }

      // VLM Categorization
      if (dr.vlm_categorized_at && !existingEventTypes.has('attribute_categorized')) {
        timeline.push({
          id: `dr-categorized-${drNumber}`,
          timestamp: new Date(dr.vlm_categorized_at),
          eventType: 'attribute_categorized',
          title: '🏷️ AI Photo Categorization',
          description: 'Photos categorized by VLM',
          icon: '🏷️',
          iconColor: 'text-indigo-500',
          actor: 'vlm',
          metadata: { source: 'dr_record' },
        });
      }

      // AI Data Extraction
      if (dr.ai_evaluated_at) {
        timeline.push({
          id: `dr-ai-eval-${drNumber}`,
          timestamp: new Date(dr.ai_evaluated_at),
          eventType: 'vlm_qa_completed',
          title: '🔍 AI Data Extraction',
          description: 'Power meter, serials extracted by VLM',
          icon: '🔍',
          iconColor: 'text-yellow-500',
          actor: 'vlm',
          metadata: { source: 'dr_record' },
        });
      }

      // VLM QA Validation
      if (dr.vlm_qa_validated_at) {
        timeline.push({
          id: `dr-vlm-qa-${drNumber}`,
          timestamp: new Date(dr.vlm_qa_validated_at),
          eventType: 'vlm_qa_completed',
          title: '✅ VLM QA Validated',
          description: 'Automated QA validation completed',
          icon: '✅',
          iconColor: 'text-green-500',
          actor: 'vlm',
          metadata: { source: 'dr_record' },
        });
      }

      // Human Review Completed
      if (dr.human_review_completed_at && !existingEventTypes.has('human_review_completed')) {
        timeline.push({
          id: `dr-human-review-${drNumber}`,
          timestamp: new Date(dr.human_review_completed_at),
          eventType: 'human_review_completed',
          title: '👤 Human Review Completed',
          description: 'Photo assignments reviewed by QA team',
          icon: '👤',
          iconColor: 'text-blue-500',
          actor: 'qa_team',
          metadata: { source: 'dr_record' },
        });
      }

      // QA Decision (Final)
      if (dr.qa_decision_at && dr.qa_decision) {
        const decisionIcon = dr.qa_decision === 'PASS' ? '✅' : dr.qa_decision === 'FAIL' ? '❌' : '🔄';
        const decisionColor = dr.qa_decision === 'PASS' ? 'text-green-500' : dr.qa_decision === 'FAIL' ? 'text-red-500' : 'text-orange-500';
        timeline.push({
          id: `dr-decision-${drNumber}`,
          timestamp: new Date(dr.qa_decision_at),
          eventType: 'human_review_completed',
          title: `${decisionIcon} Final Decision: ${dr.qa_decision}`,
          description: `QA decision recorded`,
          icon: decisionIcon,
          iconColor: decisionColor,
          actor: 'qa_team',
          metadata: { source: 'dr_record', decision: dr.qa_decision },
        });
      }

      // Feedback Sent
      if (dr.feedback_sent_at && !existingEventTypes.has('feedback_sent')) {
        timeline.push({
          id: `dr-feedback-${drNumber}`,
          timestamp: new Date(dr.feedback_sent_at),
          eventType: 'feedback_sent',
          title: '📤 WhatsApp Feedback Sent',
          description: 'QA feedback sent to technician',
          icon: '📤',
          iconColor: 'text-green-500',
          actor: 'system',
          metadata: { source: 'dr_record' },
        });
      }

      // Serial Swap Detected
      if (dr.serial_swap_detected_at && !existingEventTypes.has('SWAP_DETECTED')) {
        timeline.push({
          id: `dr-swap-detected-${drNumber}`,
          timestamp: new Date(dr.serial_swap_detected_at),
          eventType: 'SWAP_DETECTED',
          title: '⚠️ Serial Swap Detected',
          description: 'ONT and UPS serials appear swapped',
          icon: '⚠️',
          iconColor: 'text-red-500',
          actor: 'system',
          metadata: { source: 'dr_record' },
        });
      }

      // Serial Swap Corrected
      if (dr.serial_swap_corrected_at) {
        timeline.push({
          id: `dr-swap-fixed-${drNumber}`,
          timestamp: new Date(dr.serial_swap_corrected_at),
          eventType: 'SWAP_DETECTED',
          title: '✅ Serial Swap Corrected',
          description: 'Technician fixed the swapped serials in 1Map',
          icon: '✅',
          iconColor: 'text-green-500',
          actor: 'technician',
          metadata: { source: 'dr_record', corrected: true },
        });
      }

      // Resubmission
      if (dr.last_resubmitted_at) {
        timeline.push({
          id: `dr-resubmit-${drNumber}`,
          timestamp: new Date(dr.last_resubmitted_at),
          eventType: 'whatsapp_submitted',
          title: '🔄 DR Resubmitted',
          description: 'Additional photos submitted',
          icon: '🔄',
          iconColor: 'text-orange-500',
          actor: 'whatsapp',
          metadata: { source: 'dr_record', resubmission: true },
        });
      }
    }
  } catch (error) {
    log.warn('ActivityLog', `Failed to get DR timestamps for ${drNumber}: ${error}`);
  }

  // 3. Get OES activation data
  try {
    const oesRows = await sql`
      SELECT activation_date, serial_number, team, ont_rx_sig_dbm
      FROM oes_activations
      WHERE drop_number = ${drNumber}
      LIMIT 1
    `;

    if (oesRows.length > 0) {
      const oes = oesRows[0];
      if (oes.activation_date) {
        timeline.push({
          id: `oes-activation-${drNumber}`,
          timestamp: new Date(oes.activation_date),
          eventType: 'feedback_sent', // Using closest event type
          title: '⚡ OES Activation',
          description: `Activated by ${oes.team || 'OES'} - Serial: ${oes.serial_number || 'N/A'}`,
          icon: '⚡',
          iconColor: 'text-yellow-500',
          actor: oes.team || 'oes',
          metadata: {
            source: 'oes_activations',
            serial: oes.serial_number,
            team: oes.team,
            rxPower: oes.ont_rx_sig_dbm,
          },
        });
      }
    }
  } catch (error) {
    log.warn('ActivityLog', `Failed to get OES data for ${drNumber}: ${error}`);
  }

  // Sort by timestamp descending (most recent first)
  timeline.sort((a, b) => {
    const timeA = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
    const timeB = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
    return timeB - timeA;
  });

  return timeline.slice(0, limit);
}

/**
 * Get activity summary for a DR
 *
 * @param drNumber - DR number
 * @returns Activity summary with phase information
 */
export async function getActivitySummary(drNumber: string): Promise<ActivitySummary> {
  const sql = getDb();

  try {
    // Get all events for this DR
    const rows = await sql`
      SELECT event_type, created_at
      FROM dr_activity_log
      WHERE drop_number = ${drNumber}
      ORDER BY created_at ASC
    `;

    if (rows.length === 0) {
      return {
        drNumber,
        totalEvents: 0,
        firstEvent: null,
        lastEvent: null,
        currentPhase: 'submitted',
        phaseTimestamps: {},
      };
    }

    const phaseTimestamps: ActivitySummary['phaseTimestamps'] = {};

    // Extract phase timestamps
    for (const row of rows) {
      const eventType = row.event_type as ActivityEventType;
      const timestamp = new Date(row.created_at);

      switch (eventType) {
        case 'whatsapp_submitted':
          if (!phaseTimestamps.submitted) phaseTimestamps.submitted = timestamp;
          break;
        case 'attribute_categorized':
          phaseTimestamps.categorized = timestamp;
          break;
        case 'vlm_qa_started':
          phaseTimestamps.qaStarted = timestamp;
          break;
        case 'vlm_qa_completed':
          phaseTimestamps.qaCompleted = timestamp;
          break;
        case 'human_review_started':
          phaseTimestamps.reviewStarted = timestamp;
          break;
        case 'human_review_completed':
          phaseTimestamps.reviewCompleted = timestamp;
          break;
        case 'feedback_sent':
          phaseTimestamps.feedbackSent = timestamp;
          break;
      }
    }

    // Determine current phase
    let currentPhase: ActivitySummary['currentPhase'] = 'submitted';
    if (phaseTimestamps.feedbackSent) {
      currentPhase = 'complete';
    } else if (phaseTimestamps.reviewStarted) {
      currentPhase = 'human_review';
    } else if (phaseTimestamps.qaStarted) {
      currentPhase = 'qa_validation';
    } else if (phaseTimestamps.categorized) {
      currentPhase = 'categorizing';
    }

    const firstRow = rows[0];
    const lastRow = rows[rows.length - 1];

    return {
      drNumber,
      totalEvents: rows.length,
      firstEvent: firstRow ? new Date(firstRow.created_at) : null,
      lastEvent: lastRow ? new Date(lastRow.created_at) : null,
      currentPhase,
      phaseTimestamps,
    };
  } catch (error) {
    log.error('ActivityLog', `Failed to get activity summary for ${drNumber}: ${error}`);
    throw error;
  }
}

/**
 * Get recent activity across all DRs
 *
 * @param limit - Max entries to return
 * @param project - Optional project filter
 * @returns Array of recent activity entries
 */
export async function getRecentActivity(
  limit: number = 20,
  project?: string
): Promise<ActivityLogEntry[]> {
  const sql = getDb();

  try {
    let rows;

    if (project) {
      rows = await sql`
        SELECT al.id, al.drop_number, al.event_type, al.event_data, al.actor, al.created_at
        FROM dr_activity_log al
        JOIN dr_photo_unified_reviews dr ON al.drop_number = dr.drop_number
        WHERE dr.project = ${project}
        ORDER BY al.created_at DESC
        LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT id, drop_number, event_type, event_data, actor, created_at
        FROM dr_activity_log
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    }

    return rows.map((row) => ({
      id: row.id,
      drop_number: row.drop_number,
      event_type: row.event_type as ActivityEventType,
      event_data: row.event_data || {},
      actor: row.actor,
      created_at: new Date(row.created_at),
    }));
  } catch (error) {
    log.error('ActivityLog', `Failed to get recent activity: ${error}`);
    throw error;
  }
}

// ============================================================================
// CONVENIENCE LOGGING FUNCTIONS
// ============================================================================

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
      SELECT name FROM users WHERE id = ${userId}::uuid
    `;
    const firstRow = userRows[0];
    if (firstRow && firstRow.name) {
      reviewerName = String(firstRow.name);
    }
  } catch (err) {
    log.warn('ActivityLog', `Could not look up user name for ${userId}: ${err}`);
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

// ============================================================================
// SERIAL CHANGE TRACKING
// ============================================================================

/**
 * Log a serial change to both serial_change_history table and activity log
 *
 * This is the CENTRAL function for all serial change tracking.
 * Call this whenever an ONT or UPS serial value changes.
 *
 * @param drNumber - The DR number
 * @param changeType - 'ont_serial' or 'ups_serial'
 * @param oldValue - Previous serial value (null for initial capture)
 * @param newValue - New serial value
 * @param source - Where the change came from
 * @param actor - Who/what made the change
 * @param reason - Why the change was made (optional)
 * @param metadata - Additional context (optional)
 */
export async function logSerialChange(
  drNumber: string,
  changeType: 'ont_serial' | 'ups_serial',
  oldValue: string | null,
  newValue: string | null,
  source: SerialChangeSource,
  actor: string = 'system',
  reason?: SerialChangeReason,
  metadata?: Record<string, unknown>
): Promise<{ historyId: string; activityId: string }> {
  const sql = getDb();

  // Skip if no actual change (same value)
  if (oldValue === newValue) {
    log.debug(`[SerialChange] Skipped - no change for ${drNumber} ${changeType}: ${oldValue}`);
    return { historyId: '', activityId: '' };
  }

  // Detect if this looks like a swap
  const swapDetected = detectSwapPattern(changeType, newValue);

  const fullMetadata = {
    ...metadata,
    swap_detected: swapDetected,
    change_classification: oldValue === null ? 'initial_capture' : 'updated',
  };

  try {
    // 1. Insert into serial_change_history table
    const historyResult = await sql`
      INSERT INTO serial_change_history (
        drop_number,
        change_type,
        old_value,
        new_value,
        change_source,
        change_reason,
        actor,
        metadata
      )
      VALUES (
        ${drNumber},
        ${changeType},
        ${oldValue},
        ${newValue},
        ${source},
        ${reason || null},
        ${actor},
        ${JSON.stringify(fullMetadata)}
      )
      RETURNING id
    `;

    const historyId = historyResult[0]?.id || '';

    // 2. Also log to dr_activity_log for timeline display
    const eventData = {
      change_type: changeType,
      old_value: oldValue,
      new_value: newValue,
      source,
      reason,
      history_id: historyId,
      swap_detected: swapDetected,
    };

    const activityId = await logActivity(drNumber, 'SERIAL_HISTORY_ENTRY', eventData, actor);

    log.info(
      `[SerialChange] Logged ${changeType} change for ${drNumber}: ${oldValue || 'NULL'} → ${newValue || 'NULL'} (source: ${source})`
    );

    return { historyId, activityId };
  } catch (error) {
    log.error(`[SerialChange] Failed to log change for ${drNumber}:`, error);
    throw error;
  }
}

/**
 * Detect if a serial value looks like it's in the wrong field (swap pattern)
 */
function detectSwapPattern(changeType: 'ont_serial' | 'ups_serial', value: string | null): boolean {
  if (!value) return false;

  // ONT serials start with ALCL or ALCB
  const isOntPattern = /^ALC[LB]/i.test(value);
  // UPS serials start with GU18W
  const isUpsPattern = /^GU18W/i.test(value);

  if (changeType === 'ont_serial' && isUpsPattern) {
    return true; // UPS serial in ONT field = swap
  }
  if (changeType === 'ups_serial' && isOntPattern) {
    return true; // ONT serial in UPS field = swap
  }

  return false;
}

/**
 * Get serial change history for a DR
 */
export async function getSerialHistory(
  drNumber: string,
  limit: number = 50
): Promise<Array<{
  id: string;
  change_type: string;
  old_value: string | null;
  new_value: string | null;
  change_source: string;
  change_reason: string | null;
  actor: string;
  metadata: Record<string, unknown>;
  detected_at: Date;
}>> {
  const sql = getDb();

  const result = await sql`
    SELECT
      id,
      change_type,
      old_value,
      new_value,
      change_source,
      change_reason,
      actor,
      metadata,
      detected_at
    FROM serial_change_history
    WHERE drop_number = ${drNumber}
    ORDER BY detected_at DESC
    LIMIT ${limit}
  `;

  return result as Array<{
    id: string;
    change_type: string;
    old_value: string | null;
    new_value: string | null;
    change_source: string;
    change_reason: string | null;
    actor: string;
    metadata: Record<string, unknown>;
    detected_at: Date;
  }>;
}

/**
 * Log WA photo VLM processing result
 */
export async function logWaPhotoVlmProcessed(
  drNumber: string,
  photoId: string,
  extractedOnt: string | null,
  extractedUps: string | null,
  confidence: number,
  matchStatus: 'match' | 'mismatch' | 'partial'
): Promise<string> {
  return logActivity(
    drNumber,
    'WA_PHOTO_VLM_PROCESSED',
    {
      photo_id: photoId,
      extracted_ont: extractedOnt,
      extracted_ups: extractedUps,
      confidence,
      match_status: matchStatus,
    },
    'vlm'
  );
}
