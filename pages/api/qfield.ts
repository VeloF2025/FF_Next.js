/**
 * QField System API
 * Handles health checks, sync operations, and job management
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { exec } from 'child_process';
import { promisify } from 'util';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
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

// === NEW ADMIN PANEL FUNCTIONS ===

async function restartWorkers(): Promise<{ success: boolean; message: string; restarted: number }> {
  try {
    // Get list of worker containers
    const containerList = await sshCommand("docker ps --filter 'name=qfieldcloud-worker_wrapper' --format '{{.Names}}'");
    const workers = containerList.split('\n').filter(Boolean);

    if (workers.length === 0) {
      return { success: false, message: 'No worker containers found', restarted: 0 };
    }

    // Restart all workers
    const workerNames = workers.join(' ');
    await sshCommand(`docker restart ${workerNames}`);

    // Wait for containers to restart
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Verify they're running
    const runningCount = await sshCommand("docker ps --filter 'name=qfieldcloud-worker_wrapper' --format '{{.Names}}' | wc -l");
    const running = parseInt(runningCount.trim(), 10);

    log.info('Workers restarted', { requested: workers.length, running });

    return {
      success: running > 0,
      message: `Restarted ${running}/${workers.length} workers`,
      restarted: running,
    };
  } catch (error) {
    log.error('Worker restart failed', { error });
    return { success: false, message: 'Failed to restart workers', restarted: 0 };
  }
}

async function restartAppContainer(): Promise<{ success: boolean; message: string }> {
  try {
    await sshCommand('docker restart qfieldcloud-app-1');

    // Wait for container to restart
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Verify it's running
    const status = await sshCommand("docker ps --filter 'name=qfieldcloud-app-1' --format '{{.Status}}'");
    const isRunning = status.toLowerCase().includes('up');

    log.info('App container restarted', { status, isRunning });

    return {
      success: isRunning,
      message: isRunning ? 'App container restarted successfully' : 'App container failed to restart',
    };
  } catch (error) {
    log.error('App container restart failed', { error });
    return { success: false, message: 'Failed to restart app container' };
  }
}

interface JobDetails {
  id: string;
  type: string;
  status: string;
  project: string;
  projectId: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  output: string | null;
}

async function getJobById(jobId: string): Promise<{ success: boolean; job?: JobDetails; error?: string }> {
  try {
    // Sanitize jobId to prevent SQL injection (UUIDs only)
    if (!/^[a-f0-9-]+$/i.test(jobId)) {
      return { success: false, error: 'Invalid job ID format' };
    }

    const result = await sshCommand(`docker exec qfieldcloud-db-1 psql -U qfieldcloud_db_admin -d qfieldcloud_db -t -c "
      SELECT j.id, j.type, j.status, COALESCE(p.name, 'unknown'), COALESCE(p.id::text, ''),
             j.created_at, j.started_at, j.finished_at, LEFT(j.output, 500)
      FROM core_job j
      LEFT JOIN core_project p ON j.project_id = p.id
      WHERE j.id::text LIKE '${jobId}%'
      LIMIT 1
    "`);

    if (!result.trim()) {
      return { success: false, error: 'Job not found' };
    }

    const parts = result.trim().split('|').map(s => s.trim());
    if (parts.length < 9) {
      return { success: false, error: 'Invalid job data' };
    }

    return {
      success: true,
      job: {
        id: parts[0],
        type: parts[1],
        status: parts[2],
        project: parts[3],
        projectId: parts[4],
        createdAt: parts[5],
        startedAt: parts[6] || null,
        finishedAt: parts[7] || null,
        output: parts[8] || null,
      },
    };
  } catch (error) {
    log.error('Get job failed', { jobId, error });
    return { success: false, error: 'Failed to fetch job details' };
  }
}

interface ProjectDetails {
  id: string;
  name: string;
  owner: string;
  createdAt: string;
  jobCount: number;
  lastJobStatus: string | null;
  lastJobDate: string | null;
}

async function getProjectById(projectId: string): Promise<{ success: boolean; project?: ProjectDetails; error?: string }> {
  try {
    // Sanitize projectId to prevent SQL injection (UUIDs only)
    if (!/^[a-f0-9-]+$/i.test(projectId)) {
      return { success: false, error: 'Invalid project ID format' };
    }

    const result = await sshCommand(`docker exec qfieldcloud-db-1 psql -U qfieldcloud_db_admin -d qfieldcloud_db -t -c "
      SELECT p.id, p.name, COALESCE(u.username, 'unknown'), p.created_at,
             (SELECT COUNT(*) FROM core_job WHERE project_id = p.id),
             (SELECT status FROM core_job WHERE project_id = p.id ORDER BY created_at DESC LIMIT 1),
             (SELECT created_at FROM core_job WHERE project_id = p.id ORDER BY created_at DESC LIMIT 1)
      FROM core_project p
      LEFT JOIN core_user u ON p.owner_id = u.id
      WHERE p.id::text LIKE '${projectId}%'
      LIMIT 1
    "`);

    if (!result.trim()) {
      return { success: false, error: 'Project not found' };
    }

    const parts = result.trim().split('|').map(s => s.trim());
    if (parts.length < 7) {
      return { success: false, error: 'Invalid project data' };
    }

    return {
      success: true,
      project: {
        id: parts[0],
        name: parts[1],
        owner: parts[2],
        createdAt: parts[3],
        jobCount: parseInt(parts[4], 10) || 0,
        lastJobStatus: parts[5] || null,
        lastJobDate: parts[6] || null,
      },
    };
  } catch (error) {
    log.error('Get project failed', { projectId, error });
    return { success: false, error: 'Failed to fetch project details' };
  }
}

interface JobStats {
  total: number;
  success: number;
  failed: number;
  pending: number;
  queued: number;
  avgDurationSec: number | null;
  successRate: number;
}

async function getJobStats(): Promise<{ success: boolean; stats?: JobStats; error?: string }> {
  try {
    const result = await sshCommand(`docker exec qfieldcloud-db-1 psql -U qfieldcloud_db_admin -d qfieldcloud_db -t -c "
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'finished') as success,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'queued') as queued,
        ROUND(AVG(EXTRACT(EPOCH FROM (finished_at - created_at))) FILTER (WHERE finished_at IS NOT NULL)::numeric, 0) as avg_duration
      FROM core_job
      WHERE created_at > NOW() - INTERVAL '24 hours'
    "`);

    const parts = result.trim().split('|').map(s => s.trim());
    if (parts.length < 6) {
      return { success: false, error: 'Invalid stats data' };
    }

    const total = parseInt(parts[0], 10) || 0;
    const success = parseInt(parts[1], 10) || 0;
    const failed = parseInt(parts[2], 10) || 0;
    const pending = parseInt(parts[3], 10) || 0;
    const queued = parseInt(parts[4], 10) || 0;
    const avgDuration = parts[5] ? parseInt(parts[5], 10) : null;

    return {
      success: true,
      stats: {
        total,
        success,
        failed,
        pending,
        queued,
        avgDurationSec: avgDuration,
        successRate: total > 0 ? Math.round((success / total) * 100) : 0,
      },
    };
  } catch (error) {
    log.error('Get job stats failed', { error });
    return { success: false, error: 'Failed to fetch job stats' };
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const health = await getHealthStatus();
      return apiResponse.success(res, health);
    }

    if (req.method === 'POST') {
      const { action, jobIds, service, jobId, projectId } = req.body;

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

        // === NEW ADMIN PANEL ACTIONS ===

        case 'restart-workers':
          log.info('Restart workers requested');
          const workersResult = await restartWorkers();
          return apiResponse.success(res, workersResult);

        case 'restart-app':
          log.info('Restart app container requested');
          const appResult = await restartAppContainer();
          return apiResponse.success(res, appResult);

        case 'get-job':
          if (!jobId) {
            return apiResponse.badRequest(res, 'Job ID is required');
          }
          const jobResult = await getJobById(jobId);
          if (!jobResult.success) {
            return apiResponse.notFound(res, 'Job', jobId);
          }
          return apiResponse.success(res, jobResult);

        case 'get-project':
          if (!projectId) {
            return apiResponse.badRequest(res, 'Project ID is required');
          }
          const projectResult = await getProjectById(projectId);
          if (!projectResult.success) {
            return apiResponse.notFound(res, 'Project', projectId);
          }
          return apiResponse.success(res, projectResult);

        case 'job-stats':
          const statsResult = await getJobStats();
          return apiResponse.success(res, statsResult);

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

export default withAuth(sshCommand);
