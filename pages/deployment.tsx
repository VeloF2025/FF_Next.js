/**
 * Deployment Health Dashboard
 * Live view of service health, CI/CD status, and error log tail.
 * Auto-refreshes every 30 seconds.
 */

import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  Wifi, WifiOff, GitCommit, Clock, Zap, Terminal,
  Activity, Github, Server, ExternalLink,
} from 'lucide-react';
import type { DeploymentHealthData, ServiceHealth, GithubRun, ServiceErrorCount } from './api/deployment-health';

const REFRESH_INTERVAL = 30_000; // 30 seconds

// ─── Status Helpers ───────────────────────────────────────────────────────────

function statusColor(status: ServiceHealth['status']) {
  switch (status) {
    case 'healthy':    return 'text-green-500';
    case 'degraded':   return 'text-yellow-500';
    case 'unreachable':return 'text-red-500';
    case 'error':      return 'text-red-500';
    default:           return 'text-[var(--ff-text-tertiary)]';
  }
}

function statusBg(status: ServiceHealth['status']) {
  switch (status) {
    case 'healthy':    return 'bg-green-500/10 border-green-500/20';
    case 'degraded':   return 'bg-yellow-500/10 border-yellow-500/20';
    case 'unreachable':return 'bg-red-500/10 border-red-500/20';
    case 'error':      return 'bg-red-500/10 border-red-500/20';
    default:           return 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]';
  }
}

function conclusionColor(conclusion: GithubRun['conclusion']) {
  switch (conclusion) {
    case 'success':   return 'text-green-500';
    case 'failure':   return 'text-red-500';
    case 'cancelled': return 'text-yellow-500';
    case 'skipped':   return 'text-[var(--ff-text-tertiary)]';
    default:          return 'text-blue-500';
  }
}

function conclusionBg(conclusion: GithubRun['conclusion'], status: GithubRun['status']) {
  if (status === 'in_progress' || status === 'queued') return 'bg-blue-500/10 border-blue-500/20';
  switch (conclusion) {
    case 'success':   return 'bg-green-500/10 border-green-500/20';
    case 'failure':   return 'bg-red-500/10 border-red-500/20';
    case 'cancelled': return 'bg-yellow-500/10 border-yellow-500/20';
    default:          return 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]';
  }
}

function fmtUptime(seconds?: number): string {
  if (!seconds) return '–';
  const h = Math.floor(seconds / 3600);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return 'just now';
}

// ─── Service Health Card ──────────────────────────────────────────────────────

