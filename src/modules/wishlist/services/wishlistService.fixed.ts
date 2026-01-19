/**
 * Wishlist Service - API communication layer
 */

import type {
  WishlistBoard,
  WishlistItem,
  CreateWishlistItemInput,
  UpdateWishlistItemInput,
} from '../types/wishlist';

class WishlistService {
  private baseUrl = '/api/wishlist';

  async getBoard(): Promise<WishlistBoard> {
    const response = await fetch(this.baseUrl, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to fetch wishlist board');
    }

    const data = await response.json();
    return data.data;
  }

  async createItem(input: CreateWishlistItemInput): Promise<WishlistItem> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error('Failed to create wishlist item');
    }

    const data = await response.json();
    return data.data;
  }

  async updateItem(id: string, input: UpdateWishlistItemInput): Promise<WishlistItem> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error('Failed to update wishlist item');
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
      throw new Error('Failed to move wishlist item');
    }
  }

  async voteItem(itemId: string): Promise<WishlistItem> {
    const response = await fetch(`${this.baseUrl}/vote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ itemId }),
    });

    if (!response.ok) {
      throw new Error('Failed to vote on wishlist item');
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
      throw new Error('Failed to delete wishlist item');
    }
  }
}

export const wishlistService = new WishlistService();
