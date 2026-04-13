/**
 * Incident Learning Service
 *
 * Accumulates knowledge from recovery attempts. Tracks success/failure rates,
 * auto-adjusts action risk classifications, respects human overrides,
 * and exports learnings to knowledge base files.
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
import * as fs from 'fs';
import * as path from 'path';
import type {
  RiskLevel,
  RecoveryOverride,
  OverrideInput,
  OverrideHistory,
  ClassificationSuggestion,
  SuggestionInput,
  ClassificationAdjustmentResult,
  ConsecutiveCounts,
  SuccessRate,
  MTTR,
  CommonFailure,
  ActionTrend,
  PeriodComparison,
  TimeRangeStats,
  KBExportResult,
  KBIndexEntry,
  Incident,
} from '../types/self-healing.types';
import { serviceRegistry } from './serviceRegistry';

// Classification thresholds
const DEFAULT_THRESHOLDS = {
  safeToModerate: 3, // 3 consecutive failures
  moderateToSafe: 10, // 10 consecutive successes
  approvalToDemote: 5, // 5 consecutive approvals
  rejectionToPromote: 3, // 3 consecutive rejections
};

const KB_BASE_PATH = '.claude/knowledge-base/incidents';

// ============================================
// Success/Failure Tracking
// ============================================

/**
 * Track successful action execution
 */
export async function trackSuccess(actionId: string, _incidentId: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `
    UPDATE recovery_actions SET
      success_count = success_count + 1,
      consecutive_success = consecutive_success + 1,
      consecutive_failure = 0,
      last_success = NOW()
    WHERE id = $1
  `,
    [actionId]
  );

  log.info(`[IncidentLearning] Tracked success for action ${actionId}`);
}

/**
 * Track failed action execution
 */
export async function trackFailure(
  actionId: string,
  incidentId: string,
  errorMessage?: string
): Promise<void> {
  const db = await getDb();
  await db.query(
    `
    UPDATE recovery_actions SET
      failure_count = failure_count + 1,
      consecutive_failure = consecutive_failure + 1,
      consecutive_success = 0,
      last_failure = NOW()
    WHERE id = $1
  `,
    [actionId]
  );

  log.info(`[IncidentLearning] Tracked failure for action ${actionId}: ${errorMessage}`);
}

/**
 * Get success rate for an action
 */
export async function getSuccessRate(actionId: string): Promise<number | null> {
  const db = await getDb();
  const result = await db.query<{ success_count: number; failure_count: number }>(
    `
    SELECT success_count, failure_count
    FROM recovery_actions
    WHERE id = $1
  `,
    [actionId]
  );

  if (result.rows.length === 0) return null;

  const { success_count, failure_count } = result.rows[0]!;
  const total = success_count + failure_count;

  if (total === 0) return null;

  return Math.round((success_count / total) * 100 * 10) / 10;
}

/**
 * Track resolution time for an incident
 */
export async function trackResolutionTime(
  incidentId: string,
  resolvedAt: Date
): Promise<void> {
  // Get incident creation time
  const db = await getDb();
  const result = await db.query<{ created_at: string }>(
    `SELECT created_at FROM infrastructure_incidents WHERE id = $1`,
    [incidentId]
  );

  if (result.rows.length === 0) return;

  const createdAt = new Date(result.rows[0]!.created_at);
  const durationSeconds = Math.floor((resolvedAt.getTime() - createdAt.getTime()) / 1000);

  await db.query(
    `
    UPDATE infrastructure_incidents SET
      resolved = true,
      resolved_at = $2,
      time_to_resolve_seconds = $3
    WHERE id = $1
  `,
    [incidentId, resolvedAt, durationSeconds]
  );

  log.info(`[IncidentLearning] Tracked resolution time: ${durationSeconds}s for incident ${incidentId}`);
}

/**
 * Track attempt count for an incident
 */
