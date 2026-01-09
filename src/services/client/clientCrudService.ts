import {
  Client,
  ClientFormData,
  ClientFilter
} from '@/types/client.types';

/**
 * Core CRUD operations for client management
 *
 * NOTE: Firebase Firestore has been removed. This service now uses API endpoints.
 * TODO: Create /api/clients endpoints for full functionality
 */

type Unsubscribe = () => void;

export const clientCrudService = {
  /**
   * Get all clients with optional filtering
   */
  async getAll(filter?: ClientFilter): Promise<Client[]> {
    try {
      const params = new URLSearchParams();

      if (filter?.status?.length) {
        params.append('status', filter.status.join(','));
      }
      if (filter?.category?.length) {
        params.append('category', filter.category.join(','));
      }
      if (filter?.priority?.length) {
        params.append('priority', filter.priority.join(','));
      }
      if (filter?.accountManagerId) {
        params.append('accountManagerId', filter.accountManagerId);
      }
      if (filter?.city) {
        params.append('city', filter.city);
      }
      if (filter?.province) {
        params.append('province', filter.province);
      }
      if (filter?.searchTerm) {
        params.append('search', filter.searchTerm);
      }

      const queryString = params.toString() ? `?${params.toString()}` : '';
      const response = await fetch(`/api/clients${queryString}`);

      if (!response.ok) {
        throw new Error('Failed to fetch clients');
      }

      const result = await response.json();
      return result.data || result.clients || [];
    } catch (error) {
      console.error('Error getting clients:', error);
      throw new Error('Failed to fetch clients');
    }
  },

  /**
   * Get client by ID
   */
  async getById(id: string): Promise<Client | null> {
    try {
      const response = await fetch(`/api/clients/${id}`);

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error('Failed to fetch client');
      }

      const result = await response.json();
      return result.data || result.client || null;
    } catch (error) {
      console.error('Error getting client:', error);
      throw new Error('Failed to fetch client');
    }
  },

  /**
   * Create new client
   */
  async create(data: ClientFormData): Promise<string> {
    try {
      const response = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error('Failed to create client');
      }

      const result = await response.json();
      return result.data?.id || result.id;
    } catch (error) {
      console.error('Error creating client:', error);
      throw new Error('Failed to create client');
    }
  },

  /**
   * Update client
   */
  async update(id: string, data: Partial<ClientFormData>): Promise<void> {
    try {
      const response = await fetch(`/api/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error('Failed to update client');
      }
    } catch (error) {
      console.error('Error updating client:', error);
      throw new Error('Failed to update client');
    }
  },

  /**
   * Delete client
   */
  async delete(id: string): Promise<void> {
    try {
      const response = await fetch(`/api/clients/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to delete client');
      }
    } catch (error) {
      console.error('Error deleting client:', error);
      throw new Error('Failed to delete client');
    }
  },

  /**
   * Subscribe to clients changes
   * NOTE: Real-time subscriptions are not supported without Firebase.
   * This will perform an initial fetch and return a no-op unsubscribe.
   */
  subscribeToClients(
    callback: (clients: Client[]) => void,
    filter?: ClientFilter
  ): Unsubscribe {
    // Perform initial fetch
    this.getAll(filter)
      .then(callback)
      .catch(err => console.error('Error in client subscription:', err));

    // Return no-op unsubscribe
    return () => {};
  },

  /**
   * Subscribe to single client changes
   * NOTE: Real-time subscriptions are not supported without Firebase.
   * This will perform an initial fetch and return a no-op unsubscribe.
   */
  subscribeToClient(
    clientId: string,
    callback: (client: Client | null) => void
  ): Unsubscribe {
    // Perform initial fetch
    this.getById(clientId)
      .then(callback)
      .catch(err => console.error('Error in client subscription:', err));

    // Return no-op unsubscribe
    return () => {};
  }
};
