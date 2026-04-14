/**
 * Health Daemon
 *
 * Continuous monitoring service that checks health of all registered services,
 * detects issues, classifies them, and triggers appropriate recovery actions.
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
import net from 'net';
import { exec } from 'child_process';
import { promisify } from 'util';
import type {
  ServiceDefinition,
  HealthStatus,
  HealthCheckResult,
  AggregatedHealth,
  OverallStatus,
  ServiceHealth,
  MonitoringLoopConfig,
  DaemonStatus,
  Incident,
  IncidentInput,
} from '../types/self-healing.types';
import { serviceRegistry } from './serviceRegistry';

const execAsync = promisify(exec);

// Default configuration
const DEFAULT_CONFIG: MonitoringLoopConfig = {
  intervalMs: 60000, // 60 seconds
  parallelChecks: true,
  autoRecoveryEnabled: true,
  maxConcurrentChecks: 10,
};

// Daemon state
let isRunning = false;
let intervalId: NodeJS.Timeout | null = null;
let checksPerformed = 0;
let issuesDetected = 0;
let autoFixesExecuted = 0;
let lastCheck: Date | null = null;

// ============================================
// Health Check Functions
// ============================================

/**
 * Perform HTTP health check
 */
export async function checkHttpHealth(
  service: ServiceDefinition
): Promise<HealthCheckResult> {
  const startTime = Date.now();
  const checkedAt = new Date();

  if (!service.healthEndpoint) {
    return {
      serviceId: service.id,
      status: 'error',
      responseTimeMs: 0,
      errorMessage: 'No health endpoint configured',
      checkedAt,
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), service.timeoutMs);

    const response = await fetch(service.healthEndpoint, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
      },
    });

    clearTimeout(timeout);
    const responseTimeMs = Date.now() - startTime;

    let responseBody: Record<string, unknown> | undefined;
    try {
      responseBody = await response.json();
    } catch {
      // Response might not be JSON
    }

    const status: HealthStatus = response.ok ? 'healthy' : 'unhealthy';

    return {
      serviceId: service.id,
      status,
      responseTimeMs,
      statusCode: response.status,
      responseBody,
      checkedAt,
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startTime;
    const isTimeout = error instanceof Error && error.name === 'AbortError';

    return {
      serviceId: service.id,
      status: isTimeout ? 'timeout' : 'error',
      responseTimeMs,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      checkedAt,
    };
  }
}

/**
 * Perform systemd service health check via SSH
 */