export async function trackAttempts(incidentId: string): Promise<{ attemptCount: number }> {
  const db = await getDb();
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM incident_actions WHERE incident_id = $1`,
    [incidentId]
  );

  return { attemptCount: parseInt(result.rows[0]!.count, 10) };
}

/**
 * Get resolution method for an incident
 */
export async function getResolutionMethod(incidentId: string): Promise<{
  actionId: string;
  actionName: string;
  attemptNumber: number;
} | null> {
  const db = await getDb();
  const result = await db.query<{ actionId: string; actionName: string; attemptNumber: number }>(
    `
    SELECT
      ia.action_id as "actionId",
      ra.action_name as "actionName",
      ia.attempt_number as "attemptNumber"
    FROM incident_actions ia
    JOIN recovery_actions ra ON ia.action_id = ra.id
    WHERE ia.incident_id = $1 AND ia.success = true
    ORDER BY ia.attempt_number DESC
    LIMIT 1
  `,
    [incidentId]
  );

  return result.rows[0] || null;
}

// ============================================
// Auto-Classification Adjustment
// ============================================

/**
 * Get consecutive counts for an action
 */
export async function getConsecutiveCounts(actionId: string): Promise<ConsecutiveCounts | null> {
  const db = await getDb();
  const result = await db.query<ConsecutiveCounts>(
    `
    SELECT
      consecutive_success as "consecutiveSuccess",
      consecutive_failure as "consecutiveFailure",
      risk_level as "currentRiskLevel",
      auto_adjust_enabled as "autoAdjustEnabled"
    FROM recovery_actions
    WHERE id = $1
  `,
    [actionId]
  );

  return result.rows[0] || null;
}

/**
 * Check and adjust classification based on performance
 */
export async function checkAndAdjustClassification(
  actionId: string,
  thresholds?: { failureThreshold?: number; successThreshold?: number }
): Promise<ClassificationAdjustmentResult> {
  const counts = await getConsecutiveCounts(actionId);

  if (!counts) {
    return { changed: false, oldLevel: 'safe', newLevel: 'safe', reason: 'Action not found' };
  }

  // Check if auto-adjust is disabled
  if (!counts.autoAdjustEnabled) {
    return {
      changed: false,
      oldLevel: counts.currentRiskLevel,
      newLevel: counts.currentRiskLevel,
      reason: 'Auto-adjust disabled for this action',
    };
  }

  const failureThreshold = thresholds?.failureThreshold || DEFAULT_THRESHOLDS.safeToModerate;
  const successThreshold = thresholds?.successThreshold || DEFAULT_THRESHOLDS.moderateToSafe;

  // Dangerous actions never auto-adjust
  if (counts.currentRiskLevel === 'dangerous') {
    return {
      changed: false,
      oldLevel: 'dangerous',
      newLevel: 'dangerous',
      reason: 'Dangerous actions require manual adjustment',
      thresholdUsed: { failureThreshold, successThreshold },
    };
  }

  // Check for promotion (safe → moderate after failures)
  if (counts.currentRiskLevel === 'safe' && counts.consecutiveFailure >= failureThreshold) {
    await promoteRiskLevel(actionId, 'safe', 'moderate');
    return {
      changed: true,
      oldLevel: 'safe',
      newLevel: 'moderate',
      reason: `Promoted after ${failureThreshold} consecutive failures`,
      thresholdUsed: { failureThreshold, successThreshold },
    };
  }

  // Check for demotion (moderate → safe after successes)
  if (counts.currentRiskLevel === 'moderate' && counts.consecutiveSuccess >= successThreshold) {
    await demoteRiskLevel(actionId, 'moderate', 'safe');
    return {
      changed: true,
      oldLevel: 'moderate',
      newLevel: 'safe',
      reason: `Demoted after ${successThreshold} consecutive successes`,
      thresholdUsed: { failureThreshold, successThreshold },
    };
  }

  return {
    changed: false,
    oldLevel: counts.currentRiskLevel,
    newLevel: counts.currentRiskLevel,
    thresholdUsed: { failureThreshold, successThreshold },
  };
}

/**
 * Reset consecutive counters
 */
export async function resetConsecutiveCounters(
  actionId: string,
  type: 'success' | 'failure'
): Promise<{ consecutiveSuccess: number; consecutiveFailure: number }> {
  const db = await getDb();
  if (type === 'success') {
    await db.query(
      `
      UPDATE recovery_actions SET
        consecutive_success = 1,
        consecutive_failure = 0
      WHERE id = $1
    `,
      [actionId]
    );
    return { consecutiveSuccess: 1, consecutiveFailure: 0 };
  } else {
    await db.query(
      `
      UPDATE recovery_actions SET
        consecutive_success = 0,
        consecutive_failure = 1
      WHERE id = $1
    `,
      [actionId]
    );
    return { consecutiveSuccess: 0, consecutiveFailure: 1 };
  }
}

/**
 * Promote action risk level
 */
export async function promoteRiskLevel(
  actionId: string,
  oldLevel: RiskLevel,
  newLevel: RiskLevel
): Promise<{ success: boolean; oldLevel: RiskLevel; newLevel: RiskLevel; eventLogged: boolean }> {
  const db = await getDb();
  await db.query(
    `
    UPDATE recovery_actions SET
      risk_level = $2,
      requires_approval = true,
      updated_at = NOW()
    WHERE id = $1
  `,
    [actionId, newLevel]
  );

  // Log the event
  log.warn(`[IncidentLearning] Promoted action ${actionId} from ${oldLevel} to ${newLevel}`);

  return { success: true, oldLevel, newLevel, eventLogged: true };
}

/**
 * Demote action risk level
 */
export async function demoteRiskLevel(
  actionId: string,
  oldLevel: RiskLevel,
  newLevel: RiskLevel
): Promise<{ success: boolean; oldLevel: RiskLevel; newLevel: RiskLevel; eventLogged: boolean }> {
  const db = await getDb();
  await db.query(
    `
    UPDATE recovery_actions SET
      risk_level = $2,
      requires_approval = $3,
      updated_at = NOW()
    WHERE id = $1
  `,
    [actionId, newLevel, newLevel !== 'safe']
  );

  log.info(`[IncidentLearning] Demoted action ${actionId} from ${oldLevel} to ${newLevel}`);

  return { success: true, oldLevel, newLevel, eventLogged: true };
}

/**
 * Set auto-adjust enabled/disabled
 */
export async function setAutoAdjustEnabled(actionId: string, enabled: boolean): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE recovery_actions SET auto_adjust_enabled = $2 WHERE id = $1`,
    [actionId, enabled]
  );
}

