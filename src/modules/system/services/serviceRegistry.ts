/**
 * Service Registry
 *
 * Central registry for all monitored services in the self-healing infrastructure.
 * Manages service definitions, recovery actions, and provides query functions.
 */

import { log } from '@/lib/logger';

// Use dynamic import to avoid bundling issues
async function getDb() {
  const { db } = await import('@/lib/db');
  return db;
}
import type {
  ServiceDefinition,
  ServiceCategory,
  RecoveryAction,
  RecoveryActionInput,
  RiskLevel,
} from '../types/self-healing.types';

// ============================================
// Service CRUD Operations
// ============================================

/**
 * Get all registered services
 */
export async function getAllServices(): Promise<ServiceDefinition[]> {
  const db = await getDb();
  const result = await db.query(`
    SELECT
      id,
      name,
      category,
      description,
      health_endpoint as "healthEndpoint",
      health_check_type as "healthCheckType",
      is_critical as "isCritical",
      is_enabled as "isEnabled",
      timeout_ms as "timeoutMs",
      recovery_enabled as "recoveryEnabled",
      max_recovery_attempts as "maxRecoveryAttempts",
      cooldown_minutes as "cooldownMinutes",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM infrastructure_services
    ORDER BY is_critical DESC, category, name
  `);

  return result.rows;
}

/**
 * Get enabled services only
 */
export async function getEnabledServices(): Promise<ServiceDefinition[]> {
  const db = await getDb();
  const result = await db.query(`
    SELECT
      id,
      name,
      category,
      description,
      health_endpoint as "healthEndpoint",
      health_check_type as "healthCheckType",
      is_critical as "isCritical",
      is_enabled as "isEnabled",
      timeout_ms as "timeoutMs",
      recovery_enabled as "recoveryEnabled",
      max_recovery_attempts as "maxRecoveryAttempts",
      cooldown_minutes as "cooldownMinutes",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM infrastructure_services
    WHERE is_enabled = true
    ORDER BY is_critical DESC, category, name
  `);

  return result.rows;
}

/**
 * Get critical services only
 */
export async function getCriticalServices(): Promise<ServiceDefinition[]> {
  const db = await getDb();
  const result = await db.query(`
    SELECT
      id,
      name,
      category,
      description,
      health_endpoint as "healthEndpoint",
      health_check_type as "healthCheckType",
      is_critical as "isCritical",
      is_enabled as "isEnabled",
      timeout_ms as "timeoutMs",
      recovery_enabled as "recoveryEnabled",
      max_recovery_attempts as "maxRecoveryAttempts",
      cooldown_minutes as "cooldownMinutes",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM infrastructure_services
    WHERE is_critical = true AND is_enabled = true
    ORDER BY name
  `);

  return result.rows;
}

/**
 * Get service by ID
 */
export async function getServiceById(id: string): Promise<ServiceDefinition | null> {
  const db = await getDb();
  const result = await db.query(
    `
    SELECT
      id,
      name,
      category,
      description,
      health_endpoint as "healthEndpoint",
      health_check_type as "healthCheckType",
      is_critical as "isCritical",
      is_enabled as "isEnabled",
      timeout_ms as "timeoutMs",
      recovery_enabled as "recoveryEnabled",
      max_recovery_attempts as "maxRecoveryAttempts",
      cooldown_minutes as "cooldownMinutes",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM infrastructure_services
    WHERE id = $1
  `,
    [id]
  );

  return result.rows[0] || null;
}

/**
 * Get services by category
 */
export async function getServicesByCategory(category: ServiceCategory): Promise<ServiceDefinition[]> {
  const db = await getDb();
  const result = await db.query(
    `
    SELECT
      id,
      name,
      category,
      description,
      health_endpoint as "healthEndpoint",
      health_check_type as "healthCheckType",
      is_critical as "isCritical",
      is_enabled as "isEnabled",
      timeout_ms as "timeoutMs",
      recovery_enabled as "recoveryEnabled",
      max_recovery_attempts as "maxRecoveryAttempts",
      cooldown_minutes as "cooldownMinutes",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM infrastructure_services
    WHERE category = $1 AND is_enabled = true
    ORDER BY is_critical DESC, name
  `,
    [category]
  );

  return result.rows;
}