export async function checkSystemdHealth(
  service: ServiceDefinition,
  sshHost: string,
  sshUser: string = 'velo'
): Promise<HealthCheckResult> {
  const startTime = Date.now();
  const checkedAt = new Date();
  const serviceName = service.name.toLowerCase().replace(/\s+/g, '-');

  try {
    const { stdout, stderr } = await execAsync(
      `ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${sshUser}@${sshHost} "systemctl is-active ${serviceName}.service"`,
      { timeout: service.timeoutMs }
    );

    const responseTimeMs = Date.now() - startTime;
    const isActive = stdout.trim() === 'active';

    return {
      serviceId: service.id,
      status: isActive ? 'healthy' : 'unhealthy',
      responseTimeMs,
      responseBody: { systemdStatus: stdout.trim() },
      errorMessage: stderr || undefined,
      checkedAt,
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startTime;

    return {
      serviceId: service.id,
      status: 'error',
      responseTimeMs,
      errorMessage: error instanceof Error ? error.message : 'SSH check failed',
      checkedAt,
    };
  }
}

/**
 * Perform TCP port health check
 */
export async function checkTcpHealth(
  service: ServiceDefinition,
  host: string,
  port: number
): Promise<HealthCheckResult> {
  const startTime = Date.now();
  const checkedAt = new Date();

  return new Promise((resolve) => {
    const socket = new net.Socket();

    socket.setTimeout(service.timeoutMs);

    socket.on('connect', () => {
      const responseTimeMs = Date.now() - startTime;
      socket.destroy();
      resolve({
        serviceId: service.id,
        status: 'healthy',
        responseTimeMs,
        checkedAt,
      });
    });

    socket.on('timeout', () => {
      const responseTimeMs = Date.now() - startTime;
      socket.destroy();
      resolve({
        serviceId: service.id,
        status: 'timeout',
        responseTimeMs,
        errorMessage: 'Connection timed out',
        checkedAt,
      });
    });

    socket.on('error', (error: Error) => {
      const responseTimeMs = Date.now() - startTime;
      socket.destroy();
      resolve({
        serviceId: service.id,
        status: 'error',
        responseTimeMs,
        errorMessage: error.message,
        checkedAt,
      });
    });

    socket.connect(port, host);
  });
}

/**
 * Perform database health check
 */
export async function checkDatabaseHealth(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  const checkedAt = new Date();
  const serviceId = '00000000-0000-0000-0000-000000000008'; // Neon DB service ID

  try {
    const db = await getDb();
  const result = await db.query('SELECT 1 as health_check');
    const responseTimeMs = Date.now() - startTime;

    return {
      serviceId,
      status: result.rows.length > 0 ? 'healthy' : 'unhealthy',
      responseTimeMs,
      checkedAt,
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startTime;

    return {
      serviceId,
      status: 'error',
      responseTimeMs,
      errorMessage: error instanceof Error ? error.message : 'Database check failed',
      checkedAt,
    };
  }
}

/**
 * Check health of a single service
 */
export async function checkServiceHealth(service: ServiceDefinition): Promise<HealthCheckResult> {
  switch (service.healthCheckType) {
    case 'http':
      return checkHttpHealth(service);
    case 'systemd':
      // Extract SSH details from health endpoint or use defaults
      return checkSystemdHealth(service, '100.96.203.105', 'velo');
    case 'tcp': {
      // Parse host:port from health endpoint
      const [tcpHost, tcpPort] = (service.healthEndpoint || 'localhost:5432').split(':');
      return checkTcpHealth(service, tcpHost || 'localhost', parseInt(tcpPort || '5432', 10));
    }
    case 'custom':
      // For database, use custom check
      if (service.category === 'database') {
        return checkDatabaseHealth();
      }
      return checkHttpHealth(service);
    default:
      return checkHttpHealth(service);
  }
}

/**
 * Check health of all enabled services
 */
export async function checkAllServices(
  config: Partial<MonitoringLoopConfig> = {}
): Promise<HealthCheckResult[]> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const services = await serviceRegistry.getEnabledServices();

  if (mergedConfig.parallelChecks) {
    // Run checks in parallel with concurrency limit
    const results: HealthCheckResult[] = [];
    const chunks: ServiceDefinition[][] = [];

    for (let i = 0; i < services.length; i += mergedConfig.maxConcurrentChecks) {
      chunks.push(services.slice(i, i + mergedConfig.maxConcurrentChecks));
    }

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map((service) => checkServiceHealth(service))
      );
      results.push(...chunkResults);
    }

    return results;
  } else {
    // Run checks sequentially
    const results: HealthCheckResult[] = [];
    for (const service of services) {
      results.push(await checkServiceHealth(service));
    }
    return results;
  }
}

/**
 * Get aggregated health status
 */
export async function getAggregatedHealth(): Promise<AggregatedHealth> {
  const services = await serviceRegistry.getEnabledServices();
  const results = await checkAllServices();

  const serviceHealthMap = new Map<string, HealthCheckResult>();
  for (const result of results) {
    serviceHealthMap.set(result.serviceId, result);
  }

  const serviceHealthList: ServiceHealth[] = services.map((service) => {
    const result = serviceHealthMap.get(service.id);
    return {
      serviceId: service.id,
      serviceName: service.name,
      status: result?.status || 'error',
      responseTimeMs: result?.responseTimeMs,
      statusCode: result?.statusCode,
      errorMessage: result?.errorMessage,
      lastChecked: result?.checkedAt || new Date(),
    };
  });

  const healthyCount = serviceHealthList.filter((s) => s.status === 'healthy').length;
  const unhealthyCount = serviceHealthList.filter((s) => s.status !== 'healthy').length;

  // Check if any critical service is down
  const criticalServices = await serviceRegistry.getCriticalServices();
  const criticalDown = criticalServices.some((cs) => {
    const health = serviceHealthMap.get(cs.id);
    return health && health.status !== 'healthy';
  });

  // Determine overall status
  let overall: OverallStatus;
  if (criticalDown) {
    overall = 'critical';
  } else if (unhealthyCount > 0) {
    overall = 'degraded';
  } else {
    overall = 'healthy';
  }

  return {
    overall,
    services: serviceHealthList,
    healthyCount,
    unhealthyCount,
    criticalDown,
    checkedAt: new Date(),
  };
}

// ============================================
// Health Log Storage
// ============================================

