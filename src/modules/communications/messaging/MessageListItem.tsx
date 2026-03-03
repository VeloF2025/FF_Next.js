/**
 * Single message row in the inbox/sent list
 */

import { MessageCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MessageListItem as MessageListItemType } from '../types/messaging.types';

interface MessageListItemProps {
  message: MessageListItemType;
  onClick: (id: string) => void;
  showSender?: boolean;
  /** When true, a checkbox is rendered on the left for bulk selection */
  showCheckbox?: boolean;
  /** Whether this item is currently selected */
  isSelected?: boolean;
  /** Callback when the checkbox is toggled */
  onToggleSelect?: (id: string) => void;
}

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

export function MessageListItem({
  message,
  onClick,
  showSender = true,
  showCheckbox = false,
  isSelected = false,
  onToggleSelect,
}: MessageListItemProps) {
  const isUnread = !message.is_read;
  const isUrgent = message.priority === 'urgent';
  const isHigh = message.priority === 'high';

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSelect?.(message.id);
  };

  return (
    <button
      type="button"
      onClick={() => (showCheckbox ? onToggleSelect?.(message.id) : onClick(message.id))}
      className={cn(
        'w-full text-left px-4 py-3 border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] transition-colors',
        isUnread && !isSelected && 'bg-blue-500/5',
        isSelected && 'bg-[var(--ff-primary)]/8'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox (selection mode) or unread dot */}
        <div className="pt-1.5 w-4 flex-shrink-0 flex items-start justify-center">
          {showCheckbox ? (
            <input
              type="checkbox"
              checked={isSelected}
              onClick={handleCheckboxClick}
              onChange={() => {/* controlled via onClick */}}
              className="w-3.5 h-3.5 rounded accent-blue-500 cursor-pointer"
              aria-label="Select message"
            />
          ) : (
            isUnread && <div className="w-2 h-2 rounded-full bg-blue-500" />
          )}
        </div>

        {/* Sender initial */}
        <div className="w-8 h-8 rounded-full bg-[var(--ff-bg-tertiary)] flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-semibold text-[var(--ff-text-secondary)]">
            {message.sender_name?.charAt(0)?.toUpperCase() || '?'}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {showSender && (
              <span className={cn(
                'text-sm truncate',
                isUnread
                  ? 'font-semibold text-[var(--ff-text-primary)]'
                  : 'font-medium text-[var(--ff-text-secondary)]'
              )}>
                {message.sender_name}
              </span>
            )}

            {/* Priority badge */}
            {isUrgent && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold bg-red-500/15 text-red-400 rounded">
                <AlertTriangle className="w-2.5 h-2.5" />
                Urgent
              </span>
            )}
            {isHigh && (
              <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-orange-500/15 text-orange-400 rounded">
                High
              </span>
            )}

            <span className="ml-auto text-xs text-[var(--ff-text-tertiary)] whitespace-nowrap flex-shrink-0">
              {formatRelative(message.latest_reply_at || message.created_at)}
            </span>
          </div>

          {/* Subject */}
          {message.subject && (
            <p className={cn(
              'text-sm truncate mt-0.5',
              isUnread ? 'text-[var(--ff-text-primary)]' : 'text-[var(--ff-text-secondary)]'
            )}>
              {message.subject}
            </p>
          )}

          {/* Body preview */}
          <p className="text-xs text-[var(--ff-text-tertiary)] truncate mt-0.5">
            {message.body}
          </p>

          {/* Meta row */}
          <div className="flex items-center gap-3 mt-1">
            {message.reply_count > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-[var(--ff-text-tertiary)]">
                <MessageCircle className="w-3 h-3" />
                {message.reply_count} {message.reply_count === 1 ? 'reply' : 'replies'}
              </span>
            )}
            {message.recipient_count > 1 && (
              <span className="text-[10px] text-[var(--ff-text-tertiary)]">
                {message.recipient_count} recipients
              </span>
            )}
            {message.context_module && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] rounded capitalize">
                {message.context_module}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