// ============================================
// Human Override Learning
// ============================================

/**
 * Record human override
 */
export async function recordOverride(input: OverrideInput): Promise<RecoveryOverride> {
  const db = await getDb();
  const result = await db.query<RecoveryOverride>(
    `
    INSERT INTO recovery_overrides (
      action_id,
      incident_id,
      override_type,
      overrider_id,
      reason
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING
      id,
      action_id as "actionId",
      incident_id as "incidentId",
      override_type as "overrideType",
      overrider_id as "overriderId",
      reason,
      created_at as "createdAt"
  `,
    [
      input.actionId,
      input.incidentId || null,
      input.type,
      input.userId || null,
      input.reason || null,
    ]
  );

  log.info(`[IncidentLearning] Recorded ${input.type} override for action ${input.actionId}`);

  // Check if we should create a suggestion
  await checkForSuggestion(input.actionId);

  if (!result.rows[0]) throw new Error('Override insert returned no row');
  return result.rows[0];
}

/**
 * Get override history for an action
 */
export async function getOverrideHistory(actionId: string): Promise<OverrideHistory> {
  const db = await getDb();
  const result = await db.query<{ approvals: string; rejections: string }>(
    `
    SELECT
      SUM(CASE WHEN override_type = 'approve' THEN 1 ELSE 0 END) as approvals,
      SUM(CASE WHEN override_type = 'reject' THEN 1 ELSE 0 END) as rejections
    FROM recovery_overrides
    WHERE action_id = $1
  `,
    [actionId]
  );

  return {
    approvals: parseInt(result.rows[0]?.approvals ?? '0', 10),
    rejections: parseInt(result.rows[0]?.rejections ?? '0', 10),
  };
}

/**
 * Check if we should create a classification suggestion
 */
async function checkForSuggestion(actionId: string): Promise<void> {
  const history = await getOverrideHistory(actionId);
  const action = await serviceRegistry.getRecoveryActionById(actionId);

  if (!action) return;

  // Check for demotion suggestion (many approvals)
  if (history.approvals >= DEFAULT_THRESHOLDS.approvalToDemote && action.riskLevel !== 'safe') {
    const db = await getDb();
  const existingResult = await db.query(
      `SELECT id FROM classification_suggestions WHERE action_id = $1 AND status = 'pending'`,
      [actionId]
    );

    if (existingResult.rows.length === 0) {
      await createClassificationSuggestion({
        actionId,
        type: 'demote',
      });
    }
  }

  // Check for promotion suggestion (many rejections)
  if (history.rejections >= DEFAULT_THRESHOLDS.rejectionToPromote && action.riskLevel !== 'dangerous') {
    const db = await getDb();
  const existingResult = await db.query(
      `SELECT id FROM classification_suggestions WHERE action_id = $1 AND status = 'pending'`,
      [actionId]
    );

    if (existingResult.rows.length === 0) {
      await createClassificationSuggestion({
        actionId,
        type: 'promote',
      });
    }
  }
}

/**
 * Create classification suggestion
 */
