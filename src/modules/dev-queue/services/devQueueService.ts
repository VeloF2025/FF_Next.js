/**
 * DevQueue Service
 * Handles all devQueue-related API operations
 */

import { log } from '@/lib/logger';
import type {
  DevQueueBoard,
  DevQueueItem,
  CreateDevQueueItemInput,
  UpdateDevQueueItemInput,
  MoveDevQueueItemInput,
} from '../types/devQueue';

class DevQueueService {
  private baseUrl = '/api/dev-queue';

  /**
   * Get the complete devQueue board with columns and items
   */
  async getBoard(): Promise<DevQueueBoard> {
    try {
      const response = await fetch(this.baseUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch devQueue board: ${response.statusText}`);
      }
      const data = await response.json();
      return data.data || { columns: [], stats: {} };
    } catch (error) {
      log.error('Error fetching devQueue board:', error, 'DevQueueService');
      throw error;
    }
  }

  /**
   * Get a single devQueue item with details
   */
  async getItem(id: string): Promise<{ item: DevQueueItem; comments: unknown[] }> {
    try {
      const response = await fetch(`${this.baseUrl}/${id}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch devQueue item: ${response.statusText}`);
      }
      const data = await response.json();
      return data.data;
    } catch (error) {
      log.error('Error fetching devQueue item:', error, 'DevQueueService');
      throw error;
    }
  }

  /**
   * Create a new devQueue item
   */
  async create(input: CreateDevQueueItemInput): Promise<DevQueueItem> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create devQueue item');
      }

      const data = await response.json();
      return data.data;
    } catch (error) {
      log.error('Error creating devQueue item:', error, 'DevQueueService');
      throw error;
    }
  }

  /**
   * Update an existing devQueue item
   */
  async update(id: string, updates: UpdateDevQueueItemInput): Promise<DevQueueItem> {
    try {
      const response = await fetch(`${this.baseUrl}/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update devQueue item');
      }

      const data = await response.json();
      return data.data;
    } catch (error) {
      log.error('Error updating devQueue item:', error, 'DevQueueService');
      throw error;
    }
  }

  /**
   * Delete a devQueue item
   */
  async delete(id: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete devQueue item');
      }
    } catch (error) {
      log.error('Error deleting devQueue item:', error, 'DevQueueService');
      throw error;
    }
  }

  /**
   * Move an item between columns
   */
  async move(input: MoveDevQueueItemInput): Promise<DevQueueItem> {
    try {
      const response = await fetch(`${this.baseUrl}/move`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to move devQueue item');
      }

      const data = await response.json();
      return data.data.item;
    } catch (error) {
      log.error('Error moving devQueue item:', error, 'DevQueueService');
      throw error;
    }
  }

  /**
   * Vote on a devQueue item (toggle vote)
   */
  async vote(itemId: string): Promise<{ voted: boolean; votes: number }> {
    try {
      const response = await fetch(`${this.baseUrl}/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ itemId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to vote on devQueue item');
      }

      const data = await response.json();
      return {
        voted: data.data.voted,
        votes: data.data.votes || 0,
      };
    } catch (error) {
      log.error('Error voting on devQueue item:', error, 'DevQueueService');
      throw error;
    }
  }

  /**
   * Add a comment to a devQueue item
   */
  async addComment(itemId: string, comment: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/${itemId}/comment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ comment }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add comment');
      }
    } catch (error) {
      log.error('Error adding comment:', error, 'DevQueueService');
      throw error;
    }
  }

  /**
   * Update column settings (WIP limits, names, positions)
   */
  async updateColumns(columns: Array<{
    id: string;
    name: string;
    color: string;
    wip_limit: number | null;
    position: number;
    isNew?: boolean;
  }>): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/columns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ columns }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update columns');
      }
    } catch (error) {
      log.error('Error updating columns:', error, 'DevQueueService');
      throw error;
    }
  }
}

// Export singleton instance
export const devQueueService = new DevQueueService();