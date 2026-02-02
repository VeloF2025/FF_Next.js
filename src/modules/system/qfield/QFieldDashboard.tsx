/**
 * QField Dashboard Component
 * Monitors QFieldCloud infrastructure and provides management controls
 * Includes Server Controls tab for admin operations
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
  Search,
  Settings,
  ArrowDownUp,
} from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';
import { QFieldSyncDashboard } from '@/modules/qfield-sync/components/QFieldSyncDashboard';
import { log } from '@/lib/logger';

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

interface JobStats {
  total: number;
  success: number;
  failed: number;
  pending: number;
  queued: number;
  avgDurationSec: number | null;
  successRate: number;
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

interface ProjectDetails {
  id: string;
  name: string;
  owner: string;
  createdAt: string;
  jobCount: number;
  lastJobStatus: string | null;
  lastJobDate: string | null;
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
  // Tab state
  const [activeTab, setActiveTab] = useState<'monitor' | 'server-controls' | 'sync'>('monitor');

  // Monitor tab state
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [restarting, setRestarting] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Server Controls tab state
  const [jobStats, setJobStats] = useState<JobStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [jobLookupId, setJobLookupId] = useState('');
  const [projectLookupId, setProjectLookupId] = useState('');
  const [jobDetails, setJobDetails] = useState<JobDetails | null>(null);
  const [projectDetails, setProjectDetails] = useState<ProjectDetails | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/qfield');
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
      const response = await fetch('/api/qfield', {
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
      const response = await fetch('/api/qfield', {
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
      const response = await fetch('/api/qfield', {
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

  // === SERVER CONTROLS FUNCTIONS ===

  const loadJobStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const res = await fetch('/api/qfield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'job-stats' }),
      });
      const data = await res.json();
      if (data.data?.stats) {
        setJobStats(data.data.stats);
      }
    } catch (err) {
      log.error('Failed to load job stats', { error: err }, 'QFieldDashboard');
    } finally {
      setLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'server-controls') {
      loadJobStats();
    }
  }, [activeTab, loadJobStats]);

  const handleRestartWorkers = async () => {
    if (!confirm('Restart all QFieldCloud workers?\n\nThis will briefly interrupt job processing (10-30 seconds).')) {
      return;
    }

    setActionInProgress('restart-workers');
    try {
      const res = await fetch('/api/qfield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restart-workers' }),
      });
      const data = await res.json();

      if (data.data?.success) {
        notificationService.success(data.data.message);
        fetchHealth();
      } else {
        notificationService.error(data.data?.message || 'Failed to restart workers');
      }
    } catch (err) {
      notificationService.error('Failed to restart workers');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRestartApp = async () => {
    if (!confirm('Restart the QFieldCloud app container?\n\nThis will cause 1-2 minutes of downtime.')) {
      return;
    }

    setActionInProgress('restart-app');
    try {
      const res = await fetch('/api/qfield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restart-app' }),
      });
      const data = await res.json();

      if (data.data?.success) {
        notificationService.success(data.data.message);
        fetchHealth();
      } else {
        notificationService.error(data.data?.message || 'Failed to restart app');
      }
    } catch (err) {
      notificationService.error('Failed to restart app container');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleJobLookup = async () => {
    if (!jobLookupId.trim()) {
      setLookupError('Please enter a Job ID');
      return;
    }

    setLookupError(null);
    setJobDetails(null);

    try {
      const res = await fetch('/api/qfield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-job', jobId: jobLookupId.trim() }),
      });
      const data = await res.json();

      if (data.data?.success && data.data.job) {
        setJobDetails(data.data.job);
      } else {
        setLookupError(data.data?.error || 'Job not found');
      }
    } catch (err) {
      setLookupError('Failed to lookup job');
    }
  };

  const handleProjectLookup = async () => {
    if (!projectLookupId.trim()) {
      setLookupError('Please enter a Project ID');
      return;
    }

    setLookupError(null);
    setProjectDetails(null);

    try {
      const res = await fetch('/api/qfield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-project', projectId: projectLookupId.trim() }),
      });
      const data = await res.json();

      if (data.data?.success && data.data.project) {
        setProjectDetails(data.data.project);
      } else {
        setLookupError(data.data?.error || 'Project not found');
      }
    } catch (err) {
      setLookupError('Failed to lookup project');
    }
  };

  const formatDuration = (seconds: number | null): string => {
    if (seconds === null) return '-';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const formatTimeAgo = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
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

      {/* Tab Navigation */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('monitor')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition ${
            activeTab === 'monitor'
              ? 'bg-blue-600 text-white'
              : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)]'
          }`}
        >
          <Activity className="w-4 h-4" />
          Monitor
        </button>
        <button
          onClick={() => setActiveTab('server-controls')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition ${
            activeTab === 'server-controls'
              ? 'bg-blue-600 text-white'
              : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)]'
          }`}
        >
          <Server className="w-4 h-4" />
          Server Controls
        </button>
        <button
          onClick={() => setActiveTab('sync')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition ${
            activeTab === 'sync'
              ? 'bg-blue-600 text-white'
              : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)]'
          }`}
        >
          <ArrowDownUp className="w-4 h-4" />
          Sync
        </button>
      </div>

      {/* Monitor Tab */}
      {activeTab === 'monitor' && (
      <>
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
      </>
      )}

      {/* Server Controls Tab */}
      {activeTab === 'server-controls' && (
        <div className="space-y-6">
          {/* Top Row - Status, Controls, Lookup */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Service Status Card */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
                  <Search className="w-5 h-5" />
                  Service Status
                </h2>
                <button
                  onClick={fetchHealth}
                  disabled={loading}
                  className="text-sm text-blue-500 hover:text-blue-400 disabled:opacity-50 flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>

              {loading && !health ? (
                <p className="text-[var(--ff-text-secondary)]">Loading...</p>
              ) : health ? (
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[var(--ff-text-secondary)]">Workers</span>
                    <span className={`text-sm font-medium ${
                      health.containers.list.filter(c => c.name.includes('worker')).length >= 8 ? 'text-green-500' : 'text-yellow-500'
                    }`}>
                      {health.containers.list.filter(c => c.name.includes('worker')).length}/8
                      {health.containers.list.filter(c => c.name.includes('worker')).length >= 8 ? ' ✅' : ' ⚠️'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[var(--ff-text-secondary)]">App Container</span>
                    <span className={`text-sm font-medium ${
                      health.containers.list.some(c => c.name.includes('app') && c.status.includes('Up'))
                        ? 'text-green-500' : 'text-red-500'
                    }`}>
                      {health.containers.list.some(c => c.name.includes('app') && c.status.includes('Up'))
                        ? 'Running ✅' : 'Down ❌'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[var(--ff-text-secondary)]">Database</span>
                    <span className={`text-sm font-medium ${
                      health.database.connected ? 'text-green-500' : 'text-red-500'
                    }`}>
                      {health.database.connected ? 'Connected ✅' : 'Disconnected ❌'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[var(--ff-text-secondary)]">MinIO Storage</span>
                    <span className={`text-sm font-medium ${
                      health.minio.live ? 'text-green-500' : 'text-red-500'
                    }`}>
                      {health.minio.live ? 'Live ✅' : 'Down ❌'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[var(--ff-text-secondary)]">Stuck Jobs</span>
                    <span className={`text-sm font-medium ${
                      (health.jobs.pending + health.jobs.queued) === 0
                        ? 'text-green-500' : 'text-yellow-500'
                    }`}>
                      {health.jobs.pending + health.jobs.queued}
                      {(health.jobs.pending + health.jobs.queued) === 0 ? ' ✅' : ' ⚠️'}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-[var(--ff-text-tertiary)]">Click refresh to load status</p>
              )}
            </div>

            {/* Worker Controls Card */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
              <h2 className="font-semibold mb-4 text-[var(--ff-text-primary)] flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Worker Controls
              </h2>

              <div className="space-y-3">
                <button
                  onClick={handleRestartWorkers}
                  disabled={actionInProgress !== null}
                  className="w-full bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                >
                  {actionInProgress === 'restart-workers' ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Restarting...</>
                  ) : (
                    <><RefreshCw className="w-4 h-4" /> Restart Workers</>
                  )}
                </button>

                <button
                  onClick={handleClearJobs}
                  disabled={clearing || !health?.jobs.stuck.length}
                  className="w-full bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                >
                  {clearing ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Clearing...</>
                  ) : (
                    <><Trash2 className="w-4 h-4" /> Clear Stuck Jobs</>
                  )}
                </button>

                <button
                  onClick={handleRestartApp}
                  disabled={actionInProgress !== null}
                  className="w-full bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                >
                  {actionInProgress === 'restart-app' ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Restarting...</>
                  ) : (
                    <>🔴 Restart App Container</>
                  )}
                </button>
              </div>

              <p className="text-xs text-[var(--ff-text-tertiary)] mt-4">
                ⚠️ All actions require confirmation
              </p>
            </div>

            {/* Lookup Card */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
              <h2 className="font-semibold mb-4 text-[var(--ff-text-primary)] flex items-center gap-2">
                <Search className="w-5 h-5" />
                Lookup
              </h2>

              <div className="space-y-4">
                {/* Job Lookup */}
                <div>
                  <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">Job ID</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={jobLookupId}
                      onChange={(e) => setJobLookupId(e.target.value)}
                      placeholder="Enter job ID..."
                      className="flex-1 p-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded text-sm"
                    />
                    <button
                      onClick={handleJobLookup}
                      className="px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                    >
                      Find
                    </button>
                  </div>
                </div>

                {/* Project Lookup */}
                <div>
                  <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">Project ID</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={projectLookupId}
                      onChange={(e) => setProjectLookupId(e.target.value)}
                      placeholder="Enter project ID..."
                      className="flex-1 p-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded text-sm"
                    />
                    <button
                      onClick={handleProjectLookup}
                      className="px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                    >
                      Find
                    </button>
                  </div>
                </div>

                {/* Lookup Error */}
                {lookupError && (
                  <p className="text-sm text-red-500">{lookupError}</p>
                )}

                {/* Job Details */}
                {jobDetails && (
                  <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded text-sm">
                    <p className="font-medium text-[var(--ff-text-primary)] mb-2">Job Found:</p>
                    <div className="space-y-1 text-[var(--ff-text-secondary)]">
                      <p><span className="text-[var(--ff-text-tertiary)]">ID:</span> {jobDetails.id}</p>
                      <p><span className="text-[var(--ff-text-tertiary)]">Type:</span> {jobDetails.type}</p>
                      <p><span className="text-[var(--ff-text-tertiary)]">Status:</span> <span className={
                        jobDetails.status === 'finished' ? 'text-green-500' :
                        jobDetails.status === 'failed' ? 'text-red-500' : 'text-yellow-500'
                      }>{jobDetails.status}</span></p>
                      <p><span className="text-[var(--ff-text-tertiary)]">Project:</span> {jobDetails.project}</p>
                      <p><span className="text-[var(--ff-text-tertiary)]">Created:</span> {formatTimeAgo(jobDetails.createdAt)}</p>
                    </div>
                  </div>
                )}

                {/* Project Details */}
                {projectDetails && (
                  <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded text-sm">
                    <p className="font-medium text-[var(--ff-text-primary)] mb-2">Project Found:</p>
                    <div className="space-y-1 text-[var(--ff-text-secondary)]">
                      <p><span className="text-[var(--ff-text-tertiary)]">ID:</span> {projectDetails.id}</p>
                      <p><span className="text-[var(--ff-text-tertiary)]">Name:</span> {projectDetails.name}</p>
                      <p><span className="text-[var(--ff-text-tertiary)]">Owner:</span> {projectDetails.owner}</p>
                      <p><span className="text-[var(--ff-text-tertiary)]">Total Jobs:</span> {projectDetails.jobCount}</p>
                      {projectDetails.lastJobStatus && (
                        <p><span className="text-[var(--ff-text-tertiary)]">Last Job:</span> <span className={
                          projectDetails.lastJobStatus === 'finished' ? 'text-green-500' :
                          projectDetails.lastJobStatus === 'failed' ? 'text-red-500' : 'text-yellow-500'
                        }>{projectDetails.lastJobStatus}</span></p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Job Timeline Stats */}
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
                <Activity className="w-5 h-5" />
                Job Timeline (Last 24h)
              </h2>
              <button
                onClick={loadJobStats}
                disabled={loadingStats}
                className="text-sm text-blue-500 hover:text-blue-400 disabled:opacity-50 flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${loadingStats ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {jobStats ? (
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                <div className="text-center p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{jobStats.total}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Total Jobs</p>
                </div>
                <div className="text-center p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
                  <p className="text-2xl font-bold text-green-500">{jobStats.success}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Successful</p>
                </div>
                <div className="text-center p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
                  <p className="text-2xl font-bold text-red-500">{jobStats.failed}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Failed</p>
                </div>
                <div className="text-center p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
                  <p className="text-2xl font-bold text-yellow-500">{jobStats.pending + jobStats.queued}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Pending</p>
                </div>
                <div className="text-center p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{jobStats.successRate}%</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Success Rate</p>
                </div>
                <div className="text-center p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{formatDuration(jobStats.avgDurationSec)}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Avg Duration</p>
                </div>
              </div>
            ) : (
              <p className="text-[var(--ff-text-tertiary)]">{loadingStats ? 'Loading stats...' : 'Click refresh to load stats'}</p>
            )}
          </div>
        </div>
      )}

      {/* Sync Tab */}
      {activeTab === 'sync' && (
        <QFieldSyncDashboard />
      )}
    </div>
  );
};