export async function createClassificationSuggestion(
  input: SuggestionInput
): Promise<ClassificationSuggestion> {
  const action = await serviceRegistry.getRecoveryActionById(input.actionId);
  if (!action) throw new Error('Action not found');

  const history = await getOverrideHistory(input.actionId);

  let suggestedLevel: RiskLevel;
  let reason: string;
  let overrideCount: number;

  if (input.type === 'demote') {
    suggestedLevel = action.riskLevel === 'dangerous' ? 'moderate' : 'safe';
    reason = `Human approved ${history.approvals} consecutive times`;
    overrideCount = history.approvals;
  } else {
    suggestedLevel = action.riskLevel === 'safe' ? 'moderate' : 'dangerous';
    reason = `Human rejected ${history.rejections} consecutive times`;
    overrideCount = history.rejections;
  }

  const db = await getDb();
  const result = await db.query<Omit<ClassificationSuggestion, 'requiresConfirmation'>>(
    `
    INSERT INTO classification_suggestions (
      action_id,
      current_level,
      suggested_level,
      suggestion_type,
      reason,
      override_count
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING
      id,
      action_id as "actionId",
      current_level as "currentLevel",
      suggested_level as "suggestedLevel",
      suggestion_type as "suggestionType",
      reason,
      override_count as "overrideCount",
      status,
      created_at as "createdAt"
  `,
    [
      input.actionId,
      action.riskLevel,
      suggestedLevel,
      input.type,
      reason,
      overrideCount,
    ]
  );

  log.info(`[IncidentLearning] Created ${input.type} suggestion for action ${input.actionId}`);

  const row = result.rows[0]!;
  return {
    ...row,
    currentRiskLevel: row.currentLevel,
    suggestedRiskLevel: row.suggestedLevel,
    rationale: row.reason,
    requiresConfirmation: true,
  };
}

/**
 * Get pending suggestions
 */
export async function getSuggestions(status?: string): Promise<ClassificationSuggestion[]> {
  const db = await getDb();
  const result = await db.query<Omit<ClassificationSuggestion, 'requiresConfirmation'> & { status: string }>(
    `
    SELECT
      s.id,
      s.action_id as "actionId",
      a.action_name as "actionName",
      s.current_level as "currentLevel",
      s.suggested_level as "suggestedLevel",
      s.suggestion_type as "suggestionType",
      s.reason,
      s.override_count as "overrideCount",
      s.status,
      s.decided_by as "decidedBy",
      s.decided_at as "decidedAt",
      s.dismissed_reason as "dismissedReason",
      s.created_at as "createdAt"
    FROM classification_suggestions s
    JOIN recovery_actions a ON s.action_id = a.id
    WHERE ($1::text IS NULL OR s.status = $1)
    ORDER BY s.created_at DESC
  `,
    [status || null]
  );

  return result.rows.map((r) => ({ ...r, requiresConfirmation: r.status === 'pending' }));
}

/**
 * Apply a suggestion
 */
export async function applySuggestion(
  suggestionId: string,
  appliedBy: string
): Promise<{ success: boolean; actionId: string; oldLevel: RiskLevel; newLevel: RiskLevel; appliedBy: string }> {
  const db = await getDb();
  const suggestion = await db.query<{ action_id: string; current_level: RiskLevel; suggested_level: RiskLevel }>(
    `SELECT * FROM classification_suggestions WHERE id = $1 AND status = 'pending'`,
    [suggestionId]
  );

  if (suggestion.rows.length === 0) {
    throw new Error('Suggestion not found or already processed');
  }

  const s = suggestion.rows[0]!; // Guaranteed by length check above

  // Update action risk level
  await serviceRegistry.updateActionRiskLevel(s.action_id, s.suggested_level);

  // Update suggestion status
  await db.query(
    `
    UPDATE classification_suggestions SET
      status = 'approved',
      decided_by = $2,
      decided_at = NOW()
    WHERE id = $1
  `,
    [suggestionId, appliedBy]
  );

  log.info(`[IncidentLearning] Applied suggestion ${suggestionId} by ${appliedBy}`);

  return {
    success: true,
    actionId: s.action_id,
    oldLevel: s.current_level,
    newLevel: s.suggested_level,
    appliedBy,
  };
}

/**
 * Dismiss a suggestion
 */