/**
 * Create a new service
 */
export async function createService(service: Omit<ServiceDefinition, 'id' | 'createdAt' | 'updatedAt'>): Promise<ServiceDefinition> {
  // Validate required fields
  if (!service.name || service.name.trim().length === 0) {
    throw new Error('Service name is required');
  }
  if (!service.category) {
    throw new Error('Service category is required');
  }

  const db = await getDb();
  const result = await db.query(
    `
    INSERT INTO infrastructure_services (
      name,
      category,
      description,
      health_endpoint,
      health_check_type,
      is_critical,
      is_enabled,
      timeout_ms,
      recovery_enabled,
      max_recovery_attempts,
      cooldown_minutes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING
      id,
      name,
      category,
      description,
      health_endpoint as "healthEndpoint",
      health_check_type as "healthCheckType",
      is_critical as "isCritical",
      is_enabled as "isEnabled",
      timeout_ms as "timeoutMs",
      recovery_enabled as "recoveryEnabled",
      max_recovery_attempts as "maxRecoveryAttempts",
      cooldown_minutes as "cooldownMinutes",
      created_at as "createdAt",
      updated_at as "updatedAt"
  `,
    [
      service.name,
      service.category,
      service.description || null,
      service.healthEndpoint || null,
      service.healthCheckType || 'http',
      service.isCritical || false,
      service.isEnabled !== false,
      service.timeoutMs || 5000,
      service.recoveryEnabled || false,
      service.maxRecoveryAttempts || 3,
      service.cooldownMinutes || 5,
    ]
  );

  log.info(`[ServiceRegistry] Created service: ${service.name}`);
  return result.rows[0];
}

/**
 * Update a service
 */
