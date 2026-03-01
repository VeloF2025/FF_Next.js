/**
 * Single notification card for the Communications Hub
 * Displays icon, title, body, timestamp, read state, and module badge
 */

import React from 'react';
import {
  Bell,
  Wrench,
  ShoppingCart,
  Map,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Info,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UserNotification } from '@/modules/notifications/types';

interface NotificationItemProps {
  notification: UserNotification;
  onMarkRead: (id: string) => void;
}

const MODULE_ICONS: Record<string, React.ElementType> = {
  maintenance: Wrench,
  procurement: ShoppingCart,
  qfield: Map,
  meetings: Calendar,
};

const SEVERITY_STYLES: Record<string, { icon: React.ElementType; color: string }> = {
  info: { icon: Info, color: 'text-blue-500' },
  success: { icon: CheckCircle, color: 'text-green-500' },
  warning: { icon: AlertTriangle, color: 'text-amber-500' },
  error: { icon: XCircle, color: 'text-red-500' },
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function NotificationItem({ notification, onMarkRead }: NotificationItemProps) {
  const severity = SEVERITY_STYLES[notification.severity] || SEVERITY_STYLES.info;
  const SeverityIcon = severity.icon;
  const ModuleIcon = notification.source_module
    ? MODULE_ICONS[notification.source_module] || Bell
    : Bell;

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-4 rounded-lg border transition-colors cursor-pointer',
        notification.is_read
          ? 'bg-[var(--ff-bg-primary)] border-[var(--ff-border-light)]'
          : 'bg-blue-500/5 border-blue-500/20'
      )}
      onClick={() => {
        if (!notification.is_read) onMarkRead(notification.id);
        if (notification.action_url) {
          window.location.href = notification.action_url;
        }
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!notification.is_read) onMarkRead(notification.id);
          if (notification.action_url) {
            window.location.href = notification.action_url;
          }
        }
      }}
    >
      {/* Unread dot */}
      <div className="flex-shrink-0 mt-1.5">
        <div
          className={cn(
            'w-2 h-2 rounded-full',
            notification.is_read ? 'bg-transparent' : 'bg-blue-500'
          )}
        />
      </div>

      {/* Icon */}
      <div className={cn('flex-shrink-0 mt-0.5', severity.color)}>
        <SeverityIcon className="w-5 h-5" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h4
            className={cn(
              'text-sm',
              notification.is_read
                ? 'text-[var(--ff-text-secondary)]'
                : 'text-[var(--ff-text-primary)] font-medium'
            )}
          >
            {notification.title}
          </h4>
          <span className="text-xs text-[var(--ff-text-tertiary)] whitespace-nowrap">
            {formatTimestamp(notification.created_at)}
          </span>
        </div>

        {notification.body && (
          <p className="text-xs text-[var(--ff-text-secondary)] mt-1 line-clamp-2">
            {notification.body}
          </p>
        )}

        {notification.source_module && (
          <div className="flex items-center gap-1 mt-2">
            <ModuleIcon className="w-3 h-3 text-[var(--ff-text-tertiary)]" />
            <span className="text-xs text-[var(--ff-text-tertiary)] capitalize">
              {notification.source_module}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
