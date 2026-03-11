/**
 * Client API Service
 * Uses Vercel API routes instead of direct database access
 */

import { Client, ClientFilter, ClientSummary } from '@/types/client.types';
import { log } from '@/lib/logger';

const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:3000/api' : '/api';

export const clientApi = {
  /**
   * Get all clients with optional filtering
   */
  async getAll(filter?: ClientFilter): Promise<Client[]> {
    try {
      let url = `${API_BASE}/clients`;
      const params = new URLSearchParams();

      if (filter) {
        if (filter.status?.length && filter.status.length > 0) {
          params.append('status', filter.status[0] as string);
        }
        if (filter.searchTerm) {
          params.append('search', filter.searchTerm);
        }
      }

      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch clients: ${response.status}`);
      }

      const result = await response.json();
      return result.data || [];
    } catch (error) {
      log.error('Error fetching clients:', { error }, 'clientApi');
      return [];
    }
  },

  /**
   * Get a single client by ID
   */
  async getById(id: string): Promise<Client | null> {
    try {
      const response = await fetch(`${API_BASE}/clients?id=${id}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch client: ${response.status}`);
      }

      const result = await response.json();
      return result.data || null;
    } catch (error) {
      log.error('Error fetching client by ID:', { error, id }, 'clientApi');
      return null;
    }
  },

  /**
   * Get active clients for dropdowns
   * Fetches all clients since status values vary (active, prospect, etc.)
   */
  async getActiveClients(): Promise<Client[]> {
    try {
      // Get all clients - we'll filter client-side if needed
      const response = await fetch(`${API_BASE}/clients`);
      if (!response.ok) {
        throw new Error(`Failed to fetch active clients: ${response.status}`);
      }

      const result = await response.json();
      const clients = result.data || [];

      // Map company_name to name for compatibility with dropdown component
      return clients.map((client: any) => ({
        ...client,
        name: client.name || client.company_name || 'Unnamed Client'
      }));
    } catch (error) {
      log.error('Error fetching active clients:', { error }, 'clientApi');
      return [];
    }
  },

  /**
   * Get client summary statistics
   */
  async getClientSummary(): Promise<ClientSummary> {
    try {
      const response = await fetch(`${API_BASE}/clients/summary`);
      if (!response.ok) {
        throw new Error(`Failed to fetch client summary: ${response.status}`);
      }

      const result = await response.json();
      return result.data || {
        totalClients: 0,
        activeClients: 0,
        inactiveClients: 0,
        prospectClients: 0,
        totalProjectValue: 0,
        averageProjectValue: 0,
        topClientsByValue: [],
        clientsByCategory: {},
        clientsByStatus: {},
        clientsByPriority: {},
        monthlyGrowth: 0,
        conversionRate: 0
      };
    } catch (error) {
      log.error('Error fetching client summary:', { error }, 'clientApi');
      return {
        totalClients: 0,
        activeClients: 0,
        inactiveClients: 0,
        prospectClients: 0,
        totalProjectValue: 0,
        averageProjectValue: 0,
        topClientsByValue: [],
        clientsByCategory: {},
        clientsByStatus: {},
        clientsByPriority: {},
        monthlyGrowth: 0,
        conversionRate: 0
      };
    }
  },

  /**
   * Create a new client
   */
  async create(clientData: Partial<Client>): Promise<Client | null> {
    try {
      const response = await fetch(`${API_BASE}/clients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(clientData),
      });

      if (!response.ok) {
        throw new Error(`Failed to create client: ${response.status}`);
      }

      const result = await response.json();
      return result.data || null;
    } catch (error) {
      log.error('Error creating client:', { error, clientData }, 'clientApi');
      return null;
    }
  },

  /**
   * Update an existing client
   */
  async update(id: string, updates: Partial<Client>): Promise<Client | null> {
    try {
      const response = await fetch(`${API_BASE}/clients?id=${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error(`Failed to update client: ${response.status}`);
      }

      const result = await response.json();
      return result.data || null;
    } catch (error) {
      log.error('Error updating client:', { error, id, updates }, 'clientApi');
      return null;
    }
  },

  /**
   * Delete a client
   */
  async delete(id: string): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/clients?id=${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Failed to delete client: ${response.status}`);
      }

      const result = await response.json();
      return result.success === true;
    } catch (error) {
      log.error('Error deleting client:', { error, id }, 'clientApi');
      return false;
    }
  },
};