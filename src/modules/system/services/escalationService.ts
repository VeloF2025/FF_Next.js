/**
 * Escalation Service
 *
 * Handles alerting and escalation for infrastructure incidents.
 * Supports dashboard, WhatsApp, and email channels.
 */

import { log } from '@/lib/logger';

// Normalize query result to always have rows array
function normalizeResult<T>(result: unknown): { rows: T[]; rowCount: number } {
  if (Array.isArray(result)) {
    return { rows: result as T[], rowCount: result.length };
  }
  const r = result as { rows?: T[]; rowCount?: number };
  return { rows: r.rows || [], rowCount: r.rowCount || r.rows?.length || 0 };
}

// Use dynamic import to avoid bundling issues
async function getDb() {
  const module = await import('@/lib/db');
  // Try named export first, fallback to default
  const db = module.db || module.default;
  if (!db) {
    throw new Error('Database connection not available');
  }
  // Wrap db to normalize query results
  return {
    query: async <T = Record<string, unknown>>(text: string, values?: unknown[]) => {
      const result = await db.query(text, values);
      return normalizeResult<T>(result);
    }
  };
}
import type {
  EscalationLevel,
  EscalationChannel,
  RiskLevel,
  AlertResult,
  ApprovalQueueItem,
  AlertSuppression,
  SuppressionInput,
} from '../types/self-healing.types';

// Rate limiting (in-memory)
const alertRateLimit = new Map<string, { count: number; firstAlert: Date }>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 5; // Max 5 alerts per window per service

// WhatsApp configuration
const WA_FEEDBACK_URL = process.env.WA_FEEDBACK_URL || 'http://100.96.203.105:8092';
const WA_GROUP_JID = process.env.WA_INFRA_GROUP_JID || '120363421664266245@g.us'; // Velo Test group

// ============================================
// Alert Message Formatting
// ============================================

interface AlertDetails {
  incidentId: string;
  actionId: string;
  actionName: string;
  riskLevel: RiskLevel;
  queueId: string;
  serviceName?: string;
  issueType?: string;
  symptoms?: string[];
  urgent?: boolean;
}

/**
 * Format alert message for WhatsApp
 */
export function formatWhatsAppMessage(details: AlertDetails): string {
  const urgentPrefix = details.urgent ? '🚨 *URGENT* ' : '⚠️ ';
  const riskEmoji = details.riskLevel === 'dangerous' ? '🔴' : '🟡';

  let message = `${urgentPrefix}*INFRASTRUCTURE ALERT*\n\n`;
  message += `*Service:* ${details.serviceName || 'Unknown'}\n`;
  message += `*Status:* Issue detected\n`;

  if (details.issueType) {
    message += `*Issue Type:* ${details.issueType}\n`;
  }

  if (details.symptoms && details.symptoms.length > 0) {
    message += `\n*Symptoms:*\n`;
    details.symptoms.forEach((s) => {
      message += `• ${s}\n`;
    });
  }

  message += `\n*Suggested Action:* ${details.actionName}\n`;
  message += `*Risk Level:* ${riskEmoji} ${details.riskLevel.toUpperCase()}\n`;

  message += `\n_Reply "approve" or "reject" to respond_\n`;
  message += `_Token: ${details.queueId.slice(0, 8)}_`;

  return message;
}

/**
 * Format dashboard notification
 */
export function formatDashboardNotification(details: AlertDetails): {
  title: string;
  body: string;
  type: 'warning' | 'error';
} {
  return {
    title: `${details.urgent ? 'URGENT: ' : ''}Infrastructure Alert`,
    body: `${details.serviceName}: ${details.actionName} requires approval`,
    type: details.riskLevel === 'dangerous' ? 'error' : 'warning',
  };
}

// ============================================
// Alert Suppression
// ============================================

/**
 * Check if alerts are suppressed for a service
 */
