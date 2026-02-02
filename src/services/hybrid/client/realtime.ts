/**
 * Real-time Client Operations (WebSocket)
 */

import { socketIOAdapter } from '@/services/realtime/socketIOAdapter';
import type { RealtimeEvent } from '@/services/realtime/websocketService';
import type { Client } from '@/types/client.types';
import { log } from '@/lib/logger';

/**
 * Get all clients (via API)
 */
export async function getAllClients(): Promise<Client[]> {
  const response = await fetch('/api/clients');
  if (!response.ok) {
    throw new Error('Failed to fetch clients');
  }
  return response.json();
}

/**
 * Get client by ID (via API)
 */
export async function getClientById(id: string): Promise<Client | null> {
  const response = await fetch(`/api/clients/${id}`);
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error('Failed to fetch client');
  }
  return response.json();
}

/**
 * Create new client (via API)
 */
export async function createClient(clientData: Omit<Client, 'id'>): Promise<string> {
  const response = await fetch('/api/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...clientData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to create client');
  }

  const result = await response.json();
  
  // Broadcast change via WebSocket
  socketIOAdapter.broadcastChange({
    eventType: 'added',
    entityType: 'client',
    entityId: result.id,
    data: { ...clientData, id: result.id }
  });

  return result.id;
}

/**
 * Update client (via API)
 */
export async function updateClient(id: string, updates: Partial<Client>): Promise<void> {
  const response = await fetch(`/api/clients/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...updates,
      updatedAt: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to update client');
  }

  // Broadcast change via WebSocket
  socketIOAdapter.broadcastChange({
    eventType: 'modified',
    entityType: 'client',
    entityId: id,
    data: updates
  });
}

/**
 * Subscribe to client changes (real-time via WebSocket)
 */
export function subscribeToClient(id: string, callback: (client: Client | null) => void): () => void {
  // Ensure WebSocket is connected
  if (!socketIOAdapter.isConnected()) {
    socketIOAdapter.connect().catch(err => log.error('Failed to connect WebSocket', { data: err }, 'clientRealtime'));
  }

  // Subscribe to specific client changes
  const unsubscribe = socketIOAdapter.subscribe(
    'client',
    id,
    async (event: RealtimeEvent) => {
      if (event.type === 'removed') {
        callback(null);
      } else {
        // Fetch fresh data for added/modified events
        try {
          const client = await getClientById(id);
          callback(client);
        } catch (error) {
          log.error('Error fetching client data', { data: error }, 'clientRealtime');
          callback(null);
        }
      }
    }
  );

  // Fetch initial data
  getClientById(id).then(callback).catch(() => callback(null));

  return unsubscribe;
}

/**
 * Subscribe to clients list (real-time via WebSocket)
 */
export function subscribeToClients(callback: (clients: Client[]) => void): () => void {
  // Ensure WebSocket is connected
  if (!socketIOAdapter.isConnected()) {
    socketIOAdapter.connect().catch(err => log.error('Failed to connect WebSocket', { data: err }, 'clientRealtime'));
  }

  // Subscribe to all client changes
  const unsubscribe = socketIOAdapter.subscribeToAll(
    'client',
    async (event: RealtimeEvent) => {
      // Re-fetch the entire list on any change
      try {
        const clients = await getAllClients();
        callback(clients);
      } catch (error) {
        log.error('Error fetching clients list', { data: error }, 'clientRealtime');
        callback([]);
      }
    }
  );

  // Fetch initial data
  getAllClients().then(callback).catch(() => callback([]));

  return unsubscribe;
}