/**
 * TanStack Query Hooks for Notifications
 * @module notifications/hooks/useNotifications
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserNotification } from '../types';

const QUERY_KEYS = {
  unreadCount: ['notifications', 'unread-count'],
  list: (limit: number) => ['notifications', 'list', limit],
};

/** Fetch helper with standard error handling */
async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error?.error?.message || `Request failed: ${res.status}`);
  }
  const json = await res.json();
  return json.data ?? json;
}

// =============================================================================
// Queries
// =============================================================================

/** Poll unread notification count every 30s for the bell badge */
export function useUnreadCount() {
  return useQuery<number>({
    queryKey: QUERY_KEYS.unreadCount,
    queryFn: () => apiFetch<number>('/api/notifications/unread-count'),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/** Fetch notification list (triggered when dropdown opens) */
export function useNotificationList(limit = 20) {
  return useQuery<UserNotification[]>({
    queryKey: QUERY_KEYS.list(limit),
    queryFn: () => apiFetch<UserNotification[]>(`/api/notifications?limit=${limit}`),
    staleTime: 15_000,
  });
}

// =============================================================================
// Mutations
// =============================================================================

/** Mark specific notification IDs as read */
export function useMarkAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationIds: string[]) => {
      return apiFetch<{ updated: number }>('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_ids: notificationIds }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.unreadCount });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'list'] });
    },
  });
}

/** Mark all notifications as read */
export function useMarkAllAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return apiFetch<{ updated: number }>('/api/notifications/mark-all-read', {
        method: 'POST',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.unreadCount });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'list'] });
    },
  });
}
