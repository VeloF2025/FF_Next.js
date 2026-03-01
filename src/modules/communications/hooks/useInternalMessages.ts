/**
 * Hook for internal messages data fetching
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { log } from '@/lib/logger';
import type { MessageListItem, MessageView } from '../types/messaging.types';

const PAGE_SIZE = 20;
const UNREAD_POLL_MS = 30_000;

interface UseInternalMessagesReturn {
  messages: MessageListItem[];
  isLoading: boolean;
  hasMore: boolean;
  total: number;
  unreadCount: number;
  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
  markRead: (messageIds: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
  archiveMessages: (messageIds: string[]) => Promise<void>;
}

export function useInternalMessages(view: MessageView): UseInternalMessagesReturn {
  const [messages, setMessages] = useState<MessageListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const fetchMessages = useCallback(async (reset = false) => {
    setIsLoading(true);
    const currentOffset = reset ? 0 : offset;
    try {
      const params = new URLSearchParams({
        view,
        limit: String(PAGE_SIZE),
        offset: String(currentOffset),
      });

      const res = await fetch(`/api/communications/messages?${params}`, {
        credentials: 'include',
      });
      const json = await res.json();

      if (json.success) {
        const items: MessageListItem[] = json.data.messages;
        if (reset) {
          setMessages(items);
          setOffset(items.length);
        } else {
          setMessages(prev => [...prev, ...items]);
          setOffset(currentOffset + items.length);
        }
        setTotal(json.data.total);
        setHasMore(items.length === PAGE_SIZE);
      }
    } catch (err) {
      log.error('Failed to fetch messages:', err);
    } finally {
      setIsLoading(false);
    }
  }, [offset, view]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch('/api/communications/messages-unread-count', {
        credentials: 'include',
      });
      const json = await res.json();
      if (json.success) {
        setUnreadCount(json.data.count);
      }
    } catch {
      // Silently ignore polling errors
    }
  }, []);

  const markRead = useCallback(async (messageIds: string[]) => {
    try {
      await fetch('/api/communications/messages-read', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ messageIds }),
      });
      // Optimistic update
      setMessages(prev =>
        prev.map(m =>
          messageIds.includes(m.id) ? { ...m, is_read: true } : m
        )
      );
      setUnreadCount(prev => Math.max(0, prev - messageIds.length));
    } catch (err) {
      log.error('Failed to mark messages as read:', err);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const unreadIds = messages.filter(m => !m.is_read).map(m => m.id);
    if (unreadIds.length === 0) return;
    await markRead(unreadIds);
  }, [messages, markRead]);

  const archiveMessages = useCallback(async (messageIds: string[]) => {
    try {
      await fetch('/api/communications/messages-archive', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ messageIds }),
      });
      // Remove from current list
      setMessages(prev => prev.filter(m => !messageIds.includes(m.id)));
      setTotal(prev => prev - messageIds.length);
    } catch (err) {
      log.error('Failed to archive messages:', err);
    }
  }, []);

  // Fetch messages on mount and when view changes
  useEffect(() => {
    fetchMessages(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Poll unread count
  useEffect(() => {
    fetchUnreadCount();
    pollRef.current = setInterval(fetchUnreadCount, UNREAD_POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchUnreadCount]);

  return {
    messages,
    isLoading,
    hasMore,
    total,
    unreadCount,
    refetch: () => fetchMessages(true),
    loadMore: () => fetchMessages(false),
    markRead,
    markAllRead,
    archiveMessages,
  };
}
