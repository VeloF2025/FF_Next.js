/**
 * Infrastructure Health Service
 * Comprehensive health checking for all FibreFlow infrastructure
 */

import { neon } from '@neondatabase/serverless';
import type {
  ServiceStatus,
  ServiceStatusValue,
  OverallStatus,
  DatabaseStatus,
  ContainerStatus,
  QFieldStatus,
  RecoveryAction,
  SystemHealthResponse,
  HealthCheckOptions,
} from '../types/infrastructure.types';

// Database connection
const DATABASE_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '';

// Service URLs (running on Velocity server 100.96.203.105)
const VELOCITY_HOST = 'localhost'; // When running on same server
const VPS_HOST = '72.61.197.178';

const SERVICE_ENDPOINTS = {
  apps: {
    production: { url: `http://${VELOCITY_HOST}:3000/api/health`, timeout: 10000 },
    staging: { url: `http://${VELOCITY_HOST}:3006/api/health`, timeout: 10000 },
    dev: { url: `http://${VELOCITY_HOST}:3005/api/health`, timeout: 10000 },
    backup: { url: `http://${VPS_HOST}:3005/api/health`, timeout: 15000 },
  },
  ai: {
    vlm: { url: `http://${VELOCITY_HOST}:8100/v1/models`, timeout: 15000 },
    ollama: { url: `http://${VELOCITY_HOST}:11434/api/tags`, timeout: 10000 },
    qdrant: { url: `http://${VELOCITY_HOST}:6333/healthz`, timeout: 10000 },
  },
  messaging: {
    waFeedback: { url: `http://${VELOCITY_HOST}:8092/health`, timeout: 10000 },
    waSenderVPS: { url: `http://${VPS_HOST}:8081/health`, timeout: 15000 },
    waBridgeVPS: { url: `http://${VPS_HOST}:8083/health`, timeout: 15000 },
  },
  infrastructure: {
    pdfcraft: { url: `http://${VELOCITY_HOST}:3007`, timeout: 10000 },
    grafana: { url: `http://${VELOCITY_HOST}:3030/api/health`, timeout: 10000 },
  },
  qfield: {
    syncWebhook: { url: `http://${VELOCITY_HOST}:8095/health`, timeout: 10000 },
  },
};

// QFieldCloud container names
const QFIELD_CONTAINERS = [
  'qfieldcloud-nginx-1',
  'qfieldcloud-app-1',
  'qfieldcloud-db-1',
  'qfieldcloud-minio-1',
  'qfieldcloud-memcached-1',
  'qfieldcloud-worker_wrapper-1',
  'qfieldcloud-worker_wrapper-2',
  'qfieldcloud-worker_wrapper-3',
];

/**
 * Check HTTP endpoint health
 */
async function checkHttpEndpoint(
  url: string,
  timeout: number = 10000
): Promise<ServiceStatus> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'FibreFlow-HealthCheck/1.0' },
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return {
        status: 'up',
        latencyMs,
        lastCheck: new Date().toISOString(),
      };
    } else {
      return {
        status: 'degraded',
        latencyMs,
        lastCheck: new Date().toISOString(),
        message: `HTTP ${response.status}`,
      };
    }
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Distinguish between timeout and connection refused
    const isTimeout = errorMessage.includes('abort') || errorMessage.includes('timeout');
    const isConnectionRefused = errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed');

    return {
      status: 'down',
      latencyMs: isTimeout ? timeout : latencyMs,
      lastCheck: new Date().toISOString(),
      error: isTimeout ? 'Timeout' : isConnectionRefused ? 'Connection refused' : errorMessage,
    };
  }
}

/**
 * Check database connection health
 */
