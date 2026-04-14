/**
 * Single feed item row — channel icon, title, body preview, timestamp, unread dot
 */

import {
  Mail,
  MessageSquare,
  Bell,
  CheckSquare,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FeedItem } from '../types/hub.types';

interface FeedItemRowProps {
  item: FeedItem;
  onClick: (item: FeedItem) => void;
}

const CHANNEL_CONFIG = {
  message: {
    icon: MessageSquare,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    label: 'Message',
  },
  email: {
    icon: Mail,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    label: 'Email',
  },
  notification: {
    icon: Bell,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    label: 'Notification',
  },
  meeting: {
    icon: CheckSquare,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    label: 'Action Item',
  },
  whatsapp: {
    icon: MessageSquare,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    label: 'WhatsApp',
  },
} as const;

function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(iso).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' });
}

export function FeedItemRow({ item, onClick }: FeedItemRowProps) {
  const config = CHANNEL_CONFIG[item.channel] || CHANNEL_CONFIG.notification;
  const Icon = config.icon;
  const meta = item.metadata || {};

  const isUrgent = meta.priority === 'urgent' || meta.severity === 'error';
  const isHigh = meta.priority === 'high' || meta.severity === 'warning';

  return (
    <button
      type="button"
      onClick={() => onClick(item)}
      className={cn(
        'w-full text-left px-4 py-3 border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] transition-colors',
        !item.isRead && 'bg-blue-500/5'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Unread dot */}
        <div className="pt-1.5 w-2 flex-shrink-0">
          {!item.isRead && (
            <div className="w-2 h-2 rounded-full bg-blue-500" />
          )}
        </div>

        {/* Channel icon */}
        <div className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
          config.bg
        )}>
          <Icon className={cn('w-4 h-4', config.color)} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn(
              'text-sm truncate',
              !item.isRead
                ? 'font-semibold text-[var(--ff-text-primary)]'
                : 'font-medium text-[var(--ff-text-secondary)]'
            )}>
              {item.title}
            </span>

            {/* Priority / severity badge */}
            {isUrgent && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold bg-red-500/15 text-red-400 rounded">
                <AlertTriangle className="w-2.5 h-2.5" />
                Urgent
              </span>
            )}
            {isHigh && !isUrgent && (
              <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-orange-500/15 text-orange-400 rounded">
                High
              </span>
            )}

            <span className="ml-auto text-xs text-[var(--ff-text-tertiary)] whitespace-nowrap flex-shrink-0">
              {formatRelative(item.timestamp)}
            </span>
          </div>

          {/* Body preview */}
          {item.body && (
            <p className="text-xs text-[var(--ff-text-tertiary)] truncate mt-0.5">
              {item.body}
            </p>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-3 mt-1">
            <span className={cn(
              'px-1.5 py-0.5 text-[10px] font-medium rounded',
              config.bg, config.color
            )}>
              {config.label}
            </span>

            {/* Reply count for messages */}
            {item.channel === 'message' && Number(meta.reply_count) > 0 && (
              <span className="text-[10px] text-[var(--ff-text-tertiary)]">
                {String(meta.reply_count)} {Number(meta.reply_count) === 1 ? 'reply' : 'replies'}
              </span>
            )}

            {/* Email status */}
            {item.channel === 'email' && Boolean(meta.status) && (
              <span className="text-[10px] text-[var(--ff-text-tertiary)] capitalize">
                {String(meta.status)}
              </span>
            )}

            {/* Action item due date */}
            {item.channel === 'meeting' && meta.due_date && (
              <span className="text-[10px] text-[var(--ff-text-tertiary)]">
                Due: {new Date(String(meta.due_date)).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })}
              </span>
            )}

            {/* Source module badge */}
            {item.sourceModule && item.sourceModule !== config.label.toLowerCase() && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] rounded capitalize">
                {item.sourceModule}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