export async function isAlertSuppressed(serviceId: string): Promise<{
  suppressed: boolean;
  reason?: string;
}> {
  const now = new Date();

  const db = await getDb();
  const result = await db.query(
    `
    SELECT reason
    FROM alert_suppressions
    WHERE service_id = $1
      AND starts_at <= $2
      AND ends_at >= $2
    LIMIT 1
  `,
    [serviceId, now]
  );

  if (result.rows.length > 0) {
    return {
      suppressed: true,
      reason: result.rows[0].reason,
    };
  }

  return { suppressed: false };
}

/**
 * Check for duplicate alerts
 */
export async function isDuplicateAlert(
  serviceId: string,
  issueType: string,
  windowMinutes: number = 30
): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

  const db = await getDb();
  const result = await db.query(
    `
    SELECT COUNT(*) as count
    FROM recovery_approval_queue q
    JOIN infrastructure_incidents i ON q.incident_id = i.id
    WHERE i.service_id = $1
      AND i.issue_type = $2
      AND q.requested_at >= $3
  `,
    [serviceId, issueType, windowStart]
  );

  return parseInt(result.rows[0].count, 10) > 0;
}

/**
 * Check rate limit for service alerts
 */
export function isRateLimited(serviceId: string): boolean {
  const now = new Date();
  const record = alertRateLimit.get(serviceId);

  if (!record) {
    return false;
  }

  // Check if window has expired
  if (now.getTime() - record.firstAlert.getTime() > RATE_LIMIT_WINDOW_MS) {
    alertRateLimit.delete(serviceId);
    return false;
  }

  return record.count >= RATE_LIMIT_MAX;
}

/**
 * Record an alert for rate limiting
 */
function recordAlertForRateLimit(serviceId: string): void {
  const now = new Date();
  const record = alertRateLimit.get(serviceId);

  if (!record || now.getTime() - record.firstAlert.getTime() > RATE_LIMIT_WINDOW_MS) {
    alertRateLimit.set(serviceId, { count: 1, firstAlert: now });
  } else {
    record.count++;
  }
}

/**
 * Create alert suppression
 */
export async function createSuppression(input: SuppressionInput): Promise<AlertSuppression> {
  const db = await getDb();
  const result = await db.query(
    `
    INSERT INTO alert_suppressions (
      service_id,
      reason,
      starts_at,
      ends_at,
      created_by
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING
      id,
      service_id as "serviceId",
      reason,
      starts_at as "startsAt",
      ends_at as "endsAt",
      created_by as "createdBy",
      created_at as "createdAt"
  `,
    [
      input.serviceId,
      input.reason,
      input.startsAt,
      input.endsAt,
      input.createdBy || null,
    ]
  );

  log.info(`[EscalationService] Created suppression for service ${input.serviceId}: ${input.reason}`);
  return result.rows[0];
}

/**
 * Get active suppressions
 */
export async function getActiveSuppressions(): Promise<AlertSuppression[]> {
  const now = new Date();

  const db = await getDb();
  const result = await db.query(
    `
    SELECT
      id,
      service_id as "serviceId",
      reason,
      starts_at as "startsAt",
      ends_at as "endsAt",
      created_by as "createdBy",
      created_at as "createdAt"
    FROM alert_suppressions
    WHERE starts_at <= $1 AND ends_at >= $1
    ORDER BY ends_at
  `,
    [now]
  );

  return result.rows;
}

/**
 * Delete suppression
 */
export async function deleteSuppression(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.query(
    `DELETE FROM alert_suppressions WHERE id = $1 RETURNING id`,
    [id]
  );

  return (result.rowCount ?? 0) > 0;
}

// ============================================
// Escalation Level Determination
// ============================================

/**
 * Determine escalation level based on risk and context
 */
export function determineEscalationLevel(
  riskLevel: RiskLevel,
  isCriticalService: boolean = false,
  consecutiveFailures: number = 0
): EscalationLevel {
  // Dangerous actions or critical services always go to level 3
  if (riskLevel === 'dangerous' || (isCriticalService && consecutiveFailures >= 2)) {
    return 3;
  }

  // Moderate actions or repeated failures go to level 2
  if (riskLevel === 'moderate' || consecutiveFailures >= 1) {
    return 2;
  }

  // Safe actions start at level 1 (dashboard only)
  return 1;
}

