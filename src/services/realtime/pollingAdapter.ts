/**
 * Polling Adapter for Real-time Updates
 * Fallback mechanism when LISTEN/NOTIFY is not available
 */

import { EventEmitter } from 'events';
import type { EntityType, RealtimeEvent } from './websocketService';
import { log } from '@/lib/logger';

export interface PollingConfig {
  pollInterval?: number;
  apiUrl?: string;
  enabled?: boolean;
}

class PollingAdapter extends EventEmitter {
  private config: Required<PollingConfig>;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastChecked: Date | null = null;
  private isPolling = false;
  private clientId: string;
  private subscriptions = new Map<string, Set<(event: RealtimeEvent) => void>>();

  constructor(config: PollingConfig = {}) {
    super();
    this.config = {
      pollInterval: config.pollInterval || 3000, // Poll every 3 seconds
      apiUrl: config.apiUrl || '/api/realtime/poll',
      enabled: config.enabled !== false
    };
    this.clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Start polling for changes
   */
  start(): void {
    if (!this.config.enabled || this.isPolling) return;
    
    this.isPolling = true;
    this.poll();
    
    // Set up polling interval
    this.pollTimer = setInterval(() => {
      this.poll();
    }, this.config.pollInterval);
    
    log.debug('pollingAdapter', { action: 'started' });
    this.emit('connected');
  }

  /**
   * Stop polling
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    
    this.isPolling = false;
    this.subscriptions.clear();
    
    log.debug('pollingAdapter', { action: 'stopped' });
    this.emit('disconnected');
  }

  /**
   * Poll for changes
   */
  private async poll(): Promise<void> {
    if (!this.isPolling) return;
    
    try {
      const params = new URLSearchParams({
        clientId: this.clientId
      });
      
      if (this.lastChecked) {
        params.append('since', this.lastChecked.toISOString());
      }
      
      const response = await fetch(`${this.config.apiUrl}?${params}`);
      
      if (!response.ok) {
        throw new Error(`Polling failed: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.changes && data.changes.length > 0) {
        // Process each change
        data.changes.forEach((change: any) => {
          const event: RealtimeEvent = {
            type: this.mapEventType(change.event_type),
            entityType: change.entity_type as EntityType,
            entityId: change.entity_id?.toString() || '',
            data: change.data,
            timestamp: new Date(change.timestamp)
          };
          
          this.emit('event', event);
          this.notifySubscribers(event);
        });
      }
      
      this.lastChecked = new Date(data.lastChecked);
      
    } catch (error) {
      log.error('pollingAdapter', { action: 'poll', error });
      this.emit('error', error);
    }
  }

  /**
   * Map database event type to our event type
   */
  private mapEventType(dbEventType: string): 'added' | 'modified' | 'removed' {
    switch (dbEventType?.toLowerCase()) {
      case 'insert':
      case 'added':
        return 'added';
      case 'delete':
      case 'removed':
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
    }
    
    this.subscriptions.get(key)!.add(callback);
    
    // Start polling if not already started
    if (!this.isPolling) {
      this.start();
    }
    
    // Return unsubscribe function
    return () => {
      const subs = this.subscriptions.get(key);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.subscriptions.delete(key);
        }
      }
      
      // Stop polling if no more subscriptions
      if (this.subscriptions.size === 0) {
        this.stop();
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
   * Check if polling is active
   */
  isActive(): boolean {
    return this.isPolling;
  }

  /**
   * Force a poll immediately
   */
  forcePoll(): void {
    if (this.isPolling) {
      this.poll();
    }
  }
}

// Export singleton instance
export const pollingAdapter = new PollingAdapter();

// Export class for testing
export { PollingAdapter };