export async function dismissSuggestion(
  suggestionId: string,
  dismissedBy: string,
  reason?: string
): Promise<{ success: boolean; suggestionId: string; dismissedBy: string; reason?: string; logged: boolean }> {
  const db = await getDb();
  await db.query(
    `
    UPDATE classification_suggestions SET
      status = 'dismissed',
      decided_by = $2,
      decided_at = NOW(),
      dismissed_reason = $3
    WHERE id = $1
  `,
    [suggestionId, dismissedBy, reason || null]
  );

  log.info(`[IncidentLearning] Dismissed suggestion ${suggestionId} by ${dismissedBy}: ${reason}`);

  return { success: true, suggestionId, dismissedBy, reason, logged: true };
}

// ============================================
// Knowledge Base Export
// ============================================

/**
 * Get filename for incident
 */
export function getIncidentFilename(incident: Incident): string {
  const date = incident.createdAt.toISOString().split('T')[0];
  const idShort = incident.id.slice(0, 8);
  return `${date}-${idShort}.md`;
}

/**
 * Export incident to knowledge base
 */
export async function exportIncidentToKB(incident: Incident): Promise<KBExportResult> {
  try {
    // Ensure directory exists
    const fullPath = path.join(process.cwd(), KB_BASE_PATH);
    let directoryCreated = false;

    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      directoryCreated = true;
    }

    // Get service name
    let serviceName = incident.serviceName || 'Unknown';
    if (!incident.serviceName && incident.serviceId) {
      const service = await serviceRegistry.getServiceById(incident.serviceId);
      serviceName = service?.name || 'Unknown';
    }

    // Get actions attempted
    const db = await getDb();
  const actionsResult = await db.query<{ name: string; riskLevel: string; result: boolean; timestamp: string }>(
      `
      SELECT
        ra.action_name as name,
        ra.risk_level as "riskLevel",
        ia.success as result,
        ia.executed_at as timestamp
      FROM incident_actions ia
      JOIN recovery_actions ra ON ia.action_id = ra.id
      WHERE ia.incident_id = $1
      ORDER BY ia.attempt_number
    `,
      [incident.id]
    );

    const actions = actionsResult.rows;

    // Format duration
    const duration = incident.timeToResolveSeconds
      ? `${incident.timeToResolveSeconds}s`
      : 'Unknown';

    // Build markdown content
    let content = `# Incident: ${incident.id.slice(0, 8)}\n\n`;
    content += `**Date:** ${incident.createdAt.toISOString()}\n`;
    content += `**Service:** ${serviceName}\n`;
    content += `**Issue Type:** ${incident.issueType || 'Unknown'}\n`;
    content += `**Duration:** ${duration}\n\n`;

    content += `## Timeline\n\n`;
    content += `| Time | Event |\n`;
    content += `|------|-------|\n`;
    content += `| ${incident.createdAt.toISOString()} | Issue detected |\n`;

    for (const action of actions) {
      const result = action.result ? 'success' : 'failed';
      content += `| ${new Date(action.timestamp).toISOString()} | ${action.name} - ${result} |\n`;
    }

    if (incident.resolvedAt) {
      content += `| ${incident.resolvedAt.toISOString()} | Resolved |\n`;
    }

    content += `\n## Actions Attempted\n\n`;
    actions.forEach((action, i) => {
      const result = action.result ? 'Success' : 'Failed';
      content += `${i + 1}. **${action.name}** (${action.riskLevel}) - ${result}\n`;
    });

    content += `\n## Resolution\n\n`;
    content += `**Resolved by:** ${incident.resolvedBy || 'Unknown'}\n`;
    content += `**Human intervention:** ${incident.humanIntervention ? 'Yes' : 'No'}\n`;

    if (incident.learnings && incident.learnings.length > 0) {
      content += `\n## Learnings\n\n`;
      incident.learnings.forEach((learning) => {
        content += `- ${learning}\n`;
      });
    }

    // Write file
    const filename = getIncidentFilename(incident);
    const filePath = path.join(fullPath, filename);
    fs.writeFileSync(filePath, content);

    // Update incident as exported
    await db.query(
      `
      UPDATE infrastructure_incidents SET
        kb_exported = true,
        kb_file_path = $2
      WHERE id = $1
    `,
      [incident.id, `${KB_BASE_PATH}/${filename}`]
    );

    // Update index
    await updateIncidentIndex(incident);

    log.info(`[IncidentLearning] Exported incident ${incident.id} to ${filePath}`);

    return {
      success: true,
      filePath: `${KB_BASE_PATH}/${filename}`,
      content,
      directoryCreated,
    };
  } catch (error) {
    log.error('[IncidentLearning] Failed to export incident:', { error: error instanceof Error ? error.message : String(error) });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Export failed',
    };
  }
}