async function checkDatabaseHealth(
  connectionUrl: string,
  name: string,
  branch?: string
): Promise<DatabaseStatus> {
  const startTime = Date.now();

  try {
    const sql = neon(connectionUrl);
    const result = await sql`SELECT 1 as health, NOW() as server_time`;
    const latencyMs = Date.now() - startTime;

    return {
      status: 'up',
      latencyMs,
      lastCheck: new Date().toISOString(),
      branch,
      message: `Connected successfully`,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return {
      status: 'down',
      latencyMs,
      lastCheck: new Date().toISOString(),
      branch,
      error: errorMessage.substring(0, 100),
    };
  }
}

/**
 * Check Docker container status via docker ps command
 * This requires the API to have access to docker commands
 */
async function checkDockerContainers(): Promise<ContainerStatus[]> {
  // For now, we'll check via HTTP endpoints where available
  // Full docker status would require executing docker commands on the server
  const containers: ContainerStatus[] = [];

  for (const containerName of QFIELD_CONTAINERS) {
    containers.push({
      name: containerName,
      status: 'unknown', // Would need docker ps access
    });
  }

  return containers;
}

/**
 * Check QFieldCloud status
 */
async function checkQFieldStatus(): Promise<QFieldStatus> {
  const syncWebhook = await checkHttpEndpoint(
    SERVICE_ENDPOINTS.qfield.syncWebhook.url,
    SERVICE_ENDPOINTS.qfield.syncWebhook.timeout
  );

  // Check QField app endpoint
  const qfieldApp = await checkHttpEndpoint(
    `http://${VELOCITY_HOST}:8000/api/v1/`,
    10000
  );

  // Check MinIO health
  const minioHealth = await checkHttpEndpoint(
    `http://${VELOCITY_HOST}:8009/minio/health/live`,
    10000
  );

  const containers = await checkDockerContainers();

  // Determine running count based on endpoint checks
  let runningContainers = 0;
  if (qfieldApp.status === 'up') runningContainers += 2; // app + nginx
  if (minioHealth.status === 'up') runningContainers += 1;
  if (syncWebhook.status === 'up') runningContainers += 1;

  // Update container statuses based on endpoint checks
  const updatedContainers = containers.map(c => {
    if (c.name.includes('app') || c.name.includes('nginx')) {
      return { ...c, status: qfieldApp.status === 'up' ? 'running' as const : 'unknown' as const };
    }
    if (c.name.includes('minio')) {
      return { ...c, status: minioHealth.status === 'up' ? 'running' as const : 'unknown' as const };
    }
    return c;
  });

  const overall: OverallStatus =
    qfieldApp.status === 'up' && minioHealth.status === 'up'
      ? 'healthy'
      : qfieldApp.status === 'down' || minioHealth.status === 'down'
        ? 'critical'
        : 'degraded';

  return {
    overall,
    containers: updatedContainers,
    syncWebhook,
    totalContainers: QFIELD_CONTAINERS.length,
    runningContainers,
  };
}

/**
 * Check cloudflared tunnel status
 * Since we can't directly check the tunnel, we'll verify via external endpoint
 */
async function checkCloudflaredStatus(): Promise<ServiceStatus> {
  // Try to reach a known cloudflared-proxied endpoint from inside
  // If the tunnel is down, external users can't reach, but internal still works
  // We'll check the systemd service status indirectly by checking if external works
  const startTime = Date.now();

  try {
    // Check if we can reach vf.fibreflow.app from the server
    const response = await fetch('https://vf.fibreflow.app/api/health', {
      method: 'GET',
      signal: AbortSignal.timeout(15000),
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return {
        status: 'up',
        latencyMs,
        lastCheck: new Date().toISOString(),
        message: 'Tunnel accessible via Cloudflare',
      };
    } else {
      return {
        status: 'degraded',
        latencyMs,
        lastCheck: new Date().toISOString(),
        message: `HTTP ${response.status}`,
      };
    }
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    return {
      status: 'unknown', // Can't determine from inside server
      latencyMs,
      lastCheck: new Date().toISOString(),
      message: 'Unable to verify tunnel externally',
    };
  }
}

/**
 * Get recent recovery actions from database
 */
async function getRecentRecoveryActions(limit: number = 10): Promise<RecoveryAction[]> {
  if (!DATABASE_URL) return [];

  try {
    const sql = neon(DATABASE_URL);
    const results = await sql`
      SELECT
        id,
        timestamp,
        service_name,
        service_type,
        action_taken,
        previous_status,
        result_status,
        error_message,
        alert_sent,
        EXTRACT(EPOCH FROM (NOW() - timestamp)) / 60 as minutes_ago
      FROM system_recovery_actions
      WHERE timestamp > NOW() - INTERVAL '24 hours'
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `;

    return results.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      serviceName: r.service_name,
      serviceType: r.service_type,
      actionTaken: r.action_taken,
      previousStatus: r.previous_status,
      resultStatus: r.result_status,
      errorMessage: r.error_message,
      alertSent: r.alert_sent,
      minutesAgo: Math.round(r.minutes_ago),
    }));
  } catch {
    return [];
  }
}

/**
 * Save health snapshot to database
 */
