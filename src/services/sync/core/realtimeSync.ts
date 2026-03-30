/**
 * Real-time Sync Manager
 * Handles WebSocket real-time listeners for instant synchronization
 */

import { socketIOAdapter } from '@/services/realtime/socketIOAdapter';
import type { RealtimeEvent } from '@/services/realtime/websocketService';
import { ProjectSync } from '../projectSync';
import { ClientSync } from '../clientSync';
import { StaffSync } from '../staffSync';
import { SyncConfig, SyncError, RealtimeSyncEvent } from './types';

export class RealtimeSyncManager {
  private unsubscribeFunctions: Array<() => void> = [];
  private config: SyncConfig;
  private onError: (error: SyncError) => void;
  private onSyncEvent: (event: RealtimeSyncEvent) => void;

  constructor(
    config: SyncConfig, 
    onError: (error: SyncError) => void,
    onSyncEvent: (event: RealtimeSyncEvent) => void
  ) {
    this.config = config;
    this.onError = onError;
    this.onSyncEvent = onSyncEvent;
  }

  /**
   * Setup real-time synchronization listeners
   */
  async setupRealtimeSync(): Promise<void> {
    if (!this.config.enableRealtimeSync) {
      return;
    }

    // Connect to WebSocket
    try {
      await socketIOAdapter.connect();
    } catch (error) {
      this.onError({
        timestamp: new Date(),
        type: 'realtime_connection_error',
        message: `Failed to connect to WebSocket: ${error}`,
        error
      });
      return;
    }

    // Projects real-time sync
    if (this.config.enabledSyncTypes.includes('projects')) {
      const unsubscribeProjects = socketIOAdapter.subscribeToAll(
        'project',
        async (event: RealtimeEvent) => {
          try {
            await this.handleProjectEvent(event);
          } catch (error) {
            this.onError({
              timestamp: new Date(),
              type: 'realtime_sync_error',
              message: `Failed to sync project change: ${error}`,
              entityId: event.entityId,
              entityType: 'project',
              error
            });
          }
        }
      );
      this.unsubscribeFunctions.push(unsubscribeProjects);
    }

    // Clients real-time sync
    if (this.config.enabledSyncTypes.includes('clients')) {
      const unsubscribeClients = socketIOAdapter.subscribeToAll(
        'client',
        async (event: RealtimeEvent) => {
          try {
            await this.handleClientEvent(event);
          } catch (error) {
            this.onError({
              timestamp: new Date(),
              type: 'realtime_sync_error',
              message: `Failed to sync client change: ${error}`,
              entityId: event.entityId,
              entityType: 'client',
              error
            });
          }
        }
      );
      this.unsubscribeFunctions.push(unsubscribeClients);
    }

    // Staff real-time sync
    if (this.config.enabledSyncTypes.includes('staff')) {
      const unsubscribeStaff = socketIOAdapter.subscribeToAll(
        'staff',
        async (event: RealtimeEvent) => {
          try {
            await this.handleStaffEvent(event);
          } catch (error) {
            this.onError({
              timestamp: new Date(),
              type: 'realtime_sync_error',
              message: `Failed to sync staff change: ${error}`,
              entityId: event.entityId,
              entityType: 'staff',
              error
            });
          }
        }
      );
      this.unsubscribeFunctions.push(unsubscribeStaff);
    }

    // Handle connection events
    socketIOAdapter.on('disconnected', (data) => {
      this.onError({
        timestamp: new Date(),
        type: 'realtime_disconnected',
        message: `WebSocket disconnected: ${data.reason}`,
        error: data
      });
    });

    socketIOAdapter.on('error', (error) => {
      this.onError({
        timestamp: new Date(),
        type: 'realtime_error',
        message: `WebSocket error: ${error}`,
        error
      });
    });
  }

  /**
   * Stop all real-time listeners
   */
  stopRealtimeSync(): void {
    this.unsubscribeFunctions.forEach(unsubscribe => unsubscribe());
    this.unsubscribeFunctions = [];
    socketIOAdapter.disconnect();
  }

  /**
   * Handle project WebSocket events
   */
  private async handleProjectEvent(event: RealtimeEvent): Promise<void> {
    this.onSyncEvent({
      type: event.type,
      entityType: 'project',
      entityId: event.entityId,
      data: event.data,
      timestamp: event.timestamp
    });

    switch (event.type) {
      case 'added':
      case 'modified':
        await ProjectSync.syncSingleProject(event.entityId, event.data);
        break;
      case 'removed':
        // Note: Delete functionality would need to be implemented
        // For now, we can mark it as deleted in the analytics
        break;
    }
  }

  /**
   * Handle client WebSocket events
   */
  private async handleClientEvent(event: RealtimeEvent): Promise<void> {
    this.onSyncEvent({
      type: event.type,
      entityType: 'client',
      entityId: event.entityId,
      data: event.data,
      timestamp: event.timestamp
    });

    switch (event.type) {
      case 'added':
      case 'modified':
        await ClientSync.syncSingleClient(event.entityId, event.data);
        break;
      case 'removed':
        // Note: Delete functionality would need to be implemented
        // For now, we can mark it as deleted in the analytics
        break;
    }
  }

  /**
   * Handle staff WebSocket events
   */
  private async handleStaffEvent(event: RealtimeEvent): Promise<void> {
    this.onSyncEvent({
      type: event.type,
      entityType: 'staff',
      entityId: event.entityId,
      data: event.data,
      timestamp: event.timestamp
    });

    switch (event.type) {
      case 'added':
      case 'modified':
        await StaffSync.syncSingleStaffMember(event.entityId, event.data);
        break;
      case 'removed':
        // Note: Delete functionality would need to be implemented
        // For now, we can mark it as deleted in the analytics
        break;
    }
  }
}