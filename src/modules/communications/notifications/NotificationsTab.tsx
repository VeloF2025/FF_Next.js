/**
 * Notifications Tab for the Communications Hub
 * Fetches from /api/notifications (real UNS data), supports mark read, filter by module
 */

import { useState, useEffect, useCallback } from 'react';
import { Bell, CheckCheck, RefreshCw, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { log } from '@/lib/logger';
import type { UserNotification } from '@/modules/notifications/types';
import { NotificationItem } from './NotificationItem';

const MODULE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'procurement', label: 'Procurement' },
  { key: 'qfield', label: 'QField' },
  { key: 'activate', label: 'Activate' },
  { key: 'fleet', label: 'Fleet' },
];

const PAGE_SIZE = 20;

export function NotificationsTab() {
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [moduleFilter, setModuleFilter] = useState('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const fetchNotifications = useCallback(async (reset = false) => {
    const newOffset = reset ? 0 : offset;
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(newOffset),
      });
      if (unreadOnly) params.set('unread_only', 'true');

      const res = await fetch(`/api/notifications?${params}`, {
        credentials: 'include',
      });
      const json = await res.json();

      if (json.success && Array.isArray(json.data)) {
        const items: UserNotification[] = json.data;
        if (reset) {
          setNotifications(items);
          setOffset(items.length);
        } else {
          setNotifications(prev => [...prev, ...items]);
          setOffset(newOffset + items.length);
        }
        setHasMore(items.length === PAGE_SIZE);
      }
    } catch (err) {
      log.error('Failed to fetch notifications:', err);
    } finally {
      setIsLoading(false);
    }
  }, [offset, unreadOnly]);

  // Initial load and when filters change
  useEffect(() => {
    setOffset(0);
    fetchNotifications(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadOnly]);

  const handleMarkRead = async (id: string) => {
    try {
      await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ notification_id: id }),
      });
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n))
      );
    } catch (err) {
      log.error('Failed to mark notification as read:', err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await fetch('/api/notifications/mark-all-read', {
        method: 'POST',
        credentials: 'include',
      });
      setNotifications(prev =>
        prev.map(n => ({ ...n, is_read: true, read_at: new Date().toISOString() }))
      );
    } catch (err) {
      log.error('Failed to mark all notifications as read:', err);
    }
  };

  // Client-side module filter (API doesn't support module param)
  const filteredNotifications =
    moduleFilter === 'all'
      ? notifications
      : notifications.filter(n => n.source_module === moduleFilter);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          <h3 className="text-sm font-medium text-[var(--ff-text-primary)]">
            Notifications
            {unreadCount > 0 && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded-full">
                {unreadCount} unread
              </span>
            )}
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {/* Unread toggle */}
          <button
            type="button"
            onClick={() => setUnreadOnly(!unreadOnly)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
              unreadOnly
                ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                : 'text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
            )}
          >
            <Filter className="w-3.5 h-3.5" />
            Unread only
          </button>

          {/* Mark all read */}
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all read
            </button>
          )}

          {/* Refresh */}
          <button
            type="button"
            onClick={() => fetchNotifications(true)}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Module filter chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {MODULE_FILTERS.map(f => (
          <button
            key={f.key}
            type="button"
            onClick={() => setModuleFilter(f.key)}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-full border transition-colors',
              moduleFilter === f.key
                ? 'bg-[var(--ff-primary)] text-white border-[var(--ff-primary)]'
                : 'text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Notification list */}
      {isLoading && notifications.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-5 h-5 animate-spin text-[var(--ff-text-tertiary)]" />
          <span className="ml-2 text-sm text-[var(--ff-text-secondary)]">Loading notifications...</span>
        </div>
      ) : filteredNotifications.length === 0 ? (
        <div className="text-center py-12">
          <Bell className="w-10 h-10 mx-auto text-[var(--ff-text-tertiary)] mb-3" />
          <p className="text-sm text-[var(--ff-text-secondary)]">
            {unreadOnly ? 'No unread notifications' : 'No notifications yet'}
          </p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
            Notifications from maintenance, procurement, and other modules will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredNotifications.map(notification => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onMarkRead={handleMarkRead}
            />
          ))}

          {/* Load more */}
          {hasMore && (
            <div className="flex justify-center pt-4">
              <button
                type="button"
                onClick={() => fetchNotifications(false)}
                disabled={isLoading}
                className="px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