/**
 * Get escalation channel for level
 */
export function getChannelForLevel(level: EscalationLevel): EscalationChannel {
  switch (level) {
    case 1:
      return 'dashboard';
    case 2:
    case 3:
      return 'whatsapp';
    default:
      return 'dashboard';
  }
}

// ============================================
// WhatsApp Alert Sending
// ============================================

/**
 * Send WhatsApp alert
 */
export async function sendWhatsAppAlert(details: AlertDetails): Promise<AlertResult> {
  // Get service details
  let serviceName = details.serviceName;
  let serviceId: string | undefined;

  if (!serviceName && details.actionId) {
    const actionResult = await db.query(
      `
      SELECT s.id, s.name
      FROM recovery_actions a
      JOIN infrastructure_services s ON a.service_id = s.id
      WHERE a.id = $1
    `,
      [details.actionId]
    );

    if (actionResult.rows.length > 0) {
      serviceName = actionResult.rows[0].name;
      serviceId = actionResult.rows[0].id;
    }
  }

  // Get incident details
  if (details.incidentId) {
    const incidentResult = await db.query(
      `
      SELECT issue_type, symptoms, service_id
      FROM infrastructure_incidents
      WHERE id = $1
    `,
      [details.incidentId]
    );

    if (incidentResult.rows.length > 0) {
      const incident = incidentResult.rows[0];
      details.issueType = incident.issue_type;
      details.symptoms = incident.symptoms;
      serviceId = serviceId || incident.service_id;
    }
  }

  details.serviceName = serviceName;

  // Check suppression
  if (serviceId) {
    const { suppressed, reason } = await isAlertSuppressed(serviceId);
    if (suppressed) {
      log.info(`[EscalationService] Alert suppressed for ${serviceName}: ${reason}`);
      return {
        success: false,
        channel: 'whatsapp',
        suppressed: true,
        suppressionReason: reason,
      };
    }

    // Check rate limit
    if (isRateLimited(serviceId)) {
      log.warn(`[EscalationService] Alert rate limited for ${serviceName}`);
      return {
        success: false,
        channel: 'whatsapp',
        error: 'Rate limited',
      };
    }
  }

  // Check for duplicate
  if (serviceId && details.issueType) {
    const isDuplicate = await isDuplicateAlert(serviceId, details.issueType);
    if (isDuplicate) {
      log.info(`[EscalationService] Duplicate alert suppressed for ${serviceName}`);
      return {
        success: false,
        channel: 'whatsapp',
        suppressed: true,
        suppressionReason: 'Duplicate alert within window',
      };
    }
  }

  // Format message
  const message = formatWhatsAppMessage(details);

  try {
    // Send via WA Feedback service
    const response = await fetch(`${WA_FEEDBACK_URL}/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_jid: WA_GROUP_JID,
        message,
      }),
    });

    if (!response.ok) {
      throw new Error(`WA service returned ${response.status}`);
    }

    const result = await response.json();

    // Record for rate limiting
    if (serviceId) {
      recordAlertForRateLimit(serviceId);
    }

    log.info(`[EscalationService] WhatsApp alert sent for ${serviceName}`);

    return {
      success: true,
      channel: 'whatsapp',
      messageId: result.messageId,
    };
  } catch (error) {
    log.error('[EscalationService] Failed to send WhatsApp alert:', error);

    return {
      success: false,
      channel: 'whatsapp',
      error: error instanceof Error ? error.message : 'Failed to send',
    };
  }
}

// ============================================
// Approval Queue Management
// ============================================

/**
 * Get approval queue with filtering
 */
export async function getApprovalQueue(filters?: {
  status?: string;
  riskLevel?: RiskLevel;
  escalationLevel?: EscalationLevel;
}): Promise<ApprovalQueueItem[]> {
  let query = `
    SELECT
      q.id,
      q.incident_id as "incidentId",
      q.action_id as "actionId",
      a.action_name as "actionName",
      s.name as "serviceName",
      a.risk_level as "riskLevel",
      q.requested_at as "requestedAt",
      q.escalation_level as "escalationLevel",
      q.escalation_channel as "escalationChannel",
      q.approval_token as "approvalToken",
      q.token_expires_at as "tokenExpiresAt",
      q.status,
      q.decided_by as "decidedBy",
      q.decided_at as "decidedAt",
      q.decision_reason as "decisionReason",
      q.executed,
      q.execution_success as "executionSuccess",
      i.issue_type as "incidentIssueType",
      i.symptoms as "incidentSymptoms",
      i.created_at as "incidentCreatedAt"
    FROM recovery_approval_queue q
    JOIN recovery_actions a ON q.action_id = a.id
    JOIN infrastructure_services s ON a.service_id = s.id
    JOIN infrastructure_incidents i ON q.incident_id = i.id
    WHERE 1=1
  `;

  const params: (string | number)[] = [];

  if (filters?.status) {
    params.push(filters.status);
    query += ` AND q.status = $${params.length}`;
  }

  if (filters?.riskLevel) {
    params.push(filters.riskLevel);
    query += ` AND a.risk_level = $${params.length}`;
  }

  if (filters?.escalationLevel) {
    params.push(filters.escalationLevel);
    query += ` AND q.escalation_level = $${params.length}`;
  }

  query += ` ORDER BY q.escalation_level DESC, q.requested_at ASC`;

  const db = await getDb();
  const result = await db.query(query, params);

  return result.rows.map((row) => ({
    ...row,
    incident: {
      issueType: row.incidentIssueType,
      symptoms: row.incidentSymptoms,
      createdAt: row.incidentCreatedAt,
    },
  }));
}

/**
 * Get pending approval count
 */
export async function getPendingCount(): Promise<number> {
  const db = await getDb();
  const result = await db.query(`
    SELECT COUNT(*) as count
    FROM recovery_approval_queue
    WHERE status = 'pending'
  `);

  return parseInt(result.rows[0].count, 10);
}

/**
 * Expire old pending approvals
 */
export async function expireOldApprovals(): Promise<number> {
  const db = await getDb();
  const result = await db.query(`
    UPDATE recovery_approval_queue SET
      status = 'auto_expired'
    WHERE status = 'pending'
      AND token_expires_at < NOW()
    RETURNING id
  `);

  const count = result.rowCount ?? 0;
  if (count > 0) {
    log.info(`[EscalationService] Expired ${count} pending approvals`);
  }

  return count;
}

/**
 * Process WhatsApp approval response
 */
export async function processWhatsAppResponse(
  token: string,
  response: 'approve' | 'reject',
  fromNumber: string
): Promise<{ success: boolean; error?: string }> {
  // Find pending item by token prefix
  const db = await getDb();
  const result = await db.query(
    `
    SELECT id, token_expires_at
    FROM recovery_approval_queue
    WHERE id LIKE $1 || '%'
      AND status = 'pending'
    LIMIT 1
  `,
    [token]
  );

  if (result.rows.length === 0) {
    return { success: false, error: 'Approval not found or already processed' };
  }

  const item = result.rows[0];

  // Check expiry
  if (new Date(item.token_expires_at) < new Date()) {
    return { success: false, error: 'Approval token expired' };
  }

  // Import recovery service to handle the action
  const { recoveryService } = await import('./recoveryService');

  if (response === 'approve') {
    await recoveryService.approveAction(item.id, fromNumber, 'Approved via WhatsApp');
  } else {
    await recoveryService.rejectAction(item.id, fromNumber, 'Rejected via WhatsApp');
  }

  return { success: true };
}

// Export as service object
export const escalationService = {
  formatWhatsAppMessage,
  formatDashboardNotification,
  isAlertSuppressed,
  isDuplicateAlert,
  isRateLimited,
  createSuppression,
  getActiveSuppressions,
  deleteSuppression,
  determineEscalationLevel,
  getChannelForLevel,
  sendWhatsAppAlert,
  getApprovalQueue,
  getPendingCount,
  expireOldApprovals,
  processWhatsAppResponse,
};

export default escalationService;
