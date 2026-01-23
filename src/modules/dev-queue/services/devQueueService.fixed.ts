/**
 * DevQueue Service - API communication layer
 */

import type {
  DevQueueBoard,
  DevQueueItem,
  CreateDevQueueItemInput,
  UpdateDevQueueItemInput,
} from '../types/devQueue';

class DevQueueService {
  private baseUrl = '/api/devQueue';

  async getBoard(): Promise<DevQueueBoard> {
    const response = await fetch(this.baseUrl, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to fetch devQueue board');
    }

    const data = await response.json();
    return data.data;
  }

  async createItem(input: CreateDevQueueItemInput): Promise<DevQueueItem> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error('Failed to create devQueue item');
    }

    const data = await response.json();
    return data.data;
  }

  async updateItem(id: string, input: UpdateDevQueueItemInput): Promise<DevQueueItem> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error('Failed to update devQueue item');
    }

    const data = await response.json();
    return data.data;
  }

  async moveItem(itemId: string, targetColumn: string, position: number): Promise<void> {
    const response = await fetch(`${this.baseUrl}/move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ itemId, targetColumn, position }),
    });

    if (!response.ok) {
      throw new Error('Failed to move devQueue item');
    }
  }

  async voteItem(itemId: string): Promise<DevQueueItem> {
    const response = await fetch(`${this.baseUrl}/vote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ itemId }),
    });

    if (!response.ok) {
      throw new Error('Failed to vote on devQueue item');
    }

    const data = await response.json();
    return data.data;
  }

  async deleteItem(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to delete devQueue item');
    }
  }
}

export const devQueueService = new DevQueueService();
