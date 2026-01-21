/**
 * QField Dashboard Component
 * Monitors QFieldCloud infrastructure and provides management controls
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Play,
  Trash2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Server,
  Database,
  Cloud,
  HardDrive,
  Activity,
  Clock,
  Loader2,
  RotateCcw,
} from 'lucide-react';

interface HealthStatus {
  services: {
    qfieldSync: { status: string };
    cloudflared: { status: string };
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

const StatusBadge: React.FC<{ status: 'success' | 'error' | 'warning' | 'loading'; label: string }> = ({
  status,
  label,
}) => {
  const styles = {
    success: 'bg-green-500/20 text-green-400 border-green-500/30',
    error: 'bg-red-500/20 text-red-400 border-red-500/30',
    warning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    loading: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  };

  const icons = {
    success: <CheckCircle className="w-4 h-4" />,
    error: <XCircle className="w-4 h-4" />,
    warning: <AlertTriangle className="w-4 h-4" />,
    loading: <Loader2 className="w-4 h-4 animate-spin" />,
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${styles[status]}`}>
      {icons[status]}
      {label}
    </span>
  );
};

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string | number;
  status?: 'success' | 'error' | 'warning';
}> = ({ icon, label, value, status }) => {
  const borderColor = status === 'success' ? 'border-green-500/30' : status === 'error' ? 'border-red-500/30' : 'border-[var(--ff-border-light)]';

  return (
    <div className={`bg-[var(--ff-bg-secondary)] rounded-lg p-4 border ${borderColor}`}>
      <div className="flex items-center gap-3">
        <div className="p-2 bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-secondary)]">
          {icon}
        </div>
        <div>
          <p className="text-sm text-[var(--ff-text-tertiary)]">{label}</p>
          <p className="text-lg font-semibold text-[var(--ff-text-primary)]">{value}</p>
        </div>
      </div>
    </div>
  );
};

export const QFieldDashboard: React.FC = () => {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [restarting, setRestarting] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/system/qfield');
      if (!response.ok) throw new Error('Failed to fetch health status');
      const data = await response.json();
      setHealth(data.data);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const handleSync = async () => {
    try {
      setSyncing(true);
      setActionMessage(null);
      const response = await fetch('/api/system/qfield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      });
      const data = await response.json();
      if (data.data?.success) {
        setActionMessage({ type: 'success', text: `Sync completed: ${data.data.count || 0} records` });
        fetchHealth();
      } else {
        setActionMessage({ type: 'error', text: data.data?.message || 'Sync failed' });
      }
    } catch (err) {
      setActionMessage({ type: 'error', text: 'Failed to trigger sync' });
    } finally {
      setSyncing(false);
    }
  };

  const handleClearJobs = async () => {
    if (!health?.jobs.stuck.length) return;
    if (!confirm(`Clear ${health.jobs.stuck.length} stuck job(s)?`)) return;

    try {
      setClearing(true);
      setActionMessage(null);
      const response = await fetch('/api/system/qfield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear-jobs' }),
      });
      const data = await response.json();
      if (data.data?.success) {
        setActionMessage({ type: 'success', text: `Cleared ${data.data.cleared} job(s)` });
        fetchHealth();
      } else {
        setActionMessage({ type: 'error', text: 'Failed to clear jobs' });
      }
    } catch (err) {
      setActionMessage({ type: 'error', text: 'Failed to clear jobs' });
    } finally {
      setClearing(false);
    }
  };

  const handleRestartService = async (service: 'qfield-sync' | 'cloudflared-qfield') => {
    if (!confirm(`Restart ${service} service?`)) return;

    try {
      setRestarting(service);
      setActionMessage(null);
      const response = await fetch('/api/system/qfield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restart-service', service }),
      });
      const data = await response.json();
      if (data.data?.success) {
        setActionMessage({ type: 'success', text: data.data.message });
        fetchHealth();
      } else {
        setActionMessage({ type: 'error', text: data.data?.message || 'Restart failed' });
      }
    } catch (err) {
      setActionMessage({ type: 'error', text: `Failed to restart ${service}` });
    } finally {
      setRestarting(null);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString();
  };

  if (loading && !health) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--ff-text-tertiary)]" />
      </div>
    );
  }

  if (error && !health) {
    return (
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          <p className="font-medium">Failed to load QField status</p>
          <p className="text-sm mt-1">{error}</p>
          <button
            onClick={fetchHealth}
            className="mt-3 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-sm font-medium transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const allServicesHealthy =
    health?.services.qfieldSync.status === 'active' &&
    health?.services.cloudflared.status === 'active' &&
    health?.containers.running === health?.containers.total &&
    health?.database.connected &&
    health?.minio.live &&
    health?.externalUrl.reachable;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">QField Monitor</h1>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
            QFieldCloud infrastructure health and management
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-[var(--ff-text-tertiary)]">
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchHealth}
            disabled={loading}
            className="p-2 bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg border border-[var(--ff-border-light)] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Action Message */}
      {actionMessage && (
        <div
          className={`p-4 rounded-lg border ${
            actionMessage.type === 'success'
              ? 'bg-green-500/10 border-green-500/30 text-green-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          {actionMessage.text}
        </div>
      )}

      {/* Overall Status */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <StatusBadge
              status={allServicesHealthy ? 'success' : 'warning'}
              label={allServicesHealthy ? 'All Systems Operational' : 'Issues Detected'}
            />
            {health?.jobs.stuck && health.jobs.stuck.length > 0 && (
              <StatusBadge status="warning" label={`${health.jobs.stuck.length} Stuck Jobs`} />
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {syncing ? 'Syncing...' : 'Trigger Sync'}
            </button>
            {health?.jobs.stuck && health.jobs.stuck.length > 0 && (
              <button
                onClick={handleClearJobs}
                disabled={clearing}
                className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Clear Stuck Jobs
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<Server className="w-5 h-5" />}
          label="Containers"
          value={`${health?.containers.running || 0}/${health?.containers.total || 15}`}
          status={health?.containers.running === health?.containers.total ? 'success' : 'error'}
        />
        <StatCard
          icon={<Database className="w-5 h-5" />}
          label="OES Records"
          value={(health?.database.stats?.oes_activations || 0).toLocaleString()}
          status={health?.database.connected ? 'success' : 'error'}
        />
        <StatCard
          icon={<Cloud className="w-5 h-5" />}
          label="External URL"
          value={health?.externalUrl.latency || '-'}
          status={health?.externalUrl.reachable ? 'success' : 'error'}
        />
        <StatCard
          icon={<Activity className="w-5 h-5" />}
          label="Last Sync"
          value={health?.syncApi.lastCount?.toLocaleString() || '-'}
        />
      </div>

      {/* Services Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Systemd Services */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <div className="p-4 border-b border-[var(--ff-border-light)]">
            <h2 className="font-semibold text-[var(--ff-text-primary)]">Systemd Services</h2>
          </div>
          <div className="p-4 space-y-3">
            {[
              { name: 'qfield-sync', label: 'QField Sync', status: health?.services.qfieldSync.status },
              { name: 'cloudflared-qfield', label: 'Cloudflare Tunnel', status: health?.services.cloudflared.status },
            ].map((svc) => (
              <div key={svc.name} className="flex items-center justify-between p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
                <div className="flex items-center gap-3">
                  <StatusBadge
                    status={svc.status === 'active' ? 'success' : 'error'}
                    label={svc.status || 'unknown'}
                  />
                  <span className="text-[var(--ff-text-primary)]">{svc.label}</span>
                </div>
                <button
                  onClick={() => handleRestartService(svc.name as 'qfield-sync' | 'cloudflared-qfield')}
                  disabled={restarting === svc.name}
                  className="p-2 hover:bg-[var(--ff-bg-secondary)] rounded-lg transition-colors disabled:opacity-50"
                  title="Restart service"
                >
                  {restarting === svc.name ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RotateCcw className="w-4 h-4" />
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Sync Status */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <div className="p-4 border-b border-[var(--ff-border-light)]">
            <h2 className="font-semibold text-[var(--ff-text-primary)]">Sync Status</h2>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[var(--ff-text-tertiary)]">API Status</span>
              <StatusBadge status={health?.syncApi.healthy ? 'success' : 'error'} label={health?.syncApi.healthy ? 'Healthy' : 'Unhealthy'} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--ff-text-tertiary)]">Last Sync</span>
              <span className="text-[var(--ff-text-primary)]">{formatDate(health?.syncApi.lastSync || null)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--ff-text-tertiary)]">Records Synced</span>
              <span className="text-[var(--ff-text-primary)]">{health?.syncApi.lastCount?.toLocaleString() || '-'}</span>
            </div>
            {health?.syncApi.lastError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {health.syncApi.lastError}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Database Stats */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
        <div className="p-4 border-b border-[var(--ff-border-light)]">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-[var(--ff-text-tertiary)]" />
            <h2 className="font-semibold text-[var(--ff-text-primary)]">Database Statistics</h2>
            <StatusBadge status={health?.database.connected ? 'success' : 'error'} label={health?.database.connected ? 'Connected' : 'Disconnected'} />
          </div>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Object.entries(health?.database.stats || {}).map(([key, value]) => (
              <div key={key} className="text-center p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
                <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{value.toLocaleString()}</p>
                <p className="text-xs text-[var(--ff-text-tertiary)] capitalize">{key.replace(/_/g, ' ')}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Containers */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
        <div className="p-4 border-b border-[var(--ff-border-light)]">
          <div className="flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-[var(--ff-text-tertiary)]" />
            <h2 className="font-semibold text-[var(--ff-text-primary)]">Docker Containers</h2>
            <StatusBadge
              status={health?.containers.running === health?.containers.total ? 'success' : 'warning'}
              label={`${health?.containers.running || 0}/${health?.containers.total || 15} Running`}
            />
          </div>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {health?.containers.list.map((container) => (
              <div
                key={container.name}
                className="flex items-center gap-2 p-2 bg-[var(--ff-bg-tertiary)] rounded-lg text-sm"
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    container.status.toLowerCase().includes('up') ? 'bg-green-500' : 'bg-red-500'
                  }`}
                />
                <span className="text-[var(--ff-text-primary)] truncate">{container.name.replace('qfieldcloud-', '')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Stuck Jobs */}
      {health?.jobs.stuck && health.jobs.stuck.length > 0 && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-orange-500/30">
          <div className="p-4 border-b border-orange-500/30 bg-orange-500/10">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-400" />
              <h2 className="font-semibold text-orange-400">Stuck Jobs ({health.jobs.stuck.length})</h2>
            </div>
          </div>
          <div className="p-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--ff-text-tertiary)]">
                    <th className="pb-2">Job ID</th>
                    <th className="pb-2">Type</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Project</th>
                    <th className="pb-2">Created</th>
                  </tr>
                </thead>
                <tbody className="text-[var(--ff-text-primary)]">
                  {health.jobs.stuck.map((job) => (
                    <tr key={job.id} className="border-t border-[var(--ff-border-light)]">
                      <td className="py-2 font-mono text-xs">{job.id.slice(0, 8)}...</td>
                      <td className="py-2">{job.type}</td>
                      <td className="py-2">
                        <StatusBadge status="warning" label={job.status} />
                      </td>
                      <td className="py-2">{job.project}</td>
                      <td className="py-2">{formatDate(job.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* External Access */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
        <div className="p-4 border-b border-[var(--ff-border-light)]">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-[var(--ff-text-tertiary)]" />
            <h2 className="font-semibold text-[var(--ff-text-primary)]">External Access</h2>
          </div>
        </div>
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <StatusBadge
                status={health?.externalUrl.reachable ? 'success' : 'error'}
                label={health?.externalUrl.reachable ? 'Reachable' : 'Unreachable'}
              />
              <a
                href="https://qfield.fibreflow.app"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 transition-colors"
              >
                qfield.fibreflow.app
              </a>
            </div>
            <div className="flex items-center gap-4 text-sm text-[var(--ff-text-tertiary)]">
              <span>HTTP {health?.externalUrl.httpCode}</span>
              <span>{health?.externalUrl.latency}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
