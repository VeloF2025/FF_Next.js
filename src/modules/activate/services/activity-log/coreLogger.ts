/**
 * Core Activity Logger - logActivity and query functions
 */

import { log } from '@/lib/logger';
import { getDb } from './_shared';
import type { ActivityEventType, ActivityLogEntry, ActivitySummary } from './_shared';

/**
 * Log an activity event
 *
 * @param drNumber - DR number
 * @param eventType - Type of event
 * @param eventData - Additional event data
 * @param actor - Who/what triggered the event
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
