/**
 * QField Sync API Service
 * Frontend service for communicating with QField sync endpoints
 */

import {
  QFieldProject,
  SyncJob,
  SyncStats,
  SyncConflict,
  SyncResponse,
  ProjectListResponse,
  SyncHistoryResponse,
  QFieldSyncDashboardData,
  SyncDirection,
} from '../types/qfield-sync.types';
import { log } from '@/lib/logger';

class QFieldSyncApiService {
  /**
   * Generic request handler
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = endpoint;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        message: `Request failed with status ${response.status}`,
      }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.data || data;
  }

  /**
   * Get dashboard data
   */
  async getDashboardData(): Promise<QFieldSyncDashboardData> {
    return this.request<QFieldSyncDashboardData>('/api/qfield-sync-dashboard');
  }

  /**
   * Get list of QFieldCloud projects
   */
  async getProjects(): Promise<QFieldProject[]> {
    const response = await this.request<ProjectListResponse>('/api/qfield-sync-projects');
    return response.projects;
  }

  /**
   * Get project details
   */
  async getProject(projectId: string): Promise<QFieldProject> {
    return this.request<QFieldProject>(`/api/qfield-sync-projects?id=${projectId}`);
  }

  /**
   * Start a sync job
   */
  async startSync(
    type: SyncJob['type'],
    direction: SyncDirection = 'bidirectional'
  ): Promise<SyncJob> {
    return this.request<SyncJob>('/api/qfield-sync-start', {
      method: 'POST',
      body: JSON.stringify({ type, direction }),
    });
  }

  /**
   * Get current sync job status
   */
  async getCurrentJob(): Promise<SyncJob | null> {
    return this.request<SyncJob | null>('/api/qfield-sync-current');
  }

  /**
   * Get sync history
   */
  async getSyncHistory(
    page = 1,
    pageSize = 20
  ): Promise<SyncHistoryResponse> {
    return this.request<SyncHistoryResponse>(
      `/api/qfield-sync-history?page=${page}&pageSize=${pageSize}`
    );
  }

  /**
   * Get sync statistics
   */
  async getSyncStats(): Promise<SyncStats> {
    return this.request<SyncStats>('/api/qfield-sync-stats');
  }

  /**
   * Get unresolved conflicts
   */
  async getConflicts(): Promise<SyncConflict[]> {
    return this.request<SyncConflict[]>('/api/qfield-sync-conflicts');
  }

  /**
   * Resolve a conflict
   */
  async resolveConflict(
    conflictId: string,
    resolution: 'use_qfield' | 'use_fibreflow' | 'merge' | 'skip'
  ): Promise<SyncResponse> {
    return this.request<SyncResponse>('/api/qfield-sync-conflicts-resolve', {
      method: 'POST',
      body: JSON.stringify({ conflictId, resolution }),
    });
  }

  /**
   * Test QFieldCloud connection
   */
  async testQFieldConnection(): Promise<SyncResponse> {
    return this.request<SyncResponse>('/api/qfield-sync-test-qfield');
  }

  /**
   * Test FibreFlow database connection
   */
  async testDatabaseConnection(): Promise<SyncResponse> {
    return this.request<SyncResponse>('/api/qfield-sync-test-database');
  }

  /**
   * Update sync configuration
   */
  async updateConfig(config: any): Promise<SyncResponse> {
    return this.request<SyncResponse>('/api/qfield-sync-config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }

  /**
   * Get sync configuration
   */
  async getConfig(): Promise<any> {
    return this.request<any>('/api/qfield-sync-config');
  }

  /**
   * Trigger manual sync
   */
  async triggerManualSync(
    type: SyncJob['type'] = 'fiber_cables'
  ): Promise<SyncJob> {
    return this.request<SyncJob>('/api/qfield-sync-manual', {
      method: 'POST',
      body: JSON.stringify({ type }),
    });
  }

  /**
   * Cancel current sync job
   */
  async cancelSync(): Promise<SyncResponse> {
    return this.request<SyncResponse>('/api/qfield-sync-cancel', {
      method: 'POST',
    });
  }

  /**
   * Get sync job details
   */
  async getSyncJob(jobId: string): Promise<SyncJob> {
    return this.request<SyncJob>(`/api/qfield-sync-jobs?id=${jobId}`);
  }

  /**
   * Export sync history as CSV
   */
  async exportSyncHistory(): Promise<Blob> {
    const response = await fetch('/api/qfield-sync-export', {
      method: 'GET',
      headers: {
        'Accept': 'text/csv',
      },
    });

    if (!response.ok) {
      throw new Error(`Export failed with status ${response.status}`);
    }

    return response.blob();
  }

  /**
   * WebSocket connection for real-time updates
   */
  connectWebSocket(
    onMessage: (event: MessageEvent) => void,
    onError?: (event: Event) => void
  ): WebSocket | null {
    // Check if we're in a browser environment
    if (typeof window === 'undefined') {
      log.debug('qfieldSyncApiService', { action: 'connectWebSocket', status: 'unavailable', message: 'WebSocket not available in server-side rendering' });
      return null;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const ws = new WebSocket(`${protocol}//${host}/ws/qfield-sync`);

      ws.onmessage = onMessage;
      ws.onerror = onError || ((error) => log.error('qfieldSyncApiService', { action: 'websocketDefaultError', error }));

      ws.onopen = () => {
        log.debug('qfieldSyncApiService', { action: 'websocketOpen', status: 'connected' });
      };

      ws.onclose = () => {
        log.debug('qfieldSyncApiService', { action: 'websocketClose', status: 'disconnected' });
      };

      return ws;
    } catch (error) {
      log.error('qfieldSyncApiService', { action: 'websocketCreate', error });
      return null;
    }
  }

  /**
   * Get fiber cable records from QFieldCloud
   */
  async getQFieldFiberCables(projectId: string): Promise<any[]> {
    return this.request<any[]>(`/api/qfield-sync-fiber-cables?projectId=${projectId}&source=qfield`);
  }

  /**
   * Get fiber cable records from FibreFlow
   */
  async getFibreFlowFiberCables(): Promise<any[]> {
    return this.request<any[]>('/api/qfield-sync-fiber-cables?source=fibreflow');
  }

  /**
   * Compare records between systems
   */
  async compareRecords(type: string): Promise<any> {
    return this.request<any>(`/api/qfield-sync-compare?type=${type}`);
  }

  /**
   * Batch update multiple records
   */
  async batchUpdate(records: any[]): Promise<SyncResponse> {
    return this.request<SyncResponse>('/api/qfield-sync-batch-update', {
      method: 'POST',
      body: JSON.stringify({ records }),
    });
  }

  /**
   * Get sync logs
   */
  async getSyncLogs(
    jobId?: string,
    level?: 'info' | 'warning' | 'error'
  ): Promise<any[]> {
    const params = new URLSearchParams();
    if (jobId) params.append('jobId', jobId);
    if (level) params.append('level', level);

    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<any[]>(`/api/qfield-sync-logs${query}`);
  }

  /**
   * Health check endpoint
   */
  async healthCheck(): Promise<{
    status: string;
    qfieldConnection: boolean;
    databaseConnection: boolean;
    lastSync: string | null;
  }> {
    return this.request('/api/qfield-sync-health');
  }
}

// Export singleton instance
export const qfieldSyncApiService = new QFieldSyncApiService();