async function saveHealthSnapshot(health: SystemHealthResponse): Promise<void> {
  if (!DATABASE_URL) return;

  try {
    const sql = neon(DATABASE_URL);
    await sql`
      INSERT INTO system_health_logs (
        timestamp,
        overall_status,
        apps,
        qfield,
        ai_services,
        messaging,
        databases,
        infrastructure,
        total_services,
        healthy_count,
        degraded_count,
        down_count
      ) VALUES (
        ${health.timestamp},
        ${health.overall},
        ${JSON.stringify(health.apps)},
        ${JSON.stringify(health.qfield)},
        ${JSON.stringify(health.ai)},
        ${JSON.stringify(health.messaging)},
        ${JSON.stringify(health.databases)},
        ${JSON.stringify(health.infrastructure)},
        ${health.summary.totalServices},
        ${health.summary.healthyCount},
        ${health.summary.degradedCount},
        ${health.summary.downCount}
      )
    `;
  } catch (error) {
    console.error('Failed to save health snapshot:', error);
  }
}

/**
 * Calculate overall status based on service statuses
 */
function calculateOverallStatus(statuses: ServiceStatus[], criticalDown: boolean): OverallStatus {
  const downCount = statuses.filter(s => s.status === 'down').length;
  const degradedCount = statuses.filter(s => s.status === 'degraded').length;

  if (criticalDown || downCount >= 3) return 'critical';
  if (downCount > 0 || degradedCount >= 2) return 'degraded';
  return 'healthy';
}

/**
 * Main health check function - performs comprehensive system health check
 */
