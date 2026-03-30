/**
 * Full Sync Orchestrator
 * Manages complete synchronization of all data types
 */

import { ProjectSync } from '../projectSync';
import { ClientSync } from '../clientSync';
import { StaffSync } from '../staffSync';
import { SyncConfig, FullSyncResult, SyncError } from './types';
import { log } from '@/lib/logger';

export class FullSyncOrchestrator {
  private config: SyncConfig;

  constructor(config: SyncConfig) {
    this.config = config;
  }

  /**
   * Perform full synchronization across all enabled types
   */
  async performFullSync(): Promise<FullSyncResult> {
    const startTime = Date.now();
    const result: FullSyncResult = {
      success: true,
      totalRecords: 0,
      syncedRecords: 0,
      failedRecords: 0,
      duration: 0,
      errors: [],
      byType: {}
    };

    // Sync projects
    if (this.config.enabledSyncTypes.includes('projects')) {
      try {
        const projectResult = await this.syncProjects();
        result.byType.projects = projectResult;
        result.totalRecords += projectResult.total;
        result.syncedRecords += projectResult.synced;
        result.failedRecords += projectResult.failed;
        result.errors.push(...projectResult.errors);
      } catch (error) {
        const syncError: SyncError = {
          timestamp: new Date(),
          type: 'sync_type_error',
          message: `Failed to sync projects: ${error instanceof Error ? error.message : 'Unknown error'}`,
          entityType: 'project',
          error
        };
        result.errors.push(syncError);
        result.success = false;
      }
    }

    // Sync clients
    if (this.config.enabledSyncTypes.includes('clients')) {
      try {
        const clientResult = await this.syncClients();
        result.byType.clients = clientResult;
        result.totalRecords += clientResult.total;
        result.syncedRecords += clientResult.synced;
        result.failedRecords += clientResult.failed;
        result.errors.push(...clientResult.errors);
      } catch (error) {
        const syncError: SyncError = {
          timestamp: new Date(),
          type: 'sync_type_error',
          message: `Failed to sync clients: ${error instanceof Error ? error.message : 'Unknown error'}`,
          entityType: 'client',
          error
        };
        result.errors.push(syncError);
        result.success = false;
      }
    }

    // Sync staff
    if (this.config.enabledSyncTypes.includes('staff')) {
      try {
        const staffResult = await this.syncStaff();
        result.byType.staff = staffResult;
        result.totalRecords += staffResult.total;
        result.syncedRecords += staffResult.synced;
        result.failedRecords += staffResult.failed;
        result.errors.push(...staffResult.errors);
      } catch (error) {
        const syncError: SyncError = {
          timestamp: new Date(),
          type: 'sync_type_error',
          message: `Failed to sync staff: ${error instanceof Error ? error.message : 'Unknown error'}`,
          entityType: 'staff',
          error
        };
        result.errors.push(syncError);
        result.success = false;
      }
    }

    result.duration = Date.now() - startTime;
    
    // Determine overall success
    result.success = result.success && result.errors.length === 0;

    if (result.errors.length > 0) {
      log.warn(`[SyncCore] Full sync had ${result.errors.length} errors`, undefined, 'fullSync');
    }

    return result;
  }

  /**
   * Sync all projects
   */
  private async syncProjects(): Promise<{
    total: number;
    synced: number;
    failed: number;
    errors: SyncError[];
  }> {

    const result = {
      total: 0,
      synced: 0,
      failed: 0,
      errors: [] as SyncError[]
    };

    try {
      const syncResult = await ProjectSync.syncAllProjects();
      result.total = syncResult.processedCount + syncResult.errorCount;
      result.synced = syncResult.processedCount;
      result.failed = syncResult.errorCount;
      result.errors = syncResult.errors ? syncResult.errors.map(msg => ({
        timestamp: new Date(),
        type: 'project_sync_error',
        message: msg,
        entityType: 'project'
      })) : [];

    } catch (error) {
      result.errors.push({
        timestamp: new Date(),
        type: 'projects_sync_error',
        message: `Projects sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        entityType: 'project',
        error
      });
      result.failed = 1;
    }

    return result;
  }

  /**
   * Sync all clients
   */
  private async syncClients(): Promise<{
    total: number;
    synced: number;
    failed: number;
    errors: SyncError[];
  }> {

    const result = {
      total: 0,
      synced: 0,
      failed: 0,
      errors: [] as SyncError[]
    };

    try {
      const syncResult = await ClientSync.syncAllClients();
      result.total = syncResult.processedCount + syncResult.errorCount;
      result.synced = syncResult.processedCount;
      result.failed = syncResult.errorCount;
      result.errors = syncResult.errors ? syncResult.errors.map((msg: string) => ({
        timestamp: new Date(),
        type: 'client_sync_error',
        message: msg,
        entityType: 'client'
      })) : [];

    } catch (error) {
      result.errors.push({
        timestamp: new Date(),
        type: 'clients_sync_error',
        message: `Clients sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        entityType: 'client',
        error
      });
      result.failed = 1;
    }

    return result;
  }

  /**
   * Sync all staff
   */
  private async syncStaff(): Promise<{
    total: number;
    synced: number;
    failed: number;
    errors: SyncError[];
  }> {

    const result = {
      total: 0,
      synced: 0,
      failed: 0,
      errors: [] as SyncError[]
    };

    try {
      const syncResult = await StaffSync.syncAllStaff();
      result.total = syncResult.processedCount + syncResult.errorCount;
      result.synced = syncResult.processedCount;
      result.failed = syncResult.errorCount;
      result.errors = syncResult.errors ? syncResult.errors.map(msg => ({
        timestamp: new Date(),
        type: 'staff_sync_error',
        message: msg,
        entityType: 'staff'
      })) : [];

    } catch (error) {
      result.errors.push({
        timestamp: new Date(),
        type: 'staff_sync_error',
        message: `Staff sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        entityType: 'staff',
        error
      });
      result.failed = 1;
    }

    return result;
  }
}