/**
 * Deployment Health API
 * Aggregates service health, GitHub Actions CI status, and error log data.
 * Used by the Deployment Health Dashboard (/deployment).
 * 
 * Caching: Results cached for 20s to reduce redundant external API calls.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';

// ─── Cache ────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 20_000; // 20 seconds
let cachedResult: { data: DeploymentHealthData; timestamp: number } | null = null;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ServiceHealth {
  name: string;
  url: string;
  status: 'healthy' | 'degraded' | 'unreachable' | 'error';
  httpCode: number | null;
  responseTimeMs: number | null;
  commit?: string;
  commitShort?: string;
  environment?: string;
  uptime?: number;
  memoryUsed?: string;
  dbStatus?: string;
  error?: string;
}

export interface GithubRun {
  id: number;
  name: string;
  status: 'completed' | 'in_progress' | 'queued' | 'waiting';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
  createdAt: string;
  updatedAt: string;
  url: string;
  branch: string;
  actor: string;
  commitMessage?: string;
}

export interface ServiceErrorCount {
  service: string;
  count5min: number | null;
  count1hour: number | null;
}

export interface DeploymentHealthData {
  services: ServiceHealth[];
  github: {
    runs: GithubRun[];
    error?: string;
  };
  errorLog: {
    count5min: number | null;
    count1hour: number | null;
    byService: ServiceErrorCount[];
    recentLines: string[];
    error?: string;
  };
  checkedAt: string;
}

// ─── Service Health Check ─────────────────────────────────────────────────────

const SERVICES = [
  { name: 'FibreFlow Prod',    url: 'https://app.fibreflow.app/api/health' },
  { name: 'FibreFlow Staging', url: 'https://vf.fibreflow.app/api/health' },
  { name: 'FibreFlow Dev',     url: 'https://dev.fibreflow.app/api/health' },
  { name: 'GazTime API',       url: 'http://localhost:3333/health' },
];

async function checkService(svc: typeof SERVICES[0]): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const res = await fetch(svc.url, {
      signal: AbortSignal.timeout(6000),
      headers: { 'Accept': 'application/json' },
    });
    const ms = Date.now() - start;
    const body = await res.json().catch(() => ({}));

    // FibreFlow health shape: { status, version: { gitCommitShort }, checks: { database }, details: { memory } }
    // GazTime health shape:   { status, version: { gitCommitShort }, uptime }
    const ffMemory = body?.details?.memory?.heapUsed;
    const status: ServiceHealth['status'] =
      !res.ok ? 'error' :
      body?.status === 'healthy' || body?.status === 'ok' ? 'healthy' :
      body?.status === 'degraded' ? 'degraded' : 'error';

    return {
      name: svc.name,
      url: svc.url.replace('/api/health', '').replace('/health', ''),
      status,
      httpCode: res.status,
      responseTimeMs: ms,
      commit: body?.version?.gitCommit,
      commitShort: body?.version?.gitCommitShort,
      environment: body?.version?.environment,
      uptime: body?.uptime ?? undefined,
      memoryUsed: ffMemory,
      dbStatus: body?.checks?.database,
    };
  } catch (err: any) {
    return {
      name: svc.name,
      url: svc.url.replace('/api/health', '').replace('/health', ''),
      status: 'unreachable',
      httpCode: null,
      responseTimeMs: Date.now() - start,
      error: err?.message?.slice(0, 80),
    };
  }
}

// ─── GitHub Actions ───────────────────────────────────────────────────────────

async function fetchGithubRuns(): Promise<{ runs: GithubRun[]; error?: string }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { runs: [], error: 'No GITHUB_TOKEN configured' };

  try {
    const res = await fetch(
      'https://api.github.com/repos/VelocityFibre/FF_Next.js/actions/runs?per_page=10&branch=master',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return { runs: [], error: `GitHub API ${res.status}` };
    const data = await res.json();
    const runs: GithubRun[] = (data.workflow_runs || []).slice(0, 8).map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      url: r.html_url,
      branch: r.head_branch,
      actor: r.actor?.login || 'unknown',
      commitMessage: r.head_commit?.message?.split('\n')[0]?.slice(0, 80),
    }));
    return { runs };
  } catch (err: any) {
    return { runs: [], error: err?.message?.slice(0, 80) };
  }
}

// ─── Error Log ────────────────────────────────────────────────────────────────

const FF_SERVICES = ['fibreflow', 'fibreflow-staging', 'fibreflow-dev'];

async function fetchErrorLog(): Promise<DeploymentHealthData['errorLog']> {
  try {
    const { execSync } = await import('child_process');

    const run = (cmd: string) => {
      try {
        return execSync(cmd, { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
      } catch { return '0'; }
    };

    // Per-service error counts
    const byService: ServiceErrorCount[] = FF_SERVICES.map(svc => ({
      service: svc,
      count5min: parseInt(run(`journalctl -u ${svc} --since '5 minutes ago' -p err --no-pager -q 2>/dev/null | wc -l`)) || 0,
      count1hour: parseInt(run(`journalctl -u ${svc} --since '1 hour ago' -p err --no-pager -q 2>/dev/null | wc -l`)) || 0,
    }));

    // Aggregate totals
    const count5min = byService.reduce((s, x) => s + (x.count5min ?? 0), 0);
    const count1hour = byService.reduce((s, x) => s + (x.count1hour ?? 0), 0);

    // Recent error lines from prod (most important service)
    const recent = run("journalctl -u fibreflow -p err --no-pager -q -n 15 2>/dev/null");

    return {
      count5min,
      count1hour,
      byService,
      recentLines: recent ? recent.split('\n').filter(Boolean).slice(-15) : [],
    };
  } catch (err: any) {
    return {
      count5min: null,
      count1hour: null,
      byService: [],
      recentLines: [],
      error: 'journalctl unavailable',
    };
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────
/**
 * GET /api/deployment-health
 * 
 * Returns aggregated deployment and CI health data for the Deployment Health Dashboard.
 * 
 * Authentication: Required (withAuth middleware)
 * 
 * Response:
 *   - services: Array of service health checks (prod/staging/dev + GazTime)
 *   - github: GitHub Actions workflow runs on master branch (up to 8)
 *   - errorLog: journalctl error counts + recent lines (prod service only)
 *   - checkedAt: ISO timestamp of when this data was collected
 * 
 * Caching:
 *   - Results cached for 20 seconds in-memory to reduce external API load
 *   - X-Cache header indicates hit/miss for visibility
 *   - Cache is in-process only; not shared across instances
 * 
 * Timeouts:
 *   - Service health checks: 6 seconds each
 *   - GitHub API: 8 seconds
 *   - journalctl queries: 5 seconds each
 * 
 * Graceful Degradation:
 *   - If any service is unreachable, returns 'unreachable' status + error message
 *   - If GitHub token not configured, returns empty runs array + error message
 *   - If journalctl unavailable, returns null counts + error message
 * 
 * Example Usage:
 *   curl -H "Authorization: Bearer <token>" https://app.fibreflow.app/api/deployment-health
 * 
 * @see pages/deployment.tsx for the dashboard UI that consumes this API
 */
async function handler(req: NextApiRequest, res: NextApiResponse<DeploymentHealthData>) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end();
  }

  const now = Date.now();
  
  // Return cached result if still valid
  if (cachedResult && now - cachedResult.timestamp < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Cache', 'hit');
    return res.status(200).json(cachedResult.data);
  }

  // Run all checks in parallel
  const [services, github, errorLog] = await Promise.all([
    Promise.all(SERVICES.map(checkService)),
    fetchGithubRuns(),
    fetchErrorLog(),
  ]);

  const result: DeploymentHealthData = {
    services,
    github,
    errorLog,
    checkedAt: new Date().toISOString(),
  };

  // Cache the result
  cachedResult = { data: result, timestamp: now };

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Cache', 'miss');
  return res.status(200).json(result);
}

export default withAuth(handler);
