/**
 * useQFieldSync Hook
 * Custom hook for managing QField sync state and operations
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  QFieldSyncDashboardData,
  QFieldSyncConfig,
  SyncJob,
  SyncConflict,
  SyncDirection,
} from '../types/qfield-sync.types';
import { qfieldSyncApiService } from '../services/qfieldSyncApiService';
import { log } from '@/lib/logger';

interface UseQFieldSyncReturn {
  dashboardData: QFieldSyncDashboardData | null;
  currentJob: SyncJob | null;
  syncHistory: SyncJob[];
  isLoading: boolean;
  error: string | null;
  startSync: (type: SyncJob['type'], direction: SyncDirection) => Promise<void>;
  cancelSync: () => Promise<void>;
  resolveConflict: (conflictId: string, resolution: 'skip' | 'use_qfield' | 'use_fibreflow' | 'merge') => Promise<void>;
  refreshData: () => void;
  updateConfig: (config: QFieldSyncConfig) => Promise<void>;
}

export function useQFieldSync(): UseQFieldSyncReturn {
  const [dashboardData, setDashboardData] = useState<QFieldSyncDashboardData | null>(null);
  const [currentJob, setCurrentJob] = useState<SyncJob | null>(null);
  const [syncHistory, setSyncHistory] = useState<SyncJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch dashboard data
  const fetchDashboardData = useCallback(async () => {
    try {
      const data = await qfieldSyncApiService.getDashboardData();
      setDashboardData(data);
      setError(null);
    } catch (err) {
      log.error('useQFieldSync', { action: 'fetchDashboardData', error: err });
      setError(err instanceof Error ? err.message : 'Failed to fetch dashboard data');
    }
  }, []);

  // Fetch current job status
  const fetchCurrentJob = useCallback(async () => {
    try {
      const job = await qfieldSyncApiService.getCurrentJob();
      if (job) {
        setCurrentJob({
          ...job,
          errors: job.errors || []
        });
      } else {
        setCurrentJob(null);
      }
    } catch (err) {
      log.error('useQFieldSync', { action: 'fetchCurrentJob', error: err });
    }
  }, []);

  // Fetch sync history
  const fetchSyncHistory = useCallback(async () => {
    try {
      const response = await qfieldSyncApiService.getSyncHistory();
      setSyncHistory(response.jobs.map(job => ({
        ...job,
        errors: job.errors || []
      })));
    } catch (err) {
      log.error('useQFieldSync', { action: 'fetchSyncHistory', error: err });
    }
  }, []);

  // Refresh all data
  const refreshData = useCallback(() => {
    setIsLoading(true);
    Promise.all([
      fetchDashboardData(),
      fetchCurrentJob(),
      fetchSyncHistory(),
    ]).finally(() => {
      setIsLoading(false);
    });
  }, [fetchDashboardData, fetchCurrentJob, fetchSyncHistory]);

  // Start a sync job
  const startSync = useCallback(async (type: SyncJob['type'], direction: SyncDirection) => {
    try {
      setError(null);
      const job = await qfieldSyncApiService.startSync(type, direction);
      setCurrentJob({
        ...job,
        errors: job.errors || []
      });

      // Refresh data after starting sync
      setTimeout(() => {
        fetchCurrentJob();
        fetchSyncHistory();
      }, 1000);
    } catch (err) {
      log.error('useQFieldSync', { action: 'startSync', type, direction, error: err });
      setError(err instanceof Error ? err.message : 'Failed to start sync');
      throw err;
    }
  }, [fetchCurrentJob, fetchSyncHistory]);

  // Cancel current sync job
  const cancelSync = useCallback(async () => {
    try {
      await qfieldSyncApiService.cancelSync();
      setCurrentJob(null);
      refreshData();
    } catch (err) {
      log.error('useQFieldSync', { action: 'cancelSync', error: err });
      setError(err instanceof Error ? err.message : 'Failed to cancel sync');
      throw err;
    }
  }, [refreshData]);

  // Resolve a conflict
  const resolveConflict = useCallback(async (
    conflictId: string,
    resolution: NonNullable<SyncConflict['resolution']>
  ) => {
    try {
      await qfieldSyncApiService.resolveConflict(conflictId, resolution);

      // Update local state
      if (dashboardData) {
        const updatedConflicts = dashboardData.conflicts.map(c =>
          c.id === conflictId
            ? { ...c, resolution, resolvedAt: new Date().toISOString() }
            : c
        );
        setDashboardData({
          ...dashboardData,
          conflicts: updatedConflicts.filter(c => !c.resolution),
        });
      }
    } catch (err) {
      log.error('useQFieldSync', { action: 'resolveConflict', conflictId, resolution, error: err });
      setError(err instanceof Error ? err.message : 'Failed to resolve conflict');
      throw err;
    }
  }, [dashboardData]);

  // Update configuration
  const updateConfig = useCallback(async (config: QFieldSyncConfig) => {
    try {
      await qfieldSyncApiService.updateConfig(config);
      if (dashboardData) {
        setDashboardData({
          ...dashboardData,
          config,
        });
      }
    } catch (err) {
      log.error('useQFieldSync', { action: 'updateConfig', error: err });
      setError(err instanceof Error ? err.message : 'Failed to update configuration');
      throw err;
    }
  }, [dashboardData]);

  // Set up WebSocket connection for real-time updates
  useEffect(() => {
    // Temporarily disable WebSocket until backend implementation is ready
    const ENABLE_WEBSOCKET = false;

    if (!ENABLE_WEBSOCKET) {
      log.debug('useQFieldSync', { action: 'websocketCheck', status: 'disabled', message: 'Using polling for updates' });
      return;
    }

    const connectWebSocket = () => {
      try {
        const ws = qfieldSyncApiService.connectWebSocket(
          (event) => {
            try {
              const data = JSON.parse(event.data);
              log.debug('useQFieldSync', { action: 'websocketMessage', messageType: data.type, data });

              switch (data.type) {
                case 'sync_started':
                  setCurrentJob({
                    ...data.data,
                    errors: data.data.errors || []
                  });
                  break;
                case 'sync_progress':
                  setCurrentJob({
                    ...data.data,
                    errors: data.data.errors || []
                  });
                  break;
                case 'sync_completed':
                  setCurrentJob(null);
                  fetchSyncHistory();
                  fetchDashboardData();
                  break;
                case 'sync_error':
                  setCurrentJob(null);
                  setError(data.data.message);
                  fetchSyncHistory();
                  break;
                default:
                  break;
              }
            } catch (parseError) {
              log.error('useQFieldSync', { action: 'websocketMessageParse', error: parseError });
            }
          },
          (error) => {
            log.error('useQFieldSync', { action: 'websocketError', error });
          }
        );

        if (ws) {
          wsRef.current = ws;
        }
      } catch (err) {
        log.error('useQFieldSync', { action: 'websocketConnect', error: err });
      }
    };

    // Only connect WebSocket in browser environment
    if (typeof window !== 'undefined') {
      connectWebSocket();
    }

    // Cleanup on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [fetchDashboardData, fetchSyncHistory]);

  // Initial data load
  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Polling for current job updates
  useEffect(() => {
    if (currentJob && currentJob.status === 'syncing') {
      const interval = setInterval(fetchCurrentJob, 2000);
      return () => clearInterval(interval);
    }
  }, [currentJob, fetchCurrentJob]);

  return {
    dashboardData,
    currentJob,
    syncHistory,
    isLoading,
    error,
    startSync,
    cancelSync,
    resolveConflict,
    refreshData,
    updateConfig,
  };
}