/**
 * Custom hook for wishlist data management
 */

import { useState, useEffect, useCallback, useRef } from 'react';
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

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);
  // AbortController for cancelling in-flight requests
  const abortControllerRef = useRef<AbortController | null>(null);

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

  // Fetch board data with cancellation support
  const fetchBoard = useCallback(async () => {
    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();

    try {
      if (isMountedRef.current) {
        setLoading(true);
        setError(null);
      }

      const data = await wishlistService.getBoard();

      // Only update state if component is still mounted
      if (!isMountedRef.current) return;

      // Calculate stats from columns data
      const stats = calculateStats(data.columns || []);

      setBoard({
        ...data,
        stats,
      });
    } catch (err) {
      // Ignore abort errors (expected when cancelling)
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      // Only show error if component is still mounted
      if (!isMountedRef.current) return;

      const message = err instanceof Error ? err.message : 'Failed to load wishlist';
      setError(message);
      // Don't show notification for background refresh failures
      if (loading) {
        notificationService.error(message);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [loading]);

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

  // Track mounted state and load data on mount
  useEffect(() => {
    isMountedRef.current = true;
    fetchBoard();

    // Cleanup on unmount
    return () => {
      isMountedRef.current = false;
      // Cancel any in-flight requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 30 seconds (only when mounted)
  useEffect(() => {
    const interval = setInterval(() => {
      if (isMountedRef.current) {
        fetchBoard();
      }
    }, 30000);

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