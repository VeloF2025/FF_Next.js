/**
 * QField System API
 * Handles health checks, sync operations, and job management
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { exec } from 'child_process';
import { promisify } from 'util';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const execAsync = promisify(exec);

// Server configuration
const VELOCITY_SERVER = '100.96.203.105';
const SSH_USER = 'velo';
const SSH_PASS = 'velo2026';

interface HealthStatus {
  services: {
    qfieldSync: { status: string; uptime?: string };
    cloudflared: { status: string; uptime?: string };
  };
  containers: {
    total: number;
    running: number;
    list: Array<{ name: string; status: string }>;
  };
  database: {
    connected: boolean;
    stats: Record<string, number>;
  };
  minio: {
    live: boolean;
    ready: boolean;
  };
  externalUrl: {
    reachable: boolean;
    httpCode: number;
    latency: string;
  };
  syncApi: {
    healthy: boolean;
    lastSync: string | null;
    lastCount: number | null;
    lastError: string | null;
  };
  jobs: {
    pending: number;
    queued: number;
    stuck: Array<{ id: string; type: string; status: string; project: string; createdAt: string }>;
  };
}

async function sshCommand(command: string): Promise<string> {
  const sshCmd = `sshpass -p '${SSH_PASS}' ssh -o StrictHostKeyChecking=no ${SSH_USER}@${VELOCITY_SERVER} "${command.replace(/"/g, '\\"')}"`;
  try {
    const { stdout } = await execAsync(sshCmd, { timeout: 30000 });
    return stdout.trim();
  } catch (error) {
    log.error('SSH command failed', { command, error });
    throw error;
  }
}

async function getHealthStatus(): Promise<HealthStatus> {
  const results = await Promise.allSettled([
    // Services status
    sshCommand("echo 'velo2026' | sudo -S systemctl is-active qfield-sync.service 2>/dev/null"),
    sshCommand("echo 'velo2026' | sudo -S systemctl is-active cloudflared-qfield.service 2>/dev/null"),

    // Container status
    sshCommand("docker ps --filter 'name=qfieldcloud' --format '{{.Names}}|{{.Status}}' | sort"),

    // Database stats
    sshCommand(`docker exec qfieldcloud-db-1 psql -U qfieldcloud_db_admin -d qfieldcloud_db -t -c "
      SELECT 'projects', COUNT(*) FROM core_project
      UNION ALL SELECT 'users', COUNT(*) FROM core_user
      UNION ALL SELECT 'jobs', COUNT(*) FROM core_job
      UNION ALL SELECT 'files', COUNT(*) FROM filestorage_file
      UNION ALL SELECT 'oes_activations', COUNT(*) FROM ff_oes_activations
    "`),

    // MinIO status
    sshCommand("curl -s http://localhost:8009/minio/health/live && echo 'OK' || echo 'FAILED'"),

    // Sync API status
    sshCommand("curl -s http://localhost:8095/status"),

    // Stuck jobs
    sshCommand(`docker exec qfieldcloud-db-1 psql -U qfieldcloud_db_admin -d qfieldcloud_db -t -c "
      SELECT j.id || '|' || j.type || '|' || j.status || '|' || COALESCE(p.name, 'unknown') || '|' || j.created_at
      FROM core_job j
      LEFT JOIN core_project p ON j.project_id = p.id
      WHERE j.status IN ('pending', 'queued')
      ORDER BY j.created_at
    "`),
  ]);

  // Parse services
  const qfieldSyncStatus = results[0].status === 'fulfilled' ? results[0].value : 'unknown';
  const cloudflaredStatus = results[1].status === 'fulfilled' ? results[1].value : 'unknown';

  // Parse containers
  const containerList: Array<{ name: string; status: string }> = [];
  if (results[2].status === 'fulfilled' && results[2].value) {
    results[2].value.split('\n').filter(Boolean).forEach(line => {
      const [name, status] = line.split('|');
      if (name && status) {
        containerList.push({ name: name.trim(), status: status.trim() });
      }
    });
  }

  // Parse database stats
  const dbStats: Record<string, number> = {};
  if (results[3].status === 'fulfilled' && results[3].value) {
    results[3].value.split('\n').filter(Boolean).forEach(line => {
      const parts = line.trim().split('|').map(s => s.trim());
      if (parts.length === 2) {
        dbStats[parts[0]] = parseInt(parts[1], 10) || 0;
      }
    });
  }

  // Parse MinIO
  const minioLive = results[4].status === 'fulfilled' && results[4].value.includes('OK');

  // Parse sync API
  let syncApi = { healthy: false, lastSync: null as string | null, lastCount: null as number | null, lastError: null as string | null };
  if (results[5].status === 'fulfilled' && results[5].value) {
    try {
      const parsed = JSON.parse(results[5].value);
      syncApi = {
        healthy: true,
        lastSync: parsed.last_sync || null,
        lastCount: parsed.last_count || null,
        lastError: parsed.last_error || null,
      };
    } catch {
      // JSON parse failed
    }
  }

  // Parse stuck jobs
  const stuckJobs: Array<{ id: string; type: string; status: string; project: string; createdAt: string }> = [];
  if (results[6].status === 'fulfilled' && results[6].value) {
    results[6].value.split('\n').filter(Boolean).forEach(line => {
      const parts = line.trim().split('|').map(s => s.trim());
      if (parts.length >= 5) {
        stuckJobs.push({
          id: parts[0],
          type: parts[1],
          status: parts[2],
          project: parts[3],
          createdAt: parts[4],
        });
      }
    });
  }

  // Check external URL
  let externalUrl = { reachable: false, httpCode: 0, latency: '0' };
  try {
    const { stdout } = await execAsync(
      "curl -s -o /dev/null -w '%{http_code}|%{time_total}' https://qfield.fibreflow.app/",
      { timeout: 10000 }
    );
    const [code, time] = stdout.split('|');
    externalUrl = {
      reachable: parseInt(code, 10) > 0,
      httpCode: parseInt(code, 10),
      latency: `${(parseFloat(time) * 1000).toFixed(0)}ms`,
    };
  } catch {
    // External URL check failed
  }

  return {
    services: {
      qfieldSync: { status: qfieldSyncStatus },
      cloudflared: { status: cloudflaredStatus },
    },
    containers: {
      total: 15,
      running: containerList.length,
      list: containerList,
    },
    database: {
      connected: Object.keys(dbStats).length > 0,
      stats: dbStats,
    },
    minio: {
      live: minioLive,
      ready: minioLive,
    },
    externalUrl,
    syncApi,
    jobs: {
      pending: stuckJobs.filter(j => j.status === 'pending').length,
      queued: stuckJobs.filter(j => j.status === 'queued').length,
      stuck: stuckJobs,
    },
  };
}

async function triggerSync(): Promise<{ success: boolean; message: string; count?: number }> {
  try {
    const result = await sshCommand("curl -s -X POST http://localhost:8095/sync/full -H 'Content-Type: application/json' -d '{}'");
    const parsed = JSON.parse(result);

    // Wait a moment and get the final status
    await new Promise(resolve => setTimeout(resolve, 3000));
    const statusResult = await sshCommand("curl -s http://localhost:8095/status");
    const status = JSON.parse(statusResult);

    return {
      success: parsed.success || false,
      message: parsed.message || 'Sync triggered',
      count: status.last_count || undefined,
    };
  } catch (error) {
    log.error('Sync trigger failed', { error });
    return { success: false, message: 'Failed to trigger sync' };
  }
}

async function clearStuckJobs(jobIds?: string[]): Promise<{ success: boolean; cleared: number }> {
  try {
    let whereClause = "status IN ('pending', 'queued')";
    if (jobIds && jobIds.length > 0) {
      const ids = jobIds.map(id => `'${id}'`).join(', ');
      whereClause = `id IN (${ids})`;
    }

    const result = await sshCommand(
      `docker exec qfieldcloud-db-1 psql -U qfieldcloud_db_admin -d qfieldcloud_db -t -c "UPDATE core_job SET status = 'failed', finished_at = NOW() WHERE ${whereClause} RETURNING id;"`
    );

    const cleared = result.split('\n').filter(Boolean).length;
    return { success: true, cleared };
  } catch (error) {
    log.error('Clear jobs failed', { error });
    return { success: false, cleared: 0 };
  }
}

async function restartService(service: 'qfield-sync' | 'cloudflared-qfield'): Promise<{ success: boolean; message: string }> {
  try {
    await sshCommand(`echo 'velo2026' | sudo -S systemctl restart ${service}.service`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    const status = await sshCommand(`echo 'velo2026' | sudo -S systemctl is-active ${service}.service`);
    return {
      success: status === 'active',
      message: status === 'active' ? `${service} restarted successfully` : `${service} failed to restart`,
    };
  } catch (error) {
    log.error('Service restart failed', { service, error });
    return { success: false, message: `Failed to restart ${service}` };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const health = await getHealthStatus();
      return apiResponse.success(res, health);
    }

    if (req.method === 'POST') {
      const { action, jobIds, service } = req.body;

      switch (action) {
        case 'sync':
          const syncResult = await triggerSync();
          return apiResponse.success(res, syncResult);

        case 'clear-jobs':
          const clearResult = await clearStuckJobs(jobIds);
          return apiResponse.success(res, clearResult);

        case 'restart-service':
          if (!service || !['qfield-sync', 'cloudflared-qfield'].includes(service)) {
            return apiResponse.badRequest(res, 'Invalid service name');
          }
          const restartResult = await restartService(service);
          return apiResponse.success(res, restartResult);

        default:
          return apiResponse.badRequest(res, 'Invalid action');
      }
    }

    return apiResponse.methodNotAllowed(res, ['GET', 'POST']);
  } catch (error) {
    log.error('QField API error', { error });
    return apiResponse.internalError(res, error);
  }
}