/**
 * Store health check result in database
 */
export async function storeHealthCheck(result: HealthCheckResult): Promise<void> {
  const db = await getDb();
  await db.query(
    `
    INSERT INTO system_health_logs (
      service_id,
      status,
      response_time_ms,
      status_code,
      response_body,
      error_message,
      checked_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
  `,
    [
      result.serviceId,
      result.status,
      result.responseTimeMs,
      result.statusCode || null,
      result.responseBody ? JSON.stringify(result.responseBody) : null,
      result.errorMessage || null,
      result.checkedAt,
    ]
  );
}

/**
 * Get health history for a service
 */
export async function getHealthHistory(
  serviceId: string,
  limit: number = 100
): Promise<HealthCheckResult[]> {
  const db = await getDb();
  const result = await db.query<HealthCheckResult>(
    `
    SELECT
      service_id as "serviceId",
      status,
      response_time_ms as "responseTimeMs",
      status_code as "statusCode",
      response_body as "responseBody",
      error_message as "errorMessage",
      checked_at as "checkedAt"
    FROM system_health_logs
    WHERE service_id = $1
    ORDER BY checked_at DESC
    LIMIT $2
  `,
    [serviceId, limit]
  );

  return result.rows;
}

// ============================================
// Issue Detection
// ============================================

/**
 * Detect if there's a new issue based on health results
 */
export async function detectIssue(
  service: ServiceDefinition,
  currentResult: HealthCheckResult
): Promise<{ isNewIssue: boolean; issueType?: string; symptoms?: string[] }> {
  if (currentResult.status === 'healthy') {
    return { isNewIssue: false };
  }

  // Get recent health history
  const history = await getHealthHistory(service.id, 5);

  // Check if this is a new issue (wasn't failing before)
  const previousResults = history.slice(1); // Exclude current
  const wasHealthy = previousResults.length === 0 ||
    previousResults.some((h) => h.status === 'healthy');

  if (!wasHealthy) {
    // Already had an ongoing issue
    return { isNewIssue: false };
  }

  // Classify the issue
  let issueType = 'unknown';
  const symptoms: string[] = [];

  if (currentResult.status === 'timeout') {
    issueType = 'connection_timeout';
    symptoms.push(`Request timed out after ${service.timeoutMs}ms`);
  } else if (currentResult.status === 'error') {
    if (currentResult.errorMessage?.includes('ECONNREFUSED')) {
      issueType = 'connection_refused';
      symptoms.push('Connection refused - service may be down');
    } else if (currentResult.errorMessage?.includes('ENOTFOUND')) {
      issueType = 'dns_error';
      symptoms.push('DNS resolution failed');
    } else {
      issueType = 'service_error';
      symptoms.push(currentResult.errorMessage || 'Unknown error');
    }
  } else if (currentResult.status === 'unhealthy') {
    issueType = 'health_check_failed';
    symptoms.push(`Health check returned status ${currentResult.statusCode}`);
    if (currentResult.statusCode && currentResult.statusCode >= 500) {
      symptoms.push('Server returned 5xx error');
    }
  }

  return {
    isNewIssue: true,
    issueType,
    symptoms,
  };
}

/**
 * Create an incident from detected issue
 */
export async function createIncident(input: IncidentInput): Promise<Incident> {
  const db = await getDb();
  const result = await db.query<Incident>(
    `
    INSERT INTO infrastructure_incidents (
      service_id,
      issue_type,
      symptoms,
      error_message
    ) VALUES ($1, $2, $3, $4)
    RETURNING
      id,
      service_id as "serviceId",
      issue_type as "issueType",
      symptoms,
      error_message as "errorMessage",
      root_cause as "rootCause",
      confidence,
      resolved,
      resolved_by as "resolvedBy",
      resolution_action_id as "resolutionActionId",
      time_to_resolve_seconds as "timeToResolveSeconds",
      human_intervention as "humanIntervention",
      human_notes as "humanNotes",
      learnings,
      kb_exported as "kbExported",
      kb_file_path as "kbFilePath",
      created_at as "createdAt",
      resolved_at as "resolvedAt"
  `,
    [
      input.serviceId,
      input.issueType || null,
      JSON.stringify(input.symptoms || []),
      input.errorMessage || null,
    ]
  );

  log.warn(`[HealthDaemon] Created incident for service ${input.serviceId}: ${input.issueType}`);
  return result.rows[0] as Incident;
}

/**
 * Get active (unresolved) incident for a service
 */