export async function updateService(
  id: string,
  updates: Partial<Omit<ServiceDefinition, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<ServiceDefinition | null> {
  const existing = await getServiceById(id);
  if (!existing) {
    return null;
  }

  const db = await getDb();
  const result = await db.query(
    `
    UPDATE infrastructure_services SET
      name = COALESCE($2, name),
      category = COALESCE($3, category),
      description = COALESCE($4, description),
      health_endpoint = COALESCE($5, health_endpoint),
      health_check_type = COALESCE($6, health_check_type),
      is_critical = COALESCE($7, is_critical),
      is_enabled = COALESCE($8, is_enabled),
      timeout_ms = COALESCE($9, timeout_ms),
      recovery_enabled = COALESCE($10, recovery_enabled),
      max_recovery_attempts = COALESCE($11, max_recovery_attempts),
      cooldown_minutes = COALESCE($12, cooldown_minutes),
      updated_at = NOW()
    WHERE id = $1
    RETURNING
      id,
      name,
      category,
      description,
      health_endpoint as "healthEndpoint",
      health_check_type as "healthCheckType",
      is_critical as "isCritical",
      is_enabled as "isEnabled",
      timeout_ms as "timeoutMs",
      recovery_enabled as "recoveryEnabled",
      max_recovery_attempts as "maxRecoveryAttempts",
      cooldown_minutes as "cooldownMinutes",
      created_at as "createdAt",
      updated_at as "updatedAt"
  `,
    [
      id,
      updates.name,
      updates.category,
      updates.description,
      updates.healthEndpoint,
      updates.healthCheckType,
      updates.isCritical,
      updates.isEnabled,
      updates.timeoutMs,
      updates.recoveryEnabled,
      updates.maxRecoveryAttempts,
      updates.cooldownMinutes,
    ]
  );

  log.info(`[ServiceRegistry] Updated service: ${id}`);
  return result.rows[0];
}

/**
 * Delete a service
 */
export async function deleteService(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.query(
    `DELETE FROM infrastructure_services WHERE id = $1 RETURNING id`,
    [id]
  );

  if (result.rowCount && result.rowCount > 0) {
    log.info(`[ServiceRegistry] Deleted service: ${id}`);
    return true;
  }
  return false;
}

// ============================================
// Recovery Action Operations
// ============================================

/**
 * Get all recovery actions for a service
 */
export async function getRecoveryActions(serviceId: string): Promise<RecoveryAction[]> {
  const db = await getDb();
  const result = await db.query(
    `
    SELECT
      id,
      service_id as "serviceId",
      action_name as "actionName",
      description,
      command,
      command_type as "commandType",
      ssh_host as "sshHost",
      ssh_user as "sshUser",
      ssh_key_path as "sshKeyPath",
      risk_level as "riskLevel",
      requires_approval as "requiresApproval",
      success_indicator as "successIndicator",
      rollback_command as "rollbackCommand",
      execution_order as "executionOrder",
      success_count as "successCount",
      failure_count as "failureCount",
      last_executed as "lastExecuted",
      last_success as "lastSuccess",
      last_failure as "lastFailure",
      consecutive_success as "consecutiveSuccess",
      consecutive_failure as "consecutiveFailure",
      auto_adjust_enabled as "autoAdjustEnabled",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM recovery_actions
    WHERE service_id = $1
    ORDER BY execution_order, action_name
  `,
    [serviceId]
  );

  return result.rows;
}

/**
 * Get recovery action by ID
 */
export async function getRecoveryActionById(id: string): Promise<RecoveryAction | null> {
  const db = await getDb();
  const result = await db.query(
    `
    SELECT
      id,
      service_id as "serviceId",
      action_name as "actionName",
      description,
      command,
      command_type as "commandType",
      ssh_host as "sshHost",
      ssh_user as "sshUser",
      ssh_key_path as "sshKeyPath",
      risk_level as "riskLevel",
      requires_approval as "requiresApproval",
      success_indicator as "successIndicator",
      rollback_command as "rollbackCommand",
      execution_order as "executionOrder",
      success_count as "successCount",
      failure_count as "failureCount",
      last_executed as "lastExecuted",
      last_success as "lastSuccess",
      last_failure as "lastFailure",
      consecutive_success as "consecutiveSuccess",
      consecutive_failure as "consecutiveFailure",
      auto_adjust_enabled as "autoAdjustEnabled",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM recovery_actions
    WHERE id = $1
  `,
    [id]
  );

  return result.rows[0] || null;
}

/**
 * Get safe recovery actions for a service (for auto-execution)
 */
export async function getSafeRecoveryActions(serviceId: string): Promise<RecoveryAction[]> {
  const db = await getDb();
  const result = await db.query(
    `
    SELECT
      id,
      service_id as "serviceId",
      action_name as "actionName",
      description,
      command,
      command_type as "commandType",
      ssh_host as "sshHost",
      ssh_user as "sshUser",
      risk_level as "riskLevel",
      requires_approval as "requiresApproval",
      success_indicator as "successIndicator",
      rollback_command as "rollbackCommand",
      execution_order as "executionOrder",
      success_count as "successCount",
      failure_count as "failureCount",
      consecutive_success as "consecutiveSuccess",
      consecutive_failure as "consecutiveFailure",
      auto_adjust_enabled as "autoAdjustEnabled",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM recovery_actions
    WHERE service_id = $1
      AND risk_level = 'safe'
      AND requires_approval = false
    ORDER BY execution_order
  `,
    [serviceId]
  );

  return result.rows;
}

/**
 * Create a recovery action
 */
export async function createRecoveryAction(input: RecoveryActionInput): Promise<RecoveryAction> {
  // Validate
  if (!input.serviceId) throw new Error('Service ID is required');
  if (!input.actionName || input.actionName.trim().length === 0) {
    throw new Error('Action name is required');
  }
  if (!input.command || input.command.trim().length === 0) {
    throw new Error('Command is required');
  }
  if (!['safe', 'moderate', 'dangerous'].includes(input.riskLevel)) {
    throw new Error('Invalid risk level');
  }

  // Check service exists
  const service = await getServiceById(input.serviceId);
  if (!service) {
    throw new Error(`Service not found: ${input.serviceId}`);
  }

  // Set requires_approval based on risk level if not specified
  const requiresApproval = input.requiresApproval ?? (input.riskLevel !== 'safe');

  const db = await getDb();
  const result = await db.query(
    `
    INSERT INTO recovery_actions (
      service_id,
      action_name,
      description,
      command,
      command_type,
      ssh_host,
      ssh_user,
      risk_level,
      requires_approval,
      success_indicator,
      rollback_command,
      execution_order
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING
      id,
      service_id as "serviceId",
      action_name as "actionName",
      description,
      command,
      command_type as "commandType",
      ssh_host as "sshHost",
      ssh_user as "sshUser",
      risk_level as "riskLevel",
      requires_approval as "requiresApproval",
      success_indicator as "successIndicator",
      rollback_command as "rollbackCommand",
      execution_order as "executionOrder",
      success_count as "successCount",
      failure_count as "failureCount",
      consecutive_success as "consecutiveSuccess",
      consecutive_failure as "consecutiveFailure",
      auto_adjust_enabled as "autoAdjustEnabled",
      created_at as "createdAt",
      updated_at as "updatedAt"
  `,
    [
      input.serviceId,
      input.actionName,
      input.description || null,
      input.command,
      input.commandType || 'bash',
      input.sshHost || null,
      input.sshUser || null,
      input.riskLevel,
      requiresApproval,
      input.successIndicator || null,
      input.rollbackCommand || null,
      input.executionOrder || 1,
    ]
  );

  log.info(`[ServiceRegistry] Created recovery action: ${input.actionName} for service ${input.serviceId}`);
  return result.rows[0];
}

/**
 * Update a recovery action
 */
export async function updateRecoveryAction(
  id: string,
  updates: Partial<RecoveryActionInput>
): Promise<RecoveryAction | null> {
  const existing = await getRecoveryActionById(id);
  if (!existing) {
    return null;
  }

  const db = await getDb();
  const result = await db.query(
    `
    UPDATE recovery_actions SET
      action_name = COALESCE($2, action_name),
      description = COALESCE($3, description),
      command = COALESCE($4, command),
      command_type = COALESCE($5, command_type),
      ssh_host = COALESCE($6, ssh_host),
      ssh_user = COALESCE($7, ssh_user),
      risk_level = COALESCE($8, risk_level),
      requires_approval = COALESCE($9, requires_approval),
      success_indicator = COALESCE($10, success_indicator),
      rollback_command = COALESCE($11, rollback_command),
      execution_order = COALESCE($12, execution_order),
      updated_at = NOW()
    WHERE id = $1
    RETURNING
      id,
      service_id as "serviceId",
      action_name as "actionName",
      description,
      command,
      command_type as "commandType",
      ssh_host as "sshHost",
      ssh_user as "sshUser",
      risk_level as "riskLevel",
      requires_approval as "requiresApproval",
      success_indicator as "successIndicator",
      rollback_command as "rollbackCommand",
      execution_order as "executionOrder",
      success_count as "successCount",
      failure_count as "failureCount",
      consecutive_success as "consecutiveSuccess",
      consecutive_failure as "consecutiveFailure",
      auto_adjust_enabled as "autoAdjustEnabled",
      created_at as "createdAt",
      updated_at as "updatedAt"
  `,
    [
      id,
      updates.actionName,
      updates.description,
      updates.command,
      updates.commandType,
      updates.sshHost,
      updates.sshUser,
      updates.riskLevel,
      updates.requiresApproval,
      updates.successIndicator,
      updates.rollbackCommand,
      updates.executionOrder,
    ]
  );

  log.info(`[ServiceRegistry] Updated recovery action: ${id}`);
  return result.rows[0];
}

/**
 * Delete a recovery action
 */
export async function deleteRecoveryAction(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.query(
    `DELETE FROM recovery_actions WHERE id = $1 RETURNING id`,
    [id]
  );

  if (result.rowCount && result.rowCount > 0) {
    log.info(`[ServiceRegistry] Deleted recovery action: ${id}`);
    return true;
  }
  return false;
}

/**
 * Update action risk level
 */
export async function updateActionRiskLevel(id: string, newLevel: RiskLevel): Promise<boolean> {
  const db = await getDb();
  const result = await db.query(
    `
    UPDATE recovery_actions SET
      risk_level = $2,
      requires_approval = $3,
      updated_at = NOW()
    WHERE id = $1
    RETURNING id
  `,
    [id, newLevel, newLevel !== 'safe']
  );

  if (result.rowCount && result.rowCount > 0) {
    log.info(`[ServiceRegistry] Updated risk level for action ${id} to ${newLevel}`);
    return true;
  }
  return false;
}

// ============================================
// Query Functions
// ============================================

/**
 * Get service count by category
 */
export async function getServiceCountByCategory(): Promise<Record<ServiceCategory, number>> {
  const db = await getDb();
  const result = await db.query(`
    SELECT category, COUNT(*) as count
    FROM infrastructure_services
    WHERE is_enabled = true
    GROUP BY category
  `);

  const counts: Record<string, number> = {
    app: 0,
    ai: 0,
    messaging: 0,
    database: 0,
    infrastructure: 0,
  };

  for (const row of result.rows) {
    counts[row.category] = parseInt(row.count, 10);
  }

  return counts as Record<ServiceCategory, number>;
}

/**
 * Check if service has recovery enabled
 */
export async function isRecoveryEnabled(serviceId: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.query(
    `SELECT recovery_enabled FROM infrastructure_services WHERE id = $1`,
    [serviceId]
  );

  return result.rows[0]?.recovery_enabled === true;
}

/**
 * Get next recovery action to try for a service
 */
export async function getNextRecoveryAction(
  serviceId: string,
  attemptedActionIds: string[] = []
): Promise<RecoveryAction | null> {
  const placeholders = attemptedActionIds.length > 0
    ? `AND id NOT IN (${attemptedActionIds.map((_, i) => `$${i + 2}`).join(', ')})`
    : '';

  const db = await getDb();
  const result = await db.query(
    `
    SELECT
      id,
      service_id as "serviceId",
      action_name as "actionName",
      description,
      command,
      command_type as "commandType",
      ssh_host as "sshHost",
      ssh_user as "sshUser",
      risk_level as "riskLevel",
      requires_approval as "requiresApproval",
      success_indicator as "successIndicator",
      rollback_command as "rollbackCommand",
      execution_order as "executionOrder"
    FROM recovery_actions
    WHERE service_id = $1 ${placeholders}
    ORDER BY execution_order
    LIMIT 1
  `,
    [serviceId, ...attemptedActionIds]
  );

  return result.rows[0] || null;
}

// Export as a service object for compatibility with tests
export const serviceRegistry = {
  getAllServices,
  getEnabledServices,
  getCriticalServices,
  getServiceById,
  getServicesByCategory,
  createService,
  updateService,
  deleteService,
  getRecoveryActions,
  getRecoveryActionById,
  getSafeRecoveryActions,
  createRecoveryAction,
  updateRecoveryAction,
  deleteRecoveryAction,
  updateActionRiskLevel,
  getServiceCountByCategory,
  isRecoveryEnabled,
  getNextRecoveryAction,
};

export default serviceRegistry;