export async function performHealthCheck(
  options: HealthCheckOptions = {}
): Promise<SystemHealthResponse> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  const {
    includeRecoveryLog = true,
    recoveryLogLimit = 10,
    saveToHistory = false,
  } = options;

  // Perform all checks in parallel for speed
  const [
    // Apps
    productionStatus,
    stagingStatus,
    devStatus,
    backupStatus,
    // AI
    vlmStatus,
    ollamaStatus,
    qdrantStatus,
    // Messaging
    waFeedbackStatus,
    waSenderVPSStatus,
    waBridgeVPSStatus,
    // Infrastructure
    pdfcraftStatus,
    grafanaStatus,
    cloudflaredStatus,
    // QField
    qfieldStatus,
    // Databases
    neonProductionStatus,
    // Recovery actions
    recoveryActions,
  ] = await Promise.all([
    // Apps
    checkHttpEndpoint(SERVICE_ENDPOINTS.apps.production.url, SERVICE_ENDPOINTS.apps.production.timeout),
    checkHttpEndpoint(SERVICE_ENDPOINTS.apps.staging.url, SERVICE_ENDPOINTS.apps.staging.timeout),
    checkHttpEndpoint(SERVICE_ENDPOINTS.apps.dev.url, SERVICE_ENDPOINTS.apps.dev.timeout),
    checkHttpEndpoint(SERVICE_ENDPOINTS.apps.backup.url, SERVICE_ENDPOINTS.apps.backup.timeout),
    // AI
    checkHttpEndpoint(SERVICE_ENDPOINTS.ai.vlm.url, SERVICE_ENDPOINTS.ai.vlm.timeout),
    checkHttpEndpoint(SERVICE_ENDPOINTS.ai.ollama.url, SERVICE_ENDPOINTS.ai.ollama.timeout),
    checkHttpEndpoint(SERVICE_ENDPOINTS.ai.qdrant.url, SERVICE_ENDPOINTS.ai.qdrant.timeout),
    // Messaging
    checkHttpEndpoint(SERVICE_ENDPOINTS.messaging.waFeedback.url, SERVICE_ENDPOINTS.messaging.waFeedback.timeout),
    checkHttpEndpoint(SERVICE_ENDPOINTS.messaging.waSenderVPS.url, SERVICE_ENDPOINTS.messaging.waSenderVPS.timeout),
    checkHttpEndpoint(SERVICE_ENDPOINTS.messaging.waBridgeVPS.url, SERVICE_ENDPOINTS.messaging.waBridgeVPS.timeout),
    // Infrastructure
    checkHttpEndpoint(SERVICE_ENDPOINTS.infrastructure.pdfcraft.url, SERVICE_ENDPOINTS.infrastructure.pdfcraft.timeout),
    checkHttpEndpoint(SERVICE_ENDPOINTS.infrastructure.grafana.url, SERVICE_ENDPOINTS.infrastructure.grafana.timeout),
    checkCloudflaredStatus(),
    // QField
    checkQFieldStatus(),
    // Databases
    checkDatabaseHealth(DATABASE_URL, 'Neon Production', 'production'),
    // Recovery actions
    includeRecoveryLog ? getRecentRecoveryActions(recoveryLogLimit) : Promise.resolve([]),
  ]);

  // Dev database check (uses same connection, just for display)
  const neonDevStatus: DatabaseStatus = {
    ...neonProductionStatus,
    branch: 'hein-dev',
  };

  // QField postgres (would need separate connection)
  const qfieldDbStatus: DatabaseStatus = {
    status: qfieldStatus.overall === 'healthy' ? 'up' : 'unknown',
    latencyMs: null,
    lastCheck: timestamp,
    message: 'Inferred from QField app status',
  };

  // Portainer status (requires auth, skip for now)
  const portainerStatus: ServiceStatus = {
    status: 'unknown',
    latencyMs: null,
    lastCheck: timestamp,
    message: 'Requires authentication',
  };

  // Collect all statuses for summary
  const allStatuses: ServiceStatus[] = [
    productionStatus,
    stagingStatus,
    devStatus,
    backupStatus,
    vlmStatus,
    ollamaStatus,
    qdrantStatus,
    waFeedbackStatus,
    waSenderVPSStatus,
    waBridgeVPSStatus,
    pdfcraftStatus,
    grafanaStatus,
    cloudflaredStatus,
    neonProductionStatus,
  ];

  // Identify critical services that are down
  const criticalServices = [
    { name: 'Production', status: productionStatus },
    { name: 'VLM', status: vlmStatus },
    { name: 'WA Feedback', status: waFeedbackStatus },
    { name: 'Neon DB', status: neonProductionStatus },
  ];

  const criticalServicesDown = criticalServices
    .filter(s => s.status.status === 'down')
    .map(s => s.name);

  // Calculate counts
  const healthyCount = allStatuses.filter(s => s.status === 'up').length;
  const degradedCount = allStatuses.filter(s => s.status === 'degraded').length;
  const downCount = allStatuses.filter(s => s.status === 'down').length;
  const totalServices = allStatuses.length;

  const overall = calculateOverallStatus(allStatuses, criticalServicesDown.length > 0);

  const response: SystemHealthResponse = {
    timestamp,
    overall,
    checkDurationMs: Date.now() - startTime,

    apps: {
      production: productionStatus,
      staging: stagingStatus,
      dev: devStatus,
      backup: backupStatus,
    },

    qfield: qfieldStatus,

    ai: {
      vlm: vlmStatus,
      ollama: ollamaStatus,
      qdrant: qdrantStatus,
    },

    messaging: {
      waFeedback: waFeedbackStatus,
      waSenderVPS: waSenderVPSStatus,
      waBridgeVPS: waBridgeVPSStatus,
    },

    databases: {
      neonProduction: neonProductionStatus,
      neonDev: neonDevStatus,
      qfieldDb: qfieldDbStatus,
    },

    infrastructure: {
      cloudflared: cloudflaredStatus,
      pdfcraft: pdfcraftStatus,
      grafana: grafanaStatus,
      portainer: portainerStatus,
    },

    summary: {
      totalServices,
      healthyCount,
      degradedCount,
      downCount,
      healthPercentage: Math.round((healthyCount / totalServices) * 100),
      criticalServicesDown,
    },

    recentRecoveryActions: recoveryActions,
  };

  // Save to history if requested
  if (saveToHistory) {
    await saveHealthSnapshot(response);
  }

  return response;
}

/**
 * Get health history for trend charts
 */
export async function getHealthHistory(
  hours: number = 24,
  limit: number = 100
): Promise<{ entries: SystemHealthResponse['summary'][]; timestamps: string[] }> {
  if (!DATABASE_URL) {
    return { entries: [], timestamps: [] };
  }

  try {
    const sql = neon(DATABASE_URL);
    const results = await sql`
      SELECT
        timestamp,
        overall_status,
        total_services,
        healthy_count,
        degraded_count,
        down_count
      FROM system_health_logs
      WHERE timestamp > NOW() - INTERVAL '${hours} hours'
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `;

    const entries = results.map(r => ({
      totalServices: r.total_services,
      healthyCount: r.healthy_count,
      degradedCount: r.degraded_count,
      downCount: r.down_count,
      healthPercentage: Math.round((r.healthy_count / r.total_services) * 100),
      criticalServicesDown: [],
    }));

    const timestamps = results.map(r => r.timestamp);

    return { entries, timestamps };
  } catch {
    return { entries: [], timestamps: [] };
  }
}
