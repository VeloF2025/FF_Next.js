/**
 * QField Sync Dashboard Component
 * Main dashboard for managing QFieldCloud to FibreFlow synchronization
 * Includes Server Controls tab for admin operations
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowDownUp,
  Cloud,
  Database,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
  Activity,
  Settings,
  Download,
  Server,
  Search,
} from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';

// Server Controls interfaces
interface ServiceStatus {
  containers: { total: number; running: number; list: Array<{ name: string; status: string }> };
  database: { connected: boolean; stats: Record<string, number> };
  minio: { live: boolean };
  jobs: { pending: number; queued: number; stuck: Array<{ id: string; type: string; status: string; project: string; createdAt: string }> };
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
import { ConnectionStatus } from './ConnectionStatus';
import { SyncJobCard } from './SyncJobCard';
import { SyncStatsCard } from './SyncStatsCard';
import { ConflictResolver } from './ConflictResolver';
import { SyncHistoryTable } from './SyncHistoryTable';
import { SyncConfigModal } from './SyncConfigModal';
import { FiberCableDataViewer } from './FiberCableDataViewer';
import { FieldInstallationsViewer } from './FieldInstallationsViewer';
import { useQFieldSync } from '../hooks/useQFieldSync';

export function QFieldSyncDashboard() {
  const {
    dashboardData,
    currentJob,
    syncHistory,
    isLoading,
    error,
    startSync,
    cancelSync,
    resolveConflict,
    refreshData,
  } = useQFieldSync();

  const [showConfig, setShowConfig] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'overview' | 'installations' | 'data' | 'history' | 'conflicts' | 'server-controls'>('overview');

  // Server Controls State
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | null>(null);
  const [jobStats, setJobStats] = useState<JobStats | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [jobLookupId, setJobLookupId] = useState('');
  const [projectLookupId, setProjectLookupId] = useState('');
  const [jobDetails, setJobDetails] = useState<JobDetails | null>(null);
  const [projectDetails, setProjectDetails] = useState<ProjectDetails | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    // Initial data load
    refreshData();

    // Set up polling for real-time updates
    const interval = setInterval(refreshData, 30000); // Every 30 seconds

    return () => clearInterval(interval);
  }, [refreshData]);

  const handleManualSync = async () => {
    try {
      await startSync('fiber_cables', 'bidirectional');
    } catch (err) {
      console.error('Failed to start sync:', err);
    }
  };

  // === SERVER CONTROLS FUNCTIONS ===

  const loadServerStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const [statusRes, statsRes] = await Promise.all([
        fetch('/api/qfield'),
        fetch('/api/qfield', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'job-stats' }) }),
      ]);

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setServiceStatus(statusData.data);
      }

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        if (statsData.data?.stats) {
          setJobStats(statsData.data.stats);
        }
      }
    } catch (err) {
      console.error('Failed to load server status:', err);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  // Load server status when switching to Server Controls tab
  useEffect(() => {
    if (selectedTab === 'server-controls') {
      loadServerStatus();
    }
  }, [selectedTab, loadServerStatus]);

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
        await loadServerStatus();
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
        await loadServerStatus();
      } else {
        notificationService.error(data.data?.message || 'Failed to restart app');
      }
    } catch (err) {
      notificationService.error('Failed to restart app container');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleClearStuckJobs = async () => {
    const stuckCount = (serviceStatus?.jobs.pending || 0) + (serviceStatus?.jobs.queued || 0);
    if (stuckCount === 0) {
      notificationService.info('No stuck jobs to clear');
      return;
    }

    if (!confirm(`Clear ${stuckCount} stuck job(s)?\n\nThis will mark them as failed so new jobs can process.`)) {
      return;
    }

    setActionInProgress('clear-jobs');
    try {
      const res = await fetch('/api/qfield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear-jobs' }),
      });
      const data = await res.json();

      if (data.data?.success) {
        notificationService.success(`Cleared ${data.data.cleared} stuck job(s)`);
        await loadServerStatus();
      } else {
        notificationService.error('Failed to clear stuck jobs');
      }
    } catch (err) {
      notificationService.error('Failed to clear stuck jobs');
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

  if (isLoading && !dashboardData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-[var(--ff-text-secondary)]">Loading QField Sync Dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-600 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">Connection Error</h2>
          <p className="text-[var(--ff-text-secondary)]">{error}</p>
          <button
            onClick={refreshData}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-[var(--ff-text-primary)] flex items-center gap-3">
              <ArrowDownUp className="h-8 w-8 text-blue-600" />
              QField Sync
            </h1>
            <p className="text-[var(--ff-text-secondary)] mt-1">
              Synchronize field data between QFieldCloud and FibreFlow
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setShowConfig(true)}
              className="px-4 py-2 border border-[var(--ff-border-light)] rounded-md text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] flex items-center gap-2"
            >
              <Settings className="h-4 w-4" />
              Settings
            </button>

            <button
              onClick={handleManualSync}
              disabled={currentJob?.status === 'syncing'}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${currentJob?.status === 'syncing' ? 'animate-spin' : ''}`} />
              {currentJob?.status === 'syncing' ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
        </div>
      </div>

      {/* Connection Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <ConnectionStatus
          title="QFieldCloud"
          icon={Cloud}
          status={dashboardData?.connectionStatus.qfieldcloud || 'disconnected'}
          url="https://qfield.fibreflow.app"
          lastCheck={new Date().toISOString()}
        />
        <ConnectionStatus
          title="FibreFlow Database"
          icon={Database}
          status={dashboardData?.connectionStatus.fibreflow || 'disconnected'}
          url="Neon PostgreSQL"
          lastCheck={new Date().toISOString()}
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-[var(--ff-border-light)] mb-6">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setSelectedTab('overview')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              selectedTab === 'overview'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setSelectedTab('installations')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              selectedTab === 'installations'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
            }`}
          >
            Poles & Drops
          </button>
          <button
            onClick={() => setSelectedTab('data')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              selectedTab === 'data'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
            }`}
          >
            Fiber Cables
          </button>
          <button
            onClick={() => setSelectedTab('history')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              selectedTab === 'history'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
            }`}
          >
            Sync History
          </button>
          <button
            onClick={() => setSelectedTab('conflicts')}
            className={`py-2 px-1 border-b-2 font-medium text-sm relative ${
              selectedTab === 'conflicts'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
            }`}
          >
            Conflicts
            {dashboardData?.conflicts && dashboardData.conflicts.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                {dashboardData.conflicts.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setSelectedTab('server-controls')}
            className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center gap-1 ${
              selectedTab === 'server-controls'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
            }`}
          >
            <Server className="h-4 w-4" />
            Server Controls
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {selectedTab === 'overview' && (
        <div className="space-y-6">
          {/* Current Sync Job */}
          {currentJob && <SyncJobCard job={currentJob} onCancel={cancelSync} />}

          {/* Sync Statistics */}
          {dashboardData?.stats && <SyncStatsCard stats={dashboardData.stats} />}

          {/* Recent Projects */}
          {dashboardData?.projects && dashboardData.projects.length > 0 && (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">QFieldCloud Projects</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {dashboardData.projects.map((project) => (
                  <div
                    key={project.id}
                    className="border border-[var(--ff-border-light)] rounded-lg p-4 hover:bg-[var(--ff-bg-hover)]"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-medium text-[var(--ff-text-primary)]">{project.name}</h4>
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          project.status === 'active'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]'
                        }`}
                      >
                        {project.status}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--ff-text-secondary)] mb-2">{project.description}</p>
                    <div className="flex items-center text-xs text-[var(--ff-text-tertiary)]">
                      <Clock className="h-3 w-3 mr-1" />
                      {new Date(project.lastModified).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {selectedTab === 'installations' && (
        <FieldInstallationsViewer />
      )}

      {selectedTab === 'data' && (
        <FiberCableDataViewer />
      )}

      {selectedTab === 'history' && (
        <div>
          {syncHistory && syncHistory.length > 0 ? (
            <SyncHistoryTable history={syncHistory} />
          ) : (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-8 text-center">
              <Clock className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
              <p className="text-[var(--ff-text-secondary)]">No sync history available</p>
            </div>
          )}
        </div>
      )}

      {selectedTab === 'conflicts' && (
        <div>
          {dashboardData?.conflicts && dashboardData.conflicts.length > 0 ? (
            <ConflictResolver
              conflicts={dashboardData.conflicts}
              onResolve={resolveConflict}
            />
          ) : (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-8 text-center">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <p className="text-[var(--ff-text-secondary)]">No conflicts to resolve</p>
            </div>
          )}
        </div>
      )}

      {/* Server Controls Tab */}
      {selectedTab === 'server-controls' && (
        <div className="space-y-6">
          {/* Top Row - Status, Controls, Lookup */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Service Status Card */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
                  <Search className="h-5 w-5" />
                  Service Status
                </h2>
                <button
                  onClick={loadServerStatus}
                  disabled={loadingStatus}
                  className="text-sm text-blue-500 hover:text-blue-400 disabled:opacity-50 flex items-center gap-1"
                >
                  <RefreshCw className={`h-3 w-3 ${loadingStatus ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>

              {loadingStatus && !serviceStatus ? (
                <p className="text-[var(--ff-text-secondary)]">Loading...</p>
              ) : serviceStatus ? (
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[var(--ff-text-secondary)]">Workers</span>
                    <span className={`text-sm font-medium ${
                      serviceStatus.containers.list.filter(c => c.name.includes('worker')).length >= 8 ? 'text-green-500' : 'text-yellow-500'
                    }`}>
                      {serviceStatus.containers.list.filter(c => c.name.includes('worker')).length}/8
                      {serviceStatus.containers.list.filter(c => c.name.includes('worker')).length >= 8 ? ' ✅' : ' ⚠️'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[var(--ff-text-secondary)]">App Container</span>
                    <span className={`text-sm font-medium ${
                      serviceStatus.containers.list.some(c => c.name.includes('app') && c.status.includes('Up'))
                        ? 'text-green-500' : 'text-red-500'
                    }`}>
                      {serviceStatus.containers.list.some(c => c.name.includes('app') && c.status.includes('Up'))
                        ? 'Running ✅' : 'Down ❌'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[var(--ff-text-secondary)]">Database</span>
                    <span className={`text-sm font-medium ${
                      serviceStatus.database.connected ? 'text-green-500' : 'text-red-500'
                    }`}>
                      {serviceStatus.database.connected ? 'Connected ✅' : 'Disconnected ❌'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[var(--ff-text-secondary)]">MinIO Storage</span>
                    <span className={`text-sm font-medium ${
                      serviceStatus.minio.live ? 'text-green-500' : 'text-red-500'
                    }`}>
                      {serviceStatus.minio.live ? 'Live ✅' : 'Down ❌'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[var(--ff-text-secondary)]">Stuck Jobs</span>
                    <span className={`text-sm font-medium ${
                      (serviceStatus.jobs.pending + serviceStatus.jobs.queued) === 0
                        ? 'text-green-500' : 'text-yellow-500'
                    }`}>
                      {serviceStatus.jobs.pending + serviceStatus.jobs.queued}
                      {(serviceStatus.jobs.pending + serviceStatus.jobs.queued) === 0 ? ' ✅' : ' ⚠️'}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-[var(--ff-text-tertiary)]">Click refresh to load status</p>
              )}
            </div>

            {/* Worker Controls Card */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)] flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Worker Controls
              </h2>

              <div className="space-y-3">
                <button
                  onClick={handleRestartWorkers}
                  disabled={actionInProgress !== null}
                  className="w-full bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                >
                  {actionInProgress === 'restart-workers' ? (
                    <><RefreshCw className="h-4 w-4 animate-spin" /> Restarting...</>
                  ) : (
                    <><RefreshCw className="h-4 w-4" /> Restart Workers</>
                  )}
                </button>

                <button
                  onClick={handleClearStuckJobs}
                  disabled={actionInProgress !== null}
                  className="w-full bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                >
                  {actionInProgress === 'clear-jobs' ? (
                    <><RefreshCw className="h-4 w-4 animate-spin" /> Clearing...</>
                  ) : (
                    <>🧹 Clear Stuck Jobs</>
                  )}
                </button>

                <button
                  onClick={handleRestartApp}
                  disabled={actionInProgress !== null}
                  className="w-full bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                >
                  {actionInProgress === 'restart-app' ? (
                    <><RefreshCw className="h-4 w-4 animate-spin" /> Restarting...</>
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
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)] flex items-center gap-2">
                <Search className="h-5 w-5" />
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
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)] flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Job Timeline (Last 24h)
            </h2>

            {jobStats ? (
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                <div className="text-center p-3 bg-[var(--ff-bg-tertiary)] rounded">
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{jobStats.total}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Total Jobs</p>
                </div>
                <div className="text-center p-3 bg-[var(--ff-bg-tertiary)] rounded">
                  <p className="text-2xl font-bold text-green-500">{jobStats.success}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Successful</p>
                </div>
                <div className="text-center p-3 bg-[var(--ff-bg-tertiary)] rounded">
                  <p className="text-2xl font-bold text-red-500">{jobStats.failed}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Failed</p>
                </div>
                <div className="text-center p-3 bg-[var(--ff-bg-tertiary)] rounded">
                  <p className="text-2xl font-bold text-yellow-500">{jobStats.pending + jobStats.queued}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Pending</p>
                </div>
                <div className="text-center p-3 bg-[var(--ff-bg-tertiary)] rounded">
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{jobStats.successRate}%</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Success Rate</p>
                </div>
                <div className="text-center p-3 bg-[var(--ff-bg-tertiary)] rounded">
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{formatDuration(jobStats.avgDurationSec)}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Avg Duration</p>
                </div>
              </div>
            ) : (
              <p className="text-[var(--ff-text-tertiary)]">Loading stats...</p>
            )}
          </div>

          {/* Stuck Jobs List */}
          {serviceStatus && serviceStatus.jobs.stuck.length > 0 && (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)] flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-yellow-500" />
                Stuck Jobs ({serviceStatus.jobs.stuck.length})
              </h2>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--ff-text-tertiary)] border-b border-[var(--ff-border-light)]">
                      <th className="pb-2 pr-4">ID</th>
                      <th className="pb-2 pr-4">Type</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2 pr-4">Project</th>
                      <th className="pb-2">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serviceStatus.jobs.stuck.map((job) => (
                      <tr key={job.id} className="border-b border-[var(--ff-border-light)] text-[var(--ff-text-secondary)]">
                        <td className="py-2 pr-4 font-mono text-xs">{job.id.substring(0, 8)}...</td>
                        <td className="py-2 pr-4">{job.type}</td>
                        <td className="py-2 pr-4">
                          <span className={`px-2 py-1 rounded text-xs ${
                            job.status === 'pending' ? 'bg-yellow-500/20 text-yellow-500' : 'bg-orange-500/20 text-orange-500'
                          }`}>
                            {job.status}
                          </span>
                        </td>
                        <td className="py-2 pr-4">{job.project}</td>
                        <td className="py-2">{formatTimeAgo(job.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Configuration Modal */}
      {showConfig && (
        <SyncConfigModal
          config={dashboardData?.config}
          onClose={() => setShowConfig(false)}
          onSave={(config) => {
            console.log('Saving config:', config);
            setShowConfig(false);
          }}
        />
      )}
    </div>
  );
}

export default QFieldSyncDashboard;