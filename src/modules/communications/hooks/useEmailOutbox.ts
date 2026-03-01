/**
 * Hook for email outbox data fetching
 */

import { useState, useEffect, useCallback } from 'react';
import { log } from '@/lib/logger';
import type { EmailOutboxItem, EmailOutboxFilters } from '../types/email.types';

const PAGE_SIZE = 20;

interface UseEmailOutboxReturn {
  emails: EmailOutboxItem[];
  isLoading: boolean;
  hasMore: boolean;
  total: number;
  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
}

export function useEmailOutbox(filters?: EmailOutboxFilters): UseEmailOutboxReturn {
  const [emails, setEmails] = useState<EmailOutboxItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);

  const fetchEmails = useCallback(async (reset = false) => {
    setIsLoading(true);
    const currentOffset = reset ? 0 : offset;
    try {
      const params = new URLSearchParams({
        limit: String(filters?.limit || PAGE_SIZE),
        offset: String(currentOffset),
      });
      if (filters?.status) params.set('status', filters.status);
      if (filters?.sourceModule) params.set('source_module', filters.sourceModule);

      const res = await fetch(`/api/communications/email-outbox?${params}`, {
        credentials: 'include',
      });
      const json = await res.json();

      if (json.success) {
        const items: EmailOutboxItem[] = json.data.emails;
        if (reset) {
          setEmails(items);
          setOffset(items.length);
        } else {
          setEmails(prev => [...prev, ...items]);
          setOffset(currentOffset + items.length);
        }
        setTotal(json.data.total);
        setHasMore(items.length === (filters?.limit || PAGE_SIZE));
      }
    } catch (err) {
      log.error('Failed to fetch email outbox:', err);
    } finally {
      setIsLoading(false);
    }
  }, [offset, filters?.status, filters?.sourceModule, filters?.limit]);

  useEffect(() => {
    fetchEmails(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters?.status, filters?.sourceModule]);

  return {
    emails,
    isLoading,
    hasMore,
    total,
    refetch: () => fetchEmails(true),
    loadMore: () => fetchEmails(false),
  };
}
