import { NextApiRequest, NextApiResponse } from 'next'
import { execSync } from 'child_process'

interface ServiceHealth {
  name: string
  port: number
  url: string
  status: 'up' | 'down' | 'degraded'
  code: number | null
  latencyMs: number | null
  checkedAt: string
}

interface SystemdService {
  service: string
  active: string
  sub: string
}

interface DeployHealthResponse {
  services: ServiceHealth[]
  systemd: SystemdService[]
  logs: string[]
  github: { configured: false; message: string } | { configured: true; runs: unknown[] }
  generatedAt: string
}

const SERVICES = [
  { name: 'FibreFlow Prod', port: 3000, url: 'http://localhost:3000/api/health' },
  { name: 'FibreFlow Staging', port: 3006, url: 'http://localhost:3006/api/health' },
  { name: 'FibreFlow Dev', port: 3005, url: 'http://localhost:3005/api/health' },
  { name: 'GazTime API', port: 3333, url: 'http://localhost:3333/api/health' },
  { name: 'MC v1 API', port: 4000, url: 'http://localhost:4000/health' },
  { name: 'MC v2 API', port: 4001, url: 'http://localhost:4001/health' },
]

const SYSTEMD_SERVICES = ['fibreflow-production', 'fibreflow-staging', 'fibreflow-dev', 'gaztime-api', 'mc-v2-api']

async function checkService(service: { name: string; port: number; url: string }): Promise<ServiceHealth> {
  const start = Date.now()
  try {
    const response = await fetch(service.url, { signal: AbortSignal.timeout(3000) })
    const latencyMs = Date.now() - start
    return {
      name: service.name,
      port: service.port,
      url: service.url,
      status: response.ok ? 'up' : 'degraded',
      code: response.status,
      latencyMs,
      checkedAt: new Date().toISOString(),
    }
  } catch {
    return {
      name: service.name,
      port: service.port,
      url: service.url,
      status: 'down',
      code: null,
      latencyMs: null,
      checkedAt: new Date().toISOString(),
    }
  }
}

function getSystemdStatus(service: string): SystemdService {
  try {
    const active = execSync(`systemctl is-active ${service} 2>/dev/null`, { timeout: 2000 }).toString().trim()
    const sub = execSync(`systemctl show -p SubState --value ${service} 2>/dev/null`, { timeout: 2000 }).toString().trim()
    return { service, active, sub }
  } catch {
    return { service, active: 'unknown', sub: 'unknown' }
  }
}

function getRecentLogs(): string[] {
  try {
    const logs = execSync(
      'journalctl -u fibreflow-production --no-pager -n 20 --output=short-monotonic 2>/dev/null',
      { timeout: 3000, encoding: 'utf-8' }
    )
    return logs.trim().split('\n').filter((l) => l)
  } catch {
    return ['(Unable to fetch logs)']
  }
}

async function getGitHubStatus() {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    return { configured: false, message: 'No GITHUB_TOKEN configured' }
  }
  try {
    const res = await fetch(
      'https://api.github.com/repos/VelocityFibre/FibreFlow-Firebase/actions/runs?per_page=5',
      { headers: { Authorization: `token ${token}` }, signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) return { configured: false, message: 'GitHub API error' }
    const data = (await res.json()) as { workflow_runs?: unknown[] }
    return { configured: true, runs: data.workflow_runs || [] }
  } catch {
    return { configured: false, message: 'GitHub API unreachable' }
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<DeployHealthResponse | { error: string }>) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const [services, systemd, logs, github] = await Promise.all([
      Promise.all(SERVICES.map(checkService)),
      Promise.all(SYSTEMD_SERVICES.map(getSystemdStatus)),
      Promise.resolve(getRecentLogs()),
      getGitHubStatus(),
    ])

    return res.status(200).json({
      services,
      systemd,
      logs,
      github: github as never,
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' })
  }
}