/**
 * Update incident index file
 */
export async function updateIncidentIndex(incident: Incident): Promise<{
  success: boolean;
  entriesCount: number;
  newEntry: KBIndexEntry;
}> {
  const fullPath = path.join(process.cwd(), KB_BASE_PATH);
  const indexPath = path.join(fullPath, 'index.md');

  // Get service name
  let serviceName = incident.serviceName || 'Unknown';
  if (!incident.serviceName && incident.serviceId) {
    const service = await serviceRegistry.getServiceById(incident.serviceId);
    serviceName = service?.name || 'Unknown';
  }

  const newEntry: KBIndexEntry = {
    id: incident.id,
    date: incident.createdAt.toISOString().split('T')[0] || new Date().toISOString().split('T')[0] || '',
    service: serviceName,
    issueType: incident.issueType || 'unknown',
    file: getIncidentFilename(incident),
  };

  // Read existing index or create new
  let content = '# Incident Index\n\n';
  content += '| Date | Service | Issue | File |\n';
  content += '|------|---------|-------|------|\n';

  if (fs.existsSync(indexPath)) {
    // Append to existing
    const existing = fs.readFileSync(indexPath, 'utf-8');
    content = existing;
  }

  content += `| ${newEntry.date} | ${newEntry.service} | ${newEntry.issueType || 'Unknown'} | [${newEntry.file}](./${newEntry.file}) |\n`;

  fs.writeFileSync(indexPath, content);

  // Count entries
  const lines = content.split('\n').filter((l) => l.startsWith('|') && !l.includes('---'));
  const entriesCount = Math.max(0, lines.length - 1); // Exclude header

  return { success: true, entriesCount, newEntry };
}

// ============================================
// Statistics
// ============================================

/**
 * Get overall success rate
 */
export async function getOverallSuccessRate(): Promise<SuccessRate> {
  const db = await getDb();
  const result = await db.query<{ total_success: string; total_failure: string }>(`
    SELECT
      SUM(success_count) as total_success,
      SUM(failure_count) as total_failure
    FROM recovery_actions
  `);

  const totalSuccess = parseInt(result.rows[0]?.total_success ?? '0', 10);
  const totalFailure = parseInt(result.rows[0]?.total_failure ?? '0', 10);
  const total = totalSuccess + totalFailure;

  if (total === 0) {
    return { rate: null, totalSuccess: 0, totalFailure: 0, message: 'No data available' };
  }

  const rate = Math.round((totalSuccess / total) * 100 * 10) / 10;

  return { rate, totalSuccess, totalFailure };
}

/**
 * Get success rate for a service
 */
export async function getServiceSuccessRate(serviceId: string): Promise<{
  serviceId: string;
  serviceName: string;
  rate: number | null;
  totalAttempts: number;
}> {
  const service = await serviceRegistry.getServiceById(serviceId);

  const db = await getDb();
  const result = await db.query<{ total_success: string; total_failure: string }>(
    `
    SELECT
      SUM(success_count) as total_success,
      SUM(failure_count) as total_failure
    FROM recovery_actions
    WHERE service_id = $1
  `,
    [serviceId]
  );

  const totalSuccess = parseInt(result.rows[0]?.total_success ?? '0', 10);
  const totalFailure = parseInt(result.rows[0]?.total_failure ?? '0', 10);
  const total = totalSuccess + totalFailure;

  return {
    serviceId,
    serviceName: service?.name || 'Unknown',
    rate: total > 0 ? Math.round((totalSuccess / total) * 100 * 10) / 10 : null,
    totalAttempts: total,
  };
}

/**
 * Get Mean Time To Resolution
 */
export async function getMTTR(): Promise<MTTR> {
  const db = await getDb();
  const result = await db.query<{ avg_time: string; incident_count: string }>(`
    SELECT
      AVG(time_to_resolve_seconds) as avg_time,
      COUNT(*) as incident_count
    FROM infrastructure_incidents
    WHERE resolved = true AND time_to_resolve_seconds IS NOT NULL
  `);

  const avgSeconds = parseFloat(result.rows[0]?.avg_time ?? '0') || 0;
  const incidentCount = parseInt(result.rows[0]?.incident_count ?? '0', 10);

  if (incidentCount === 0) {
    return { mttrSeconds: null, mttrFormatted: 'N/A', incidentCount: 0 };
  }

  const mttrSeconds = Math.round(avgSeconds);
  const minutes = Math.floor(mttrSeconds / 60);
  const seconds = mttrSeconds % 60;
  const mttrFormatted = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  return { mttrSeconds, mttrFormatted, incidentCount };
}

