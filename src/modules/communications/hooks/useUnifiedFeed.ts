/**
 * Hook for unified feed data fetching
 * Fetches from /api/communications/feed with channel filtering and pagination
 */

import { useState, useEffect, useCallback } from 'react';
import { log } from '@/lib/logger';
import type { FeedItem } from '../types/hub.types';

const PAGE_SIZE = 30;

type Channel = 'message' | 'email' | 'notification' | 'meeting';

interface FeedCounts {
  message: number;
  email: number;
  notification: number;
  meeting: number;
}

interface UseUnifiedFeedReturn {
  items: FeedItem[];
  isLoading: boolean;
  hasMore: boolean;
  total: number;
  counts: FeedCounts;
  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
}

export function useUnifiedFeed(channels?: Channel[]): UseUnifiedFeedReturn {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [counts, setCounts] = useState<FeedCounts>({
    message: 0,
    email: 0,
    notification: 0,
    meeting: 0,
  });

  const channelsKey = channels ? channels.sort().join(',') : 'all';

  const fetchFeed = useCallback(async (reset = false) => {
    setIsLoading(true);
    const currentOffset = reset ? 0 : offset;

    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(currentOffset),
      });

      if (channels && channels.length > 0) {
        params.set('channels', channels.join(','));
      }

      const res = await fetch(`/api/communications/feed?${params}`, {
        credentials: 'include',
      });
      const json = await res.json();

      if (json.success) {
        const newItems: FeedItem[] = json.data.items;
        if (reset) {
          setItems(newItems);
          setOffset(newItems.length);
        } else {
          setItems(prev => [...prev, ...newItems]);
          setOffset(currentOffset + newItems.length);
        }
        setTotal(json.data.total);
        setCounts(json.data.counts);
        setHasMore(newItems.length === PAGE_SIZE);
      }
    } catch (err) {
      log.error('Failed to fetch unified feed:', err);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, channelsKey]);

  // Refetch on channel filter change
  useEffect(() => {
    fetchFeed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelsKey]);

  return {
    items,
    isLoading,
    hasMore,
    total,
    counts,
    refetch: () => fetchFeed(true),
    loadMore: () => fetchFeed(false),
  };
}
