/**
 * Recovery Service
 *
 * Executes recovery actions based on risk classification.
 * Safe actions auto-execute, moderate/dangerous require HITL approval.
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
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import type {
  RecoveryAction,
  ActionExecutionResult,
  ApprovalQueueItem,
} from '../types/self-healing.types';
import { serviceRegistry } from './serviceRegistry';

const execAsync = promisify(exec);

// Cooldown tracking (in-memory for now, could be Redis)
const cooldownMap = new Map<string, Date>();

// ============================================
// Command Execution
// ============================================

/**
 * Execute a bash command locally
 */
export async function executeBashCommand(
  command: string,
  timeoutMs: number = 30000
): Promise<ActionExecutionResult> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', command], {
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      const executionTimeMs = Date.now() - startTime;
      const success = code === 0;

      resolve({
        success,
        output: stdout,
        error: stderr || undefined,
        executionTimeMs,
        verified: false,
      });
    });

    child.on('error', (error) => {
      const executionTimeMs = Date.now() - startTime;

      resolve({
        success: false,
        error: error.message,
        executionTimeMs,
        verified: false,
      });
    });
  });
}

/**
 * Execute a command via SSH
 */
export async function executeSshCommand(
  command: string,
  host: string,
  user: string = 'velo',
  timeoutMs: number = 30000
): Promise<ActionExecutionResult> {
  const startTime = Date.now();

  try {
    const sshCommand = `ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no ${user}@${host} "${command.replace(/"/g, '\\"')}"`;

    const { stdout, stderr } = await execAsync(sshCommand, {
      timeout: timeoutMs,
    });

    const executionTimeMs = Date.now() - startTime;

    return {
      success: true,
      output: stdout,
      error: stderr || undefined,
      executionTimeMs,
      verified: false,
    };
  } catch (error) {
    const executionTimeMs = Date.now() - startTime;

    return {
      success: false,
      error: error instanceof Error ? error.message : 'SSH command failed',
      executionTimeMs,
      verified: false,
    };
  }
}

/**
 * Execute a recovery action command
 */
export async function executeCommand(action: RecoveryAction): Promise<ActionExecutionResult> {
  log.info(`[RecoveryService] Executing action: ${action.actionName}`);

  switch (action.commandType) {
    case 'ssh':
      if (!action.sshHost) {
        return {
          success: false,
          error: 'SSH host not configured',
          executionTimeMs: 0,
          verified: false,
        };
      }
      return executeSshCommand(
        action.command,
        action.sshHost,
        action.sshUser || 'velo'
      );

    case 'api':
      // For API calls, use fetch
      try {
        const startTime = Date.now();
        const response = await fetch(action.command, { method: 'POST' });
        const executionTimeMs = Date.now() - startTime;

        return {
          success: response.ok,
          output: await response.text(),
          executionTimeMs,
          verified: false,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'API call failed',
          executionTimeMs: 0,
          verified: false,
        };
      }

    case 'bash':
    default:
      return executeBashCommand(action.command);
  }
}

// ============================================
// Success Verification
// ============================================

/**
 * Verify if action was successful
 */
export async function verifySuccess(
  action: RecoveryAction,
  result: ActionExecutionResult,
  maxRetries: number = 3
): Promise<ActionExecutionResult> {
  if (!action.successIndicator) {
    // No verification configured, assume output-based success
    return result;
  }

  // Wait a bit for service to stabilize
  await new Promise((resolve) => setTimeout(resolve, 2000));

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Check if success indicator is a URL (health check)
      if (action.successIndicator.startsWith('http')) {
        const response = await fetch(action.successIndicator, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          return {
            ...result,
            verified: true,
            verificationOutput: `Health check returned ${response.status}`,
          };
        }
      } else {
        // Run success indicator as a command
        const verifyResult = await executeBashCommand(action.successIndicator);
        if (verifyResult.success) {
          return {
            ...result,
            verified: true,
            verificationOutput: verifyResult.output,
          };
        }
      }
    } catch (error) {
      log.warn(`[RecoveryService] Verification attempt ${attempt + 1} failed:`, error);
    }

    // Wait before retry
    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  return {
    ...result,
    verified: false,
    verificationOutput: 'Verification failed after all retries',
  };
}

// ============================================
// Cooldown Management
// ============================================

/**
 * Check if action is in cooldown
 */
