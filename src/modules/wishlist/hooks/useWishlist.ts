/**
 * Custom hook for wishlist data management
 */

import { useState, useEffect, useCallback } from 'react';
import { wishlistService } from '../services/wishlistService';
import { notificationService } from '@/services/core/NotificationService';
import type { WishlistBoard, CreateWishlistItemInput } from '../types/wishlist';

export function useWishlist() {
  const [board, setBoard] = useState<WishlistBoard>({
    columns: [],
    stats: {
      total: 0,
      totalVotes: 0,
      inProgress: 0,
      completed: 0,
      byPriority: { low: 0, medium: 0, high: 0 },
      byStatus: {},
    },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Calculate stats from columns
  const calculateStats = (columns: any[]) => {
    let total = 0;
    let totalVotes = 0;
    let inProgress = 0;
    let completed = 0;
    const byPriority = { low: 0, medium: 0, high: 0 };
    const byStatus: Record<string, number> = {};

    columns.forEach(column => {
      const itemCount = column.items?.length || 0;
      byStatus[column.name] = itemCount;
      total += itemCount;

      column.items?.forEach((item: any) => {
        totalVotes += item.votes || 0;

        if (item.priority) {
          byPriority[item.priority as keyof typeof byPriority] =
            (byPriority[item.priority as keyof typeof byPriority] || 0) + 1;
        }

        if (column.name === 'In Progress') {
          inProgress++;
        } else if (column.name === 'Completed') {
          completed++;
        }
      });
    });

    return {
      total,
      totalVotes,
      inProgress,
      completed,
      byPriority,
      byStatus,
    };
  };

  // Fetch board data
  const fetchBoard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await wishlistService.getBoard();

      // Calculate stats from columns data
      const stats = calculateStats(data.columns || []);

      setBoard({
        ...data,
        stats,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load wishlist';
      setError(message);
      notificationService.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Create new item
  const createItem = useCallback(async (input: CreateWishlistItemInput) => {
    try {
      const newItem = await wishlistService.create(input);
      notificationService.success('Wishlist item created successfully');

      // Refresh board to show new item
      await fetchBoard();

      return newItem;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create item';
      notificationService.error(message);
      throw err;
    }
  }, [fetchBoard]);

  // Move item between columns
  const moveItem = useCallback(async (itemId: string, targetColumn: string, position: number) => {
    // Optimistically update the UI
    setBoard(prevBoard => {
      const newColumns = [...prevBoard.columns];
      let movedItem: any = null;

      // Find and remove the item from its current column
      for (const column of newColumns) {
        const itemIndex = column.items.findIndex(item => item.id === itemId);
        if (itemIndex !== -1) {
          movedItem = column.items[itemIndex];
          column.items.splice(itemIndex, 1);
          break;
        }
      }

      // Add the item to the target column
      if (movedItem) {
        const targetCol = newColumns.find(col => col.name === targetColumn);
        if (targetCol) {
          movedItem.status = targetColumn;
          targetCol.items.splice(position, 0, movedItem);
        }
      }

      return {
        ...prevBoard,
        columns: newColumns,
      };
    });

    try {
      // Update on the server
      await wishlistService.move({ itemId, targetColumn, position });
    } catch (err) {
      // Revert on error
      await fetchBoard();
      const message = err instanceof Error ? err.message : 'Failed to move item';
      notificationService.error(message);
    }
  }, [fetchBoard]);

  // Vote on item
  const voteItem = useCallback(async (itemId: string) => {
    try {
      const result = await wishlistService.vote(itemId);

      // Update the item in the board
      setBoard(prevBoard => {
        const newColumns = prevBoard.columns.map(column => ({
          ...column,
          items: column.items.map(item => {
            if (item.id === itemId) {
              return {
                ...item,
                has_voted: result.voted,
                votes: result.votes,
              };
            }
            return item;
          }),
        }));

        // Update stats
        const newStats = { ...prevBoard.stats };
        if (result.voted) {
          newStats.totalVotes++;
        } else {
          newStats.totalVotes = Math.max(0, newStats.totalVotes - 1);
        }

        return {
          columns: newColumns,
          stats: newStats,
        };
      });

      notificationService.success(result.voted ? 'Vote recorded' : 'Vote removed');
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to vote';
      notificationService.error(message);
      throw err;
    }
  }, []);

  // Delete item
  const deleteItem = useCallback(async (itemId: string) => {
    try {
      await wishlistService.delete(itemId);
      notificationService.success('Item deleted successfully');
      await fetchBoard();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete item';
      notificationService.error(message);
      throw err;
    }
  }, [fetchBoard]);

  // Load data on mount
  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchBoard, 30000);
    return () => clearInterval(interval);
  }, [fetchBoard]);

  return {
    board,
    loading,
    error,
    refetch: fetchBoard,
    createItem,
    moveItem,
    voteItem,
    deleteItem,
  };
}