/**
 * Get common failure types
 */
export async function getCommonFailures(limit: number = 5): Promise<CommonFailure[]> {
  const db = await getDb();
  const result = await db.query<{ type: string; count: string }>(
    `
    SELECT
      issue_type as type,
      COUNT(*) as count
    FROM infrastructure_incidents
    WHERE issue_type IS NOT NULL
    GROUP BY issue_type
    ORDER BY count DESC
    LIMIT $1
  `,
    [limit]
  );

  const total = result.rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0);

  return result.rows.map((r) => ({
    type: r.type,
    count: parseInt(r.count, 10),
    percentage: Math.round((parseInt(r.count, 10) / total) * 100 * 10) / 10,
  }));
}

/**
 * Get actions with improving success rates
 */
export async function getImprovingActions(): Promise<ActionTrend[]> {
  // Compare last 7 days vs previous 7 days
  const db = await getDb();
  const result = await db.query<{ actionId: string; actionName: string; currentRate: number; previousRate: number | null }>(`
    WITH recent AS (
      SELECT action_id, COUNT(*) as total, SUM(CASE WHEN success THEN 1 ELSE 0 END) as successes
      FROM incident_actions
      WHERE executed_at >= NOW() - INTERVAL '7 days'
      GROUP BY action_id
    ),
    previous AS (
      SELECT action_id, COUNT(*) as total, SUM(CASE WHEN success THEN 1 ELSE 0 END) as successes
      FROM incident_actions
      WHERE executed_at >= NOW() - INTERVAL '14 days' AND executed_at < NOW() - INTERVAL '7 days'
      GROUP BY action_id
    )
    SELECT
      r.action_id as "actionId",
      ra.action_name as "actionName",
      (r.successes::float / NULLIF(r.total, 0) * 100) as "currentRate",
      (p.successes::float / NULLIF(p.total, 0) * 100) as "previousRate"
    FROM recent r
    JOIN recovery_actions ra ON r.action_id = ra.id
    LEFT JOIN previous p ON r.action_id = p.action_id
    WHERE r.total >= 3
  `);

  return result.rows
    .filter((r) => r.previousRate !== null && r.currentRate > r.previousRate!)
    .map((r) => ({
      actionId: r.actionId,
      actionName: r.actionName,
      improvement: Math.round((r.currentRate - (r.previousRate ?? 0)) * 10) / 10,
      currentRate: Math.round(r.currentRate * 10) / 10,
    }))
    .sort((a, b) => (b.improvement || 0) - (a.improvement || 0));
}

/**
 * Get actions with declining success rates
 */
export async function getDecliningActions(): Promise<ActionTrend[]> {
  const db = await getDb();
  const result = await db.query<{ actionId: string; actionName: string; currentRate: number; previousRate: number | null }>(`
    WITH recent AS (
      SELECT action_id, COUNT(*) as total, SUM(CASE WHEN success THEN 1 ELSE 0 END) as successes
      FROM incident_actions
      WHERE executed_at >= NOW() - INTERVAL '7 days'
      GROUP BY action_id
    ),
    previous AS (
      SELECT action_id, COUNT(*) as total, SUM(CASE WHEN success THEN 1 ELSE 0 END) as successes
      FROM incident_actions
      WHERE executed_at >= NOW() - INTERVAL '14 days' AND executed_at < NOW() - INTERVAL '7 days'
      GROUP BY action_id
    )
    SELECT
      r.action_id as "actionId",
      ra.action_name as "actionName",
      (r.successes::float / NULLIF(r.total, 0) * 100) as "currentRate",
      (p.successes::float / NULLIF(p.total, 0) * 100) as "previousRate"
    FROM recent r
    JOIN recovery_actions ra ON r.action_id = ra.id
    LEFT JOIN previous p ON r.action_id = p.action_id
    WHERE r.total >= 3
  `);

  return result.rows
    .filter((r) => r.previousRate !== null && r.currentRate < r.previousRate!)
    .map((r) => ({
      actionId: r.actionId,
      actionName: r.actionName,
      decline: Math.round((r.currentRate - (r.previousRate ?? 0)) * 10) / 10,
      currentRate: Math.round(r.currentRate * 10) / 10,
    }))
    .sort((a, b) => (a.decline || 0) - (b.decline || 0));
}

/**
 * Get stats by time range
 */