export function isInCooldown(actionId: string, cooldownMinutes: number): boolean {
  const lastExecution = cooldownMap.get(actionId);
  if (!lastExecution) return false;

  const cooldownMs = cooldownMinutes * 60 * 1000;
  const timeSinceExecution = Date.now() - lastExecution.getTime();

  return timeSinceExecution < cooldownMs;
}

/**
 * Get remaining cooldown time in seconds
 */
export function getCooldownRemaining(actionId: string, cooldownMinutes: number): number {
  const lastExecution = cooldownMap.get(actionId);
  if (!lastExecution) return 0;

  const cooldownMs = cooldownMinutes * 60 * 1000;
  const timeSinceExecution = Date.now() - lastExecution.getTime();
  const remaining = cooldownMs - timeSinceExecution;

  return Math.max(0, Math.floor(remaining / 1000));
}

/**
 * Set cooldown for an action
 */
export function setCooldown(actionId: string): void {
  cooldownMap.set(actionId, new Date());
}

/**
 * Clear cooldown for an action
 */
export function clearCooldown(actionId: string): void {
  cooldownMap.delete(actionId);
}

// ============================================
// Risk Level Handling
// ============================================

/**
 * Handle safe action (auto-execute)
 */
async function handleSafeAction(
  action: RecoveryAction,
  incidentId: string
): Promise<ActionExecutionResult> {
  // Check cooldown from database
  const dbAction = await serviceRegistry.getRecoveryActionById(action.id);
  if (dbAction?.lastExecuted) {
    const service = await serviceRegistry.getServiceById(action.serviceId);
    const cooldownMinutes = service?.cooldownMinutes || 5;

    if (isInCooldown(action.id, cooldownMinutes)) {
      return {
        success: false,
        error: `Action in cooldown. ${getCooldownRemaining(action.id, cooldownMinutes)}s remaining`,
        executionTimeMs: 0,
        verified: false,
      };
    }
  }

  // Execute immediately
  const result = await executeCommand(action);
  setCooldown(action.id);

  // Record execution
  await recordExecution(action.id, incidentId, result);

  // Verify success
  const verifiedResult = await verifySuccess(action, result);

  // Update action stats
  await updateActionStats(action.id, verifiedResult.success);

  return verifiedResult;
}

/**
 * Handle moderate action (queue for approval, notify)
 */
async function handleModerateAction(
  action: RecoveryAction,
  incidentId: string
): Promise<{ queued: boolean; queueId: string }> {
  const queueId = await queueForApproval(action.id, incidentId, 2);

  // Trigger notification via escalation service
  try {
    const { escalationService } = await import('./escalationService');
    await escalationService.sendWhatsAppAlert({
      incidentId,
      actionId: action.id,
      actionName: action.actionName,
      riskLevel: action.riskLevel,
      queueId,
    });
  } catch (error) {
    log.error('[RecoveryService] Failed to send notification:', error);
  }

  return { queued: true, queueId };
}

/**
 * Handle dangerous action (queue for approval, require explicit confirmation)
 */
async function handleDangerousAction(
  action: RecoveryAction,
  incidentId: string
): Promise<{ queued: boolean; queueId: string }> {
  const queueId = await queueForApproval(action.id, incidentId, 3);

  // Trigger urgent notification
  try {
    const { escalationService } = await import('./escalationService');
    await escalationService.sendWhatsAppAlert({
      incidentId,
      actionId: action.id,
      actionName: action.actionName,
      riskLevel: action.riskLevel,
      queueId,
      urgent: true,
    });
  } catch (error) {
    log.error('[RecoveryService] Failed to send urgent notification:', error);
  }

  return { queued: true, queueId };
}

// ============================================
// Approval Queue
// ============================================

/**
 * Queue an action for approval
 */
