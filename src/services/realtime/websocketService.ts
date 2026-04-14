/**
 * WebSocket Service for Real-time Updates
 * Replaces Firebase real-time functionality with WebSocket connections
 */

import { EventEmitter } from 'events';
import { log } from '@/lib/logger';

export type EntityType = 'project' | 'client' | 'staff' | 'procurement' | 'sow';
export type EventType = 'added' | 'modified' | 'removed';

export interface RealtimeEvent {
  type: EventType;
  entityType: EntityType;
  entityId: string;
  data?: Record<string, unknown>;
  timestamp: Date;
}

/** Typed WebSocket message for sending/receiving */
export type WebSocketMessage = Record<string, unknown>;

export interface WebSocketConfig {
  url?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
  enableAutoReconnect?: boolean;
}

class WebSocketService extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: Required<WebSocketConfig>;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private subscriptions = new Map<string, Set<(event: RealtimeEvent) => void>>();
  private isConnecting = false;
  private messageQueue: WebSocketMessage[] = [];

  constructor(config: WebSocketConfig = {}) {
    super();
    this.config = {
      url: config.url || this.getWebSocketUrl(),
      reconnectInterval: config.reconnectInterval || 5000,
      maxReconnectAttempts: config.maxReconnectAttempts || 10,
      heartbeatInterval: config.heartbeatInterval || 30000,
      enableAutoReconnect: config.enableAutoReconnect !== false
    };
  }

  private getWebSocketUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/api/ws`;
  }

  /**
   * Connect to WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      if (this.isConnecting) {
        // Wait for existing connection attempt
        const checkConnection = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            clearInterval(checkConnection);
            resolve();
          } else if (!this.isConnecting) {
            clearInterval(checkConnection);
            reject(new Error('Connection failed'));
          }
        }, 100);
        return;
      }

      this.isConnecting = true;

      try {
        this.ws = new WebSocket(this.config.url);

        this.ws.onopen = () => {
          log.debug('websocketService', { action: 'connected' });
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.emit('connected');
          this.startHeartbeat();
          this.flushMessageQueue();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            log.error('websocketService', { action: 'parseMessage', error });
          }
        };

        this.ws.onerror = (error) => {
          log.error('websocketService', { action: 'error', error });
          this.isConnecting = false;
          this.emit('error', error);
          reject(error);
        };

        this.ws.onclose = (event) => {
          log.debug('websocketService', { action: 'disconnected', code: event.code, reason: event.reason });
          this.isConnecting = false;
          this.stopHeartbeat();
          this.emit('disconnected', { code: event.code, reason: event.reason });
          
          if (this.config.enableAutoReconnect && !event.wasClean) {
            this.scheduleReconnect();
          }
        };
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.config.enableAutoReconnect = false;
    this.stopHeartbeat();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.subscriptions.clear();
    this.messageQueue = [];
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(message: WebSocketMessage): void {
    if (message.type === 'pong') {
      // Heartbeat response
      return;
    }

    if (message.type === 'event') {
      const event: RealtimeEvent = {
        type: message.eventType as EventType,
        entityType: message.entityType as EntityType,
        entityId: message.entityId as string,
        data: message.data as Record<string, unknown> | undefined,
        timestamp: new Date(message.timestamp as string)
      };

      this.emit('event', event);
      this.notifySubscribers(event);
    }
  }

  /**
   * Send message to server
   */
  send(message: WebSocketMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue message for later
      this.messageQueue.push(message);
    }
  }

  /**
   * Subscribe to specific entity changes
   */
  subscribe(
    entityType: EntityType,
    entityId: string | '*',
    callback: (event: RealtimeEvent) => void
  ): () => void {
    const key = `${entityType}:${entityId}`;
    
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set());
    }
    
    this.subscriptions.get(key)!.add(callback);

    // Send subscription message to server
    this.send({
      type: 'subscribe',
      entityType,
      entityId
    });

    // Return unsubscribe function
    return () => {
      const subs = this.subscriptions.get(key);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.subscriptions.delete(key);
          this.send({
            type: 'unsubscribe',
            entityType,
            entityId
          });
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
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      log.error('websocketService', { action: 'reconnectFailed', message: 'Max reconnection attempts reached' });
      this.emit('reconnect_failed');
      return;
    }

    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(2, this.reconnectAttempts),
      30000
    );

    this.reconnectAttempts++;
    log.debug('websocketService', { action: 'reconnecting', delay, attempt: this.reconnectAttempts });

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(error => {
        log.error('websocketService', { action: 'reconnectAttemptFailed', error });
      });
    }, delay);
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' });
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Flush message queue after reconnection
   */
  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message !== undefined) {
        this.send(message);
      }
    }
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection state
   */
  getReadyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }
}

// Export singleton instance
export const websocketService = new WebSocketService();

// Export class for testing
export { WebSocketService };