function ServiceCard({ svc }: { svc: ServiceHealth }) {
  const Icon = svc.status === 'healthy' ? CheckCircle2 :
               svc.status === 'degraded' ? AlertTriangle :
               svc.status === 'unreachable' ? WifiOff : XCircle;

  return (
    <div className={`rounded-lg border p-4 ${statusBg(svc.status)}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-semibold text-sm text-[var(--ff-text-primary)]">{svc.name}</p>
          <a
            href={svc.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[var(--ff-text-tertiary)] hover:underline flex items-center gap-1 mt-0.5"
          >
            {svc.url.replace('https://', '').replace('http://', '')}
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <Icon className={`w-5 h-5 mt-0.5 ${statusColor(svc.status)}`} />
      </div>

      <div className="space-y-1.5 text-xs">
        {/* HTTP + latency */}
        <div className="flex items-center justify-between">
          <span className="text-[var(--ff-text-tertiary)]">HTTP</span>
          <span className={`font-mono font-medium ${svc.httpCode === 200 ? 'text-green-500' : 'text-red-500'}`}>
            {svc.httpCode ?? '–'}
          </span>
        </div>
        {svc.responseTimeMs != null && (
          <div className="flex items-center justify-between">
            <span className="text-[var(--ff-text-tertiary)]">Latency</span>
            <span className={`font-mono font-medium ${svc.responseTimeMs < 500 ? 'text-green-500' : svc.responseTimeMs < 2000 ? 'text-yellow-500' : 'text-red-500'}`}>
              {svc.responseTimeMs}ms
            </span>
          </div>
        )}
        {/* Commit */}
        {svc.commitShort && (
          <div className="flex items-center justify-between">
            <span className="text-[var(--ff-text-tertiary)]">Commit</span>
            <span className="font-mono text-[var(--ff-text-secondary)]">{svc.commitShort}</span>
          </div>
        )}
        {/* Uptime */}
        {svc.uptime != null && (
          <div className="flex items-center justify-between">
            <span className="text-[var(--ff-text-tertiary)]">Uptime</span>
            <span className="text-[var(--ff-text-secondary)]">{fmtUptime(svc.uptime)}</span>
          </div>
        )}
        {/* DB status */}
        {svc.dbStatus && (
          <div className="flex items-center justify-between">
            <span className="text-[var(--ff-text-tertiary)]">DB</span>
            <span className={svc.dbStatus === 'connected' ? 'text-green-500' : 'text-red-500'}>
              {svc.dbStatus}
            </span>
          </div>
        )}
        {/* Error */}
        {svc.error && (
          <p className="text-red-400 truncate pt-1">{svc.error}</p>
        )}
      </div>
    </div>
  );
}

// ─── GitHub Run Row ───────────────────────────────────────────────────────────

function RunRow({ run }: { run: GithubRun }) {
  const isLive = run.status === 'in_progress' || run.status === 'queued';
  const Icon = isLive ? Activity :
               run.conclusion === 'success' ? CheckCircle2 :
               run.conclusion === 'failure' ? XCircle :
               run.conclusion === 'cancelled' ? AlertTriangle : Clock;

  return (
    <a
      href={run.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-3 p-3 rounded-lg border text-xs hover:opacity-80 transition-opacity ${conclusionBg(run.conclusion, run.status)}`}
    >
      <Icon className={`w-4 h-4 shrink-0 ${isLive ? 'text-blue-500 animate-pulse' : conclusionColor(run.conclusion)}`} />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-[var(--ff-text-primary)] truncate">{run.name}</p>
        {run.commitMessage && (
          <p className="text-[var(--ff-text-tertiary)] truncate mt-0.5">{run.commitMessage}</p>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className={`font-medium capitalize ${isLive ? 'text-blue-500' : conclusionColor(run.conclusion)}`}>
          {isLive ? run.status.replace('_', ' ') : (run.conclusion ?? run.status)}
        </p>
        <p className="text-[var(--ff-text-tertiary)] mt-0.5">{fmtAge(run.createdAt)}</p>
      </div>
    </a>
  );
}

// ─── Error Log ────────────────────────────────────────────────────────────────

const SVC_LABELS: Record<string, string> = {
  'fibreflow': 'Prod',
  'fibreflow-staging': 'Staging',
  'fibreflow-dev': 'Dev',
};

function ErrorLogPanel({ errorLog }: { errorLog: DeploymentHealthData['errorLog'] }) {
  const hasErrors = (errorLog.count5min ?? 0) > 0;

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--ff-border-light)]">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <h3 className="font-semibold text-sm text-[var(--ff-text-primary)]">Error Log Tail</h3>
          <span className="text-xs text-[var(--ff-text-tertiary)]">(prod)</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className={`flex items-center gap-1 ${hasErrors ? 'text-red-500' : 'text-green-500'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${hasErrors ? 'bg-red-500' : 'bg-green-500'}`} />
            {errorLog.count5min ?? '?'} errors (5m)
          </span>
          <span className="text-[var(--ff-text-tertiary)]">
            {errorLog.count1hour ?? '?'} (1h)
          </span>
        </div>
      </div>

      {/* Per-service breakdown */}
      {errorLog.byService.length > 0 && (
        <div className="flex gap-3 px-4 py-2 border-b border-[var(--ff-border-light)] text-xs">
          {errorLog.byService.map(s => {
            const label = SVC_LABELS[s.service] ?? s.service;
            const hot = (s.count5min ?? 0) > 0;
            return (
              <div key={s.service} className={`flex items-center gap-1.5 ${hot ? 'text-red-500' : 'text-[var(--ff-text-tertiary)]'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${hot ? 'bg-red-500' : 'bg-green-500/60'}`} />
                <span className="font-medium">{label}</span>
                <span>{s.count5min ?? '?'}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-gray-950 font-mono text-xs text-green-400 p-4 min-h-[160px] max-h-[260px] overflow-y-auto">
        {errorLog.error ? (
          <p className="text-yellow-400"># {errorLog.error}</p>
        ) : errorLog.recentLines.length === 0 ? (
          <p className="text-gray-500"># No recent errors — all clear ✓</p>
        ) : (
          errorLog.recentLines.map((line, i) => (
            <p key={i} className="text-red-400 leading-relaxed break-all">{line}</p>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DeploymentPage() {
  const [data, setData] = useState<DeploymentHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL / 1000);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch('/api/deployment-health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: DeploymentHealthData = await res.json();
      setData(json);
      setLastRefresh(new Date());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setCountdown(REFRESH_INTERVAL / 1000);
    }
  }, []);

  // Initial load + auto-refresh
  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(), REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Countdown ticker
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown(c => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const healthyCount = data?.services.filter(s => s.status === 'healthy').length ?? 0;
  const totalCount = data?.services.length ?? 0;
  const ciFailures = data?.github.runs.filter(r => r.conclusion === 'failure').length ?? 0;

  return (
    <>
      <Head><title>Deployment Health — FibreFlow</title></Head>
      <AppLayout>
        <div className="space-y-6">

          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
                Deployment Health
              </h1>
              <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
                Live service status, CI/CD runs, and error log — auto-refreshes every 30s
              </p>
            </div>
            <div className="flex items-center gap-3">
              {lastRefresh && (
                <span className="text-xs text-[var(--ff-text-tertiary)]">
                  Next refresh in {countdown}s
                </span>
              )}
              <button
                onClick={() => fetchData(true)}
                disabled={refreshing}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {/* Summary bar */}
          {data && (
            <div className="flex flex-wrap gap-3">
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium ${
                healthyCount === totalCount ? 'bg-green-500/10 border-green-500/20 text-green-600' : 'bg-red-500/10 border-red-500/20 text-red-600'
              }`}>
                {healthyCount === totalCount ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                {healthyCount}/{totalCount} services healthy
              </div>
              {ciFailures > 0 && (
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium bg-red-500/10 border-red-500/20 text-red-600">
                  <XCircle className="w-4 h-4" />
                  {ciFailures} CI failure{ciFailures > 1 ? 's' : ''}
                </div>
              )}
              {(data.errorLog.count5min ?? 0) > 0 && (
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium bg-yellow-500/10 border-yellow-500/20 text-yellow-600">
                  <AlertTriangle className="w-4 h-4" />
                  {data.errorLog.count5min} errors in last 5m
                </div>
              )}
              {healthyCount === totalCount && ciFailures === 0 && (data.errorLog.count5min ?? 0) === 0 && (
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium bg-green-500/10 border-green-500/20 text-green-600">
                  <Zap className="w-4 h-4" />
                  All systems nominal
                </div>
              )}
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm text-[var(--ff-text-tertiary)] bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] ml-auto">
                <Clock className="w-4 h-4" />
                {lastRefresh?.toLocaleTimeString('en-ZA')}
              </div>
            </div>
          )}

          {/* Error state */}
          {error && !loading && (
            <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-600">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              Failed to fetch deployment health: {error}
            </div>
          )}

          {/* Loading skeleton */}
          {loading && !data && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-4 h-40 animate-pulse" />
              ))}
            </div>
          )}

          {data && (
            <>
              {/* Service Health Cards */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Server className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                  <h2 className="font-semibold text-[var(--ff-text-primary)]">Services</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {data.services.map(svc => (
                    <ServiceCard key={svc.name} svc={svc} />
                  ))}
                </div>
              </section>

              {/* GitHub Actions + Error Log */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* GitHub Actions Widget */}
                <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--ff-border-light)]">
                    <div className="flex items-center gap-2">
                      <Github className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                      <h3 className="font-semibold text-sm text-[var(--ff-text-primary)]">
                        GitHub Actions
                      </h3>
                      <span className="text-xs text-[var(--ff-text-tertiary)]">master</span>
                    </div>
                    <a
                      href="https://github.com/VelocityFibre/FF_Next.js/actions"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)] flex items-center gap-1"
                    >
                      View all <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div className="p-3 space-y-2">
                    {data.github.error ? (
                      <p className="text-sm text-[var(--ff-text-tertiary)] px-2 py-4 text-center">
                        {data.github.error}
                      </p>
                    ) : data.github.runs.length === 0 ? (
                      <p className="text-sm text-[var(--ff-text-tertiary)] px-2 py-4 text-center">
                        No recent runs
                      </p>
                    ) : (
                      data.github.runs.map(run => (
                        <RunRow key={run.id} run={run} />
                      ))
                    )}
                  </div>
                </div>

                {/* Error Log */}
                <ErrorLogPanel errorLog={data.errorLog} />
              </div>

              {/* Commit Matrix — show all services' current commits */}
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
                <div className="flex items-center gap-2 mb-4">
                  <GitCommit className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                  <h3 className="font-semibold text-sm text-[var(--ff-text-primary)]">Deployed Commits</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {data.services.map(svc => (
                    <div key={svc.name} className="text-xs">
                      <p className="text-[var(--ff-text-tertiary)] mb-1">{svc.name}</p>
                      {svc.commitShort ? (
                        <a
                          href={`https://github.com/VelocityFibre/FF_Next.js/commit/${svc.commit}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[var(--ff-text-secondary)] hover:underline"
                        >
                          {svc.commitShort}
                        </a>
                      ) : (
                        <span className="text-[var(--ff-text-tertiary)] font-mono">
                          {svc.status === 'unreachable' ? 'unreachable' : '–'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {/* Drift detection */}
                {(() => {
                  const commits = data.services.map(s => s.commitShort).filter(Boolean);
                  const unique = new Set(commits);
                  if (unique.size > 1 && commits.length > 1) {
                    return (
                      <div className="mt-3 flex items-center gap-2 text-xs text-yellow-600 bg-yellow-500/10 border border-yellow-500/20 rounded px-3 py-2">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        Commit drift detected — services are running different versions
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            </>
          )}

        </div>
      </AppLayout>
    </>
  );
}