async function queueForApproval(
  actionId: string,
  incidentId: string,
  escalationLevel: number
): Promise<string> {
  // Generate approval token
  const approvalToken = `approve-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const tokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  const db = await getDb();
  const result = await db.query(
    `
    INSERT INTO recovery_approval_queue (
      incident_id,
      action_id,
      escalation_level,
      escalation_channel,
      approval_token,
      token_expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `,
    [
      incidentId,
      actionId,
      escalationLevel,
      escalationLevel >= 2 ? 'whatsapp' : 'dashboard',
      approvalToken,
      tokenExpiresAt,
    ]
  );

  log.info(`[RecoveryService] Queued action ${actionId} for approval (level ${escalationLevel})`);
  return result.rows[0]!.id;
}

/**
 * Get pending approvals
 */
export async function getPendingApprovals(): Promise<ApprovalQueueItem[]> {
  const db = await getDb();
  const result = await db.query(`
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
      q.execution_output as "executionOutput"
    FROM recovery_approval_queue q
    JOIN recovery_actions a ON q.action_id = a.id
    JOIN infrastructure_services s ON a.service_id = s.id
    WHERE q.status = 'pending'
    ORDER BY q.escalation_level DESC, q.requested_at ASC
  `);

  return result.rows;
}

/**
 * Approve a pending action
 */
export async function approveAction(
  queueId: string,
  decidedBy: string,
  reason?: string
): Promise<ActionExecutionResult> {
  // Get the queue item
  const db = await getDb();
  const queueResult = await db.query(
    `SELECT * FROM recovery_approval_queue WHERE id = $1 AND status = 'pending'`,
    [queueId]
  );

  if (queueResult.rows.length === 0) {
    return {
      success: false,
      error: 'Approval item not found or already processed',
      executionTimeMs: 0,
      verified: false,
    };
  }

  const queueItem = queueResult.rows[0]!;

  // Get the action
  const action = await serviceRegistry.getRecoveryActionById(queueItem.action_id);
  if (!action) {
    return {
      success: false,
      error: 'Recovery action not found',
      executionTimeMs: 0,
      verified: false,
    };
  }

  // Execute the action
  const result = await executeCommand(action);
  const verifiedResult = await verifySuccess(action, result);

  // Update queue item
  await db.query(
    `
    UPDATE recovery_approval_queue SET
      status = 'approved',
      decided_by = $2,
      decided_at = NOW(),
      decision_reason = $3,
      executed = true,
      execution_success = $4,
      execution_output = $5
    WHERE id = $1
  `,
    [
      queueId,
      decidedBy,
      reason || null,
      verifiedResult.success,
      verifiedResult.output || verifiedResult.error,
    ]
  );

  // Record override for learning
  try {
    const { incidentLearningService } = await import('./incidentLearning');
    await incidentLearningService.recordOverride({
      actionId: action.id,
      incidentId: queueItem.incident_id,
      userId: decidedBy,
      type: 'approve',
      reason,
    });
  } catch (error) {
    log.error('[RecoveryService] Failed to record override:', error);
  }

  // Update action stats
  await updateActionStats(action.id, verifiedResult.success);

  log.info(`[RecoveryService] Action ${action.actionName} approved and executed by ${decidedBy}`);
  return verifiedResult;
}

/**
 * Reject a pending action
 */
export async function rejectAction(
  queueId: string,
  decidedBy: string,
  reason?: string
): Promise<boolean> {
  const db = await getDb();
  const queueResult = await db.query(
    `SELECT * FROM recovery_approval_queue WHERE id = $1 AND status = 'pending'`,
    [queueId]
  );

  if (queueResult.rows.length === 0) {
    return false;
  }

  const queueItem = queueResult.rows[0]!;

  await db.query(
    `
    UPDATE recovery_approval_queue SET
      status = 'rejected',
      decided_by = $2,
      decided_at = NOW(),
      decision_reason = $3
    WHERE id = $1
  `,
    [queueId, decidedBy, reason || null]
  );

  // Record override for learning
  try {
    const { incidentLearningService } = await import('./incidentLearning');
    await incidentLearningService.recordOverride({
      actionId: queueItem.action_id,
      incidentId: queueItem.incident_id,
      userId: decidedBy,
      type: 'reject',
      reason,
    });
  } catch (error) {
    log.error('[RecoveryService] Failed to record override:', error);
  }

  log.info(`[RecoveryService] Action rejected by ${decidedBy}: ${reason}`);
  return true;
}

// ============================================
// Rollback Support
// ============================================

/**
 * Execute rollback for a failed action
 */
export async function executeRollback(action: RecoveryAction): Promise<ActionExecutionResult> {
  if (!action.rollbackCommand) {
    return {
      success: false,
      error: 'No rollback command configured',
      executionTimeMs: 0,
      verified: false,
    };
  }

  log.warn(`[RecoveryService] Executing rollback for: ${action.actionName}`);

  const rollbackAction: RecoveryAction = {
    ...action,
    command: action.rollbackCommand,
    actionName: `Rollback: ${action.actionName}`,
  };

  return executeCommand(rollbackAction);
}

// ============================================
// Execution Recording
// ============================================

/**
 * Record action execution in database
 */
async function recordExecution(
  actionId: string,
  incidentId: string,
  result: ActionExecutionResult
): Promise<void> {
  // Get attempt number
  const db = await getDb();
  const countResult = await db.query(
    `SELECT COUNT(*) as count FROM incident_actions WHERE incident_id = $1`,
    [incidentId]
  );
  const attemptNumber = (parseInt(countResult.rows[0]!.count, 10) || 0) + 1;

  await db.query(
    `
    INSERT INTO incident_actions (
      incident_id,
      action_id,
      attempt_number,
      execution_time_ms,
      success,
      output,
      error,
      verified,
      verification_output
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `,
    [
      incidentId,
      actionId,
      attemptNumber,
      result.executionTimeMs,
      result.success,
      result.output || null,
      result.error || null,
      result.verified,
      result.verificationOutput || null,
    ]
  );
}

/**
 * Update action success/failure stats
 */
async function updateActionStats(actionId: string, success: boolean): Promise<void> {
  const db = await getDb();
  if (success) {
    await db.query(
      `
      UPDATE recovery_actions SET
        success_count = success_count + 1,
        consecutive_success = consecutive_success + 1,
        consecutive_failure = 0,
        last_executed = NOW(),
        last_success = NOW()
      WHERE id = $1
    `,
      [actionId]
    );
  } else {
    await db.query(
      `
      UPDATE recovery_actions SET
        failure_count = failure_count + 1,
        consecutive_failure = consecutive_failure + 1,
        consecutive_success = 0,
        last_executed = NOW(),
        last_failure = NOW()
      WHERE id = $1
    `,
      [actionId]
    );
  }

  // Check for auto-classification adjustment
  try {
    const { incidentLearningService } = await import('./incidentLearning');
    await incidentLearningService.checkAndAdjustClassification(actionId);
  } catch (error) {
    log.error('[RecoveryService] Failed to check classification:', error);
  }
}

// ============================================
// Main Recovery Trigger
// ============================================

/**
 * Trigger recovery for a service
 */
export async function triggerRecovery(
  serviceId: string,
  incidentId: string
): Promise<{ success: boolean; result?: ActionExecutionResult; queued?: boolean; queueId?: string }> {
  const db = await getDb();
  // Get next action to try
  const attemptedResult = await db.query(
    `SELECT action_id FROM incident_actions WHERE incident_id = $1`,
    [incidentId]
  );
  const attemptedIds = attemptedResult.rows.map((r: { action_id: string }) => r.action_id);

  const action = await serviceRegistry.getNextRecoveryAction(serviceId, attemptedIds);

  if (!action) {
    return {
      success: false,
      result: {
        success: false,
        error: 'No more recovery actions available',
        executionTimeMs: 0,
        verified: false,
      },
    };
  }

  log.info(`[RecoveryService] Triggering recovery action: ${action.actionName} (${action.riskLevel})`);

  // Handle based on risk level
  switch (action.riskLevel) {
    case 'safe': {
      const result = await handleSafeAction(action, incidentId);
      return { success: result.success, result };
    }
    case 'moderate': {
      const moderateResult = await handleModerateAction(action, incidentId);
      return { success: true, queued: true, queueId: moderateResult.queueId };
    }
    case 'dangerous': {
      const dangerousResult = await handleDangerousAction(action, incidentId);
      return { success: true, queued: true, queueId: dangerousResult.queueId };
    }

    default:
      return {
        success: false,
        result: {
          success: false,
          error: `Unknown risk level: ${action.riskLevel}`,
          executionTimeMs: 0,
          verified: false,
        },
      };
  }
}

// Export as service object
export const recoveryService = {
  executeBashCommand,
  executeSshCommand,
  executeCommand,
  verifySuccess,
  isInCooldown,
  getCooldownRemaining,
  setCooldown,
  clearCooldown,
  getPendingApprovals,
  approveAction,
  rejectAction,
  executeRollback,
  triggerRecovery,
};

export default recoveryService;
