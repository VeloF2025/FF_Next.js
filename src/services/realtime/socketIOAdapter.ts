/**
 * Socket.IO Adapter for WebSocket Service
 * Provides Socket.IO-based implementation for real-time updates
 */

import { io, Socket } from 'socket.io-client';
import { EventEmitter } from 'events';
import type { EntityType, EventType, RealtimeEvent } from './websocketService';
import { log } from '@/lib/logger';

export interface SocketIOConfig {
  url?: string;
  autoConnect?: boolean;
  reconnection?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
}

class SocketIOAdapter extends EventEmitter {
  private socket: Socket | null = null;
  private config: SocketIOConfig;
  private subscriptions = new Map<string, Set<(event: RealtimeEvent) => void>>();

  constructor(config: SocketIOConfig = {}) {
    super();
    this.config = {
      url: config.url || (typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005'),
      autoConnect: config.autoConnect !== false,
      reconnection: config.reconnection !== false,
      reconnectionAttempts: config.reconnectionAttempts || 10,
      reconnectionDelay: config.reconnectionDelay || 5000
    };
  }

  /**
   * Connect to Socket.IO server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        resolve();
        return;
      }

      this.socket = io(this.config.url!, {
        path: '/api/ws',
        reconnection: this.config.reconnection,
        reconnectionAttempts: this.config.reconnectionAttempts,
        reconnectionDelay: this.config.reconnectionDelay,
        transports: ['websocket', 'polling']
      });

      this.socket.on('connect', () => {
        log.debug('socketIOAdapter', { action: 'connected' });
        this.emit('connected');
        
        // Re-subscribe to all active subscriptions
        this.resubscribeAll();
        resolve();
      });

      this.socket.on('disconnect', (reason) => {
        log.debug('socketIOAdapter', { action: 'disconnected', reason });
        this.emit('disconnected', { reason });
      });

      this.socket.on('connect_error', (error) => {
        log.error('socketIOAdapter', { action: 'connectionError', error });
        this.emit('error', error);
        reject(error);
      });

      // Handle database change events
      this.socket.on('db_change', (data) => {
        this.handleEvent(data);
      });

      this.socket.on('entity_change', (data) => {
        this.handleEvent(data);
      });

      // Handle initial data
      this.socket.on('initial_data', (data) => {
        const event: RealtimeEvent = {
          type: 'modified',
          entityType: data.entityType,
          entityId: data.entityId,
          data: data.data,
          timestamp: new Date()
        };
        this.notifySubscribers(event);
      });

      // Handle pong response
      this.socket.on('pong', () => {
        // Heartbeat received
      });

      if (this.config.autoConnect) {
        this.socket.connect();
      }
    });
  }

  /**
   * Disconnect from Socket.IO server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.subscriptions.clear();
  }

  /**
   * Handle incoming events
   */
  private handleEvent(data: Record<string, unknown>): void {
    const event: RealtimeEvent = {
      type: this.mapEventType(String(data.eventType ?? '')),
      entityType: data.entityType as EntityType,
      entityId: String(data.entityId ?? ''),
      data: data.data as Record<string, unknown> | undefined,
      timestamp: new Date(String(data.timestamp ?? ''))
    };

    this.emit('event', event);
    this.notifySubscribers(event);
  }

  /**
   * Map database operation to event type
   */
  private mapEventType(operation: string): EventType {
    switch (operation?.toLowerCase()) {
      case 'insert':
        return 'added';
      case 'update':
        return 'modified';
      case 'delete':
        return 'removed';
      default:
        return 'modified';
    }
  }

  /**
   * Subscribe to entity changes
   */
  subscribe(
    entityType: EntityType,
    entityId: string | '*',
    callback: (event: RealtimeEvent) => void
  ): () => void {
    const key = `${entityType}:${entityId}`;
    
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set());
      
      // Send subscription to server
      if (this.socket?.connected) {
        this.socket.emit('subscribe', { entityType, entityId });
      }
    }
    
    this.subscriptions.get(key)!.add(callback);

    // Return unsubscribe function
    return () => {
      const subs = this.subscriptions.get(key);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.subscriptions.delete(key);
          if (this.socket?.connected) {
            this.socket.emit('unsubscribe', { entityType, entityId });
          }
        }
      }
    };
  }

  /**
   * Subscribe to all changes of a specific entity type
   */
  subscribeToAll(
    entityType: EntityType,
    callback: (event: RealtimeEvent) => void
  ): () => void {
    return this.subscribe(entityType, '*', callback);
  }

  /**
   * Notify subscribers of an event
   */
  private notifySubscribers(event: RealtimeEvent): void {
    // Notify specific entity subscribers
    const specificKey = `${event.entityType}:${event.entityId}`;
    const specificSubs = this.subscriptions.get(specificKey);
    if (specificSubs) {
      specificSubs.forEach(callback => callback(event));
    }

    // Notify wildcard subscribers
    const wildcardKey = `${event.entityType}:*`;
    const wildcardSubs = this.subscriptions.get(wildcardKey);
    if (wildcardSubs) {
      wildcardSubs.forEach(callback => callback(event));
    }
  }

  /**
   * Re-subscribe to all active subscriptions after reconnection
   */
  private resubscribeAll(): void {
    if (!this.socket?.connected) return;

    this.subscriptions.forEach((_, key) => {
      const [entityType, entityId] = key.split(':');
      this.socket!.emit('subscribe', { entityType, entityId });
    });
  }

  /**
   * Send ping for heartbeat
   */
  ping(): void {
    if (this.socket?.connected) {
      this.socket.emit('ping');
    }
  }

  /**
   * Broadcast a change event (for manual triggers)
   */
  broadcastChange(event: {
    eventType: EventType;
    entityType: EntityType;
    entityId: string;
    data: unknown;
  }): void {
    if (this.socket?.connected) {
      this.socket.emit('broadcast_change', event);
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}

// Export singleton instance
export const socketIOAdapter = new SocketIOAdapter();

// Export class for testing
export { SocketIOAdapter };