/**
 * QField Sync Dashboard Component
 * Main dashboard for managing QFieldCloud to FibreFlow synchronization
 */

import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ConnectionStatus } from './ConnectionStatus';
import { SyncJobCard } from './SyncJobCard';
import { SyncStatsCard } from './SyncStatsCard';
import { ConflictResolver } from './ConflictResolver';
import { SyncHistoryTable } from './SyncHistoryTable';
import { SyncConfigModal } from './SyncConfigModal';
import { FiberCableDataViewer } from './FiberCableDataViewer';
import { FieldInstallationsViewer } from './FieldInstallationsViewer';
import { useQFieldSync } from '../hooks/useQFieldSync';
import { log } from '@/lib/logger';

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
  const [selectedTab, setSelectedTab] = useState<'overview' | 'installations' | 'data' | 'history' | 'conflicts'>('overview');

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
      log.error('QFieldSyncDashboard', { action: 'startSync', error: err });
    }
  };

  if (isLoading && !dashboardData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <LoadingSpinner size="lg" className="mx-auto mb-4" />
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
                      {new Date(project.lastModified).toISOString().split('T')[0]}
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

      {/* Configuration Modal */}
      {showConfig && (
        <SyncConfigModal
          config={dashboardData?.config}
          onClose={() => setShowConfig(false)}
          onSave={(config) => {
            log.debug('QFieldSyncDashboard', { action: 'saveConfig', config });
            setShowConfig(false);
          }}
        />
      )}
    </div>
  );
}

export default QFieldSyncDashboard;