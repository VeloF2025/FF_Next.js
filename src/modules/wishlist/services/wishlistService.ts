/**
 * Wishlist Service
 * Handles all wishlist-related API operations
 */

import { log } from '@/lib/logger';
import type {
  WishlistBoard,
  WishlistItem,
  CreateWishlistItemInput,
  UpdateWishlistItemInput,
  MoveWishlistItemInput,
  WishlistApiResponse
} from '../types/wishlist';

class WishlistService {
  private baseUrl = '/api/wishlist';

  /**
   * Get the complete wishlist board with columns and items
   */
  async getBoard(): Promise<WishlistBoard> {
    try {
      const response = await fetch(this.baseUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch wishlist board: ${response.statusText}`);
      }
      const data = await response.json();
      return data.data || { columns: [], stats: {} };
    } catch (error) {
      log.error('Error fetching wishlist board:', error, 'WishlistService');
      throw error;
    }
  }

  /**
   * Get a single wishlist item with details
   */
  async getItem(id: string): Promise<{ item: WishlistItem; comments: any[] }> {
    try {
      const response = await fetch(`${this.baseUrl}/${id}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch wishlist item: ${response.statusText}`);
      }
      const data = await response.json();
      return data.data;
    } catch (error) {
      log.error('Error fetching wishlist item:', error, 'WishlistService');
      throw error;
    }
  }

  /**
   * Create a new wishlist item
   */
  async create(input: CreateWishlistItemInput): Promise<WishlistItem> {
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
        throw new Error(errorData.error || 'Failed to create wishlist item');
      }

      const data = await response.json();
      return data.data;
    } catch (error) {
      log.error('Error creating wishlist item:', error, 'WishlistService');
      throw error;
    }
  }

  /**
   * Update an existing wishlist item
   */
  async update(id: string, updates: UpdateWishlistItemInput): Promise<WishlistItem> {
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
        throw new Error(errorData.error || 'Failed to update wishlist item');
      }

      const data = await response.json();
      return data.data;
    } catch (error) {
      log.error('Error updating wishlist item:', error, 'WishlistService');
      throw error;
    }
  }

  /**
   * Delete a wishlist item
   */
  async delete(id: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete wishlist item');
      }
    } catch (error) {
      log.error('Error deleting wishlist item:', error, 'WishlistService');
      throw error;
    }
  }

  /**
   * Move an item between columns
   */
  async move(input: MoveWishlistItemInput): Promise<WishlistItem> {
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
        throw new Error(errorData.error || 'Failed to move wishlist item');
      }

      const data = await response.json();
      return data.data.item;
    } catch (error) {
      log.error('Error moving wishlist item:', error, 'WishlistService');
      throw error;
    }
  }

  /**
   * Vote on a wishlist item (toggle vote)
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
        throw new Error(errorData.error || 'Failed to vote on wishlist item');
      }

      const data = await response.json();
      return {
        voted: data.data.voted,
        votes: data.data.votes || 0,
      };
    } catch (error) {
      log.error('Error voting on wishlist item:', error, 'WishlistService');
      throw error;
    }
  }

  /**
   * Add a comment to a wishlist item
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
      log.error('Error adding comment:', error, 'WishlistService');
      throw error;
    }
  }
}

// Export singleton instance
export const wishlistService = new WishlistService();