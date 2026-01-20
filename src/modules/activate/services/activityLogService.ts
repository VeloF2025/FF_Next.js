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
  | 'INSTALLATION_MISMATCH';

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
 *
 * @param drNumber - DR number
 * @param limit - Max entries to return
 * @returns Array of timeline entries formatted for UI
 */
export async function getActivityTimeline(
  drNumber: string,
  limit: number = 50
): Promise<TimelineEntry[]> {
  const history = await getActivityHistory(drNumber, limit);

  return history.map((entry) => {
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
      case 'attribute_categorized':
        description = `${data.categorized || 0}/${data.total || 0} photos categorized, ${data.needsVlm || 0} need VLM`;
        break;
      case 'vlm_qa_completed':
        description = `${data.passed || 0}/${data.total || 0} passed (${data.passRate || 0}%)`;
        break;
      case 'vlm_qa_failed':
        description = data.error ? String(data.error) : 'QA validation failed';
        break;
      case 'human_review_completed':
        description = `Reviewed by ${data.reviewer || 'unknown'}`;
        break;
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

    return {
      id: entry.id,
      timestamp: entry.created_at,
      eventType: entry.event_type,
      title: metadata.title,
      description,
      icon: metadata.icon,
      iconColor: metadata.iconColor,
      actor: entry.actor,
      metadata: entry.event_data,
    };
  });
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
  return logActivity(
    drNumber,
    'human_review_completed',
    { reviewer: userId, approved, rejected },
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