export async function getActiveIncident(serviceId: string): Promise<Incident | null> {
  const db = await getDb();
  const result = await db.query<Incident>(
    `
    SELECT
      id,
      service_id as "serviceId",
      issue_type as "issueType",
      symptoms,
      error_message as "errorMessage",
      created_at as "createdAt"
    FROM infrastructure_incidents
    WHERE service_id = $1 AND resolved = false
    ORDER BY created_at DESC
    LIMIT 1
  `,
    [serviceId]
  );

  return (result.rows[0] as Incident) ?? null;
}

// ============================================
// Monitoring Loop
// ============================================

/**
 * Run a single monitoring cycle
 */
export async function runMonitoringCycle(
  config: Partial<MonitoringLoopConfig> = {}
): Promise<void> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  try {
    const services = await serviceRegistry.getEnabledServices();
    log.info(`[HealthDaemon] Running health check for ${services.length} services`);

    for (const service of services) {
      const result = await checkServiceHealth(service);

      // Store the result
      await storeHealthCheck(result);
      checksPerformed++;

      // Check for issues
      const { isNewIssue, issueType, symptoms } = await detectIssue(service, result);

      if (isNewIssue) {
        issuesDetected++;
        log.warn(`[HealthDaemon] Issue detected for ${service.name}: ${issueType}`);

        // Create incident
        const incident = await createIncident({
          serviceId: service.id,
          issueType,
          symptoms,
          errorMessage: result.errorMessage,
        });

        // Trigger recovery if enabled
        if (mergedConfig.autoRecoveryEnabled && service.recoveryEnabled) {
          // Import recovery service dynamically to avoid circular deps
          const { recoveryService } = await import('./recoveryService');
          await recoveryService.triggerRecovery(service.id, incident.id);
          autoFixesExecuted++;
        }
      }
    }

    lastCheck = new Date();
  } catch (error) {
    log.error('[HealthDaemon] Error in monitoring cycle', { error });
  }
}

/**
 * Start the monitoring daemon
 */
export function startDaemon(config: Partial<MonitoringLoopConfig> = {}): void {
  if (isRunning) {
    log.warn('[HealthDaemon] Daemon is already running');
    return;
  }

  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  log.info(`[HealthDaemon] Starting daemon with ${mergedConfig.intervalMs}ms interval`);
  isRunning = true;

  // Run immediately
  runMonitoringCycle(mergedConfig);

  // Then run on interval
  intervalId = setInterval(() => {
    runMonitoringCycle(mergedConfig);
  }, mergedConfig.intervalMs);
}

/**
 * Stop the monitoring daemon
 */
export function stopDaemon(): void {
  if (!isRunning) {
    log.warn('[HealthDaemon] Daemon is not running');
    return;
  }

  log.info('[HealthDaemon] Stopping daemon');
  isRunning = false;

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

/**
 * Get daemon status
 */
export function getDaemonStatus(): DaemonStatus {
  return {
    running: isRunning,
    isRunning,
    lastCheck: lastCheck || undefined,
    nextCheck: isRunning && lastCheck
      ? new Date(lastCheck.getTime() + DEFAULT_CONFIG.intervalMs)
      : undefined,
    checksPerformed,
    issuesDetected,
    autoFixesExecuted,
    intervalMs: DEFAULT_CONFIG.intervalMs,
    cycleCount: checksPerformed,
    errorCount: issuesDetected,
    startedAt: isRunning && lastCheck ? lastCheck : undefined,
  };
}

/**
 * Graceful shutdown
 */
export async function gracefulShutdown(): Promise<void> {
  log.info('[HealthDaemon] Initiating graceful shutdown');
  stopDaemon();

  // Wait for any pending operations
  await new Promise((resolve) => setTimeout(resolve, 1000));
  log.info('[HealthDaemon] Shutdown complete');
}

// Handle process signals
if (typeof process !== 'undefined') {
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

// Export as service object
export const healthDaemon = {
  checkHttpHealth,
  checkSystemdHealth,
  checkTcpHealth,
  checkDatabaseHealth,
  checkServiceHealth,
  checkAllServices,
  getAggregatedHealth,
  storeHealthCheck,
  getHealthHistory,
  detectIssue,
  createIncident,
  getActiveIncident,
  runMonitoringCycle,
  startDaemon,
  stopDaemon,
  getDaemonStatus,
  gracefulShutdown,
};

export default healthDaemon;