export async function getStatsByTimeRange(from: Date, to: Date): Promise<TimeRangeStats> {
  const db = await getDb();
  const result = await db.query<{ incident_count: string; avg_resolution: string }>(
    `
    SELECT
      COUNT(*) as incident_count,
      AVG(time_to_resolve_seconds) as avg_resolution
    FROM infrastructure_incidents
    WHERE created_at >= $1 AND created_at <= $2 AND resolved = true
  `,
    [from, to]
  );

  const incidentCount = parseInt(result.rows[0]?.incident_count ?? '0', 10);
  const mttrSeconds = Math.round(parseFloat(result.rows[0]?.avg_resolution ?? '0') || 0);

  // Get success rate for this period
  const actionsResult = await db.query<{ successes: string; total: string }>(
    `
    SELECT
      SUM(CASE WHEN success THEN 1 ELSE 0 END) as successes,
      COUNT(*) as total
    FROM incident_actions
    WHERE executed_at >= $1 AND executed_at <= $2
  `,
    [from, to]
  );

  const successes = parseInt(actionsResult.rows[0]?.successes ?? '0', 10);
  const total = parseInt(actionsResult.rows[0]?.total ?? '0', 10);
  const successRate = total > 0 ? Math.round((successes / total) * 100 * 10) / 10 : 0;

  return {
    timeRange: { from, to },
    successRate,
    incidentCount,
    mttrSeconds,
  };
}

/**
 * Compare two time periods
 */
export async function compareTimePeriods(
  current: { from: Date; to: Date },
  previous: { from: Date; to: Date }
): Promise<PeriodComparison> {
  const currentStats = await getStatsByTimeRange(current.from, current.to);
  const previousStats = await getStatsByTimeRange(previous.from, previous.to);

  const successRateChange = currentStats.successRate - previousStats.successRate;
  const incidentCountChange = currentStats.incidentCount - previousStats.incidentCount;

  let trend: 'improving' | 'declining' | 'stable' = 'stable';
  if (successRateChange > 2) trend = 'improving';
  else if (successRateChange < -2) trend = 'declining';

  return {
    currentPeriod: {
      successRate: currentStats.successRate,
      incidentCount: currentStats.incidentCount,
      mttrSeconds: currentStats.mttrSeconds,
    },
    previousPeriod: {
      successRate: previousStats.successRate,
      incidentCount: previousStats.incidentCount,
      mttrSeconds: previousStats.mttrSeconds,
    },
    delta: {
      successRateChange: Math.round(successRateChange * 10) / 10,
      incidentCountChange,
      trend,
    },
  };
}

/**
 * Export all stats as JSON
 */
export async function exportStatsAsJSON(): Promise<Record<string, unknown>> {
  const [overallRate, mttr, commonFailures] = await Promise.all([
    getOverallSuccessRate(),
    getMTTR(),
    getCommonFailures(),
  ]);

  // Get per-service stats
  const services = await serviceRegistry.getEnabledServices();
  const serviceStats = await Promise.all(
    services.map((s) => getServiceSuccessRate(s.id))
  );

  return {
    exportedAt: new Date().toISOString(),
    overallSuccessRate: overallRate.rate,
    mttrSeconds: mttr.mttrSeconds,
    incidentCount: mttr.incidentCount,
    serviceStats: serviceStats.map((s) => ({
      serviceId: s.serviceId,
      serviceName: s.serviceName,
      rate: s.rate,
    })),
    commonFailures,
  };
}

// Export as service object
export const incidentLearningService = {
  // Success/Failure Tracking
  trackSuccess,
  trackFailure,
  getSuccessRate,
  trackResolutionTime,
  trackAttempts,
  getResolutionMethod,

  // Auto-Classification
  getConsecutiveCounts,
  checkAndAdjustClassification,
  resetConsecutiveCounters,
  promoteRiskLevel,
  demoteRiskLevel,
  setAutoAdjustEnabled,

  // Human Override
  recordOverride,
  getOverrideHistory,
  createClassificationSuggestion,
  getSuggestions,
  applySuggestion,
  dismissSuggestion,

  // Knowledge Base
  getIncidentFilename,
  exportIncidentToKB,
  updateIncidentIndex,

  // Statistics
  getOverallSuccessRate,
  getServiceSuccessRate,
  getMTTR,
  getCommonFailures,
  getImprovingActions,
  getDecliningActions,
  getStatsByTimeRange,
  compareTimePeriods,
  exportStatsAsJSON,
};

export default incidentLearningService;
