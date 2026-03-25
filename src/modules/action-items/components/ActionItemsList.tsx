'use client';

import { useState } from 'react';
import { CheckCircle, Clock, AlertCircle, Calendar, User, ExternalLink } from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';
import { ActionItem } from '@/types/action-items.types';
import { actionItemsService } from '@/services/action-items/actionItemsService';
import { SourceBadge } from './SourceBadge';
import { log } from '@/lib/logger';

interface ActionItemsListProps {
  items: ActionItem[];
  onItemUpdated?: () => void;
}

export function ActionItemsList({ items, onItemUpdated }: ActionItemsListProps) {
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const handleToggleComplete = async (item: ActionItem) => {
    setUpdatingId(item.id);
    try {
      const newStatus = item.status === 'completed' ? 'pending' : 'completed';
      await actionItemsService.updateStatus(item.id, newStatus);
      onItemUpdated?.();
    } catch (error) {
      log.error('Error updating action item', { error, itemId: item.id }, 'ActionItemsList');
      notificationService.error('Failed to update action item');
    } finally {
      setUpdatingId(null);
    }
  };

  // Fix #1: Use CSS variable tokens instead of hardcoded Tailwind colours
  const getStatusIcon = (status: ActionItem['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-[var(--ff-success)]" />;
      case 'in_progress':
        return <Clock className="w-5 h-5 text-[var(--ff-warning)]" />;
      case 'cancelled':
        return <AlertCircle className="w-5 h-5 text-[var(--ff-text-tertiary)]" />;
      default:
        return <Clock className="w-5 h-5 text-[var(--ff-info)]" />;
    }
  };

  // 🟢 WORKING: Priority badges use existing design system tokens (verified in design-system.css)
  const getPriorityBadge = (priority: ActionItem['priority']) => {
    const colors: Record<string, string> = {
      urgent: 'bg-[var(--ff-error-light)] text-[var(--ff-error)]',
      high: 'bg-[var(--ff-warning-light)] text-[var(--ff-warning)]',
      medium: 'bg-[var(--ff-info-light)] text-[var(--ff-info)]',
      low: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]',
    };

    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded ${colors[priority] ?? colors.low}`}>
        {priority}
      </span>
    );
  };

  if (items.length === 0) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-12 text-center">
        <AlertCircle className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
        <p className="text-[var(--ff-text-secondary)] text-lg">No action items found</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div
          key={item.id}
          className={`bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-4 hover:shadow-md transition-shadow ${
            item.status === 'completed' ? 'opacity-60' : ''
          }`}
        >
          <div className="flex items-start gap-4">
            {/* Status Icon — Fix #4: aria-label, aria-pressed, focus indicator, disabled state */}
            <button
              onClick={() => handleToggleComplete(item)}
              disabled={updatingId === item.id}
              aria-label={`Mark as ${item.status === 'completed' ? 'incomplete' : 'complete'}`}
              aria-pressed={item.status === 'completed'}
              className="mt-1 p-1 rounded hover:scale-110 transition-transform disabled:cursor-not-allowed disabled:text-[var(--ff-text-tertiary)] focus:ring-2 focus:ring-[var(--ff-primary-600)] focus:outline-none"
            >
              {getStatusIcon(item.status)}
            </button>

            {/* Content */}
            <div className="flex-1 min-w-0">
              {/* Description */}
              <p
                className={`text-[var(--ff-text-primary)] mb-2 ${
                  item.status === 'completed' ? 'line-through text-[var(--ff-text-secondary)]' : ''
                }`}
              >
                {item.description}
              </p>

              {/* Metadata */}
              <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--ff-text-secondary)]">
                {/* Assignee */}
                {item.assignee_name && (
                  <div className="flex items-center gap-1">
                    <User className="w-4 h-4" />
                    <span>{item.assignee_name}</span>
                  </div>
                )}

                {/* Meeting */}
                {item.meeting_title && (
                  <div className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    <span className="truncate max-w-xs" title={item.meeting_title}>{item.meeting_title}</span>
                  </div>
                )}

                {/* Meeting timestamp */}
                {item.mentioned_at && (
                  <span className="text-xs text-[var(--ff-text-secondary)]">@ {item.mentioned_at}</span>
                )}

                {/* Source badge */}
                {item.source_type && item.source_type !== 'meeting' && (
                  <SourceBadge source={item.source_type} />
                )}

                {/* Priority */}
                {getPriorityBadge(item.priority)}

                {/* Due date */}
                {item.due_date && (
                  <span
                    className={`text-xs ${
                      new Date(item.due_date) < new Date() && item.status !== 'completed'
                        ? 'text-[var(--ff-error)] font-semibold'
                        : 'text-[var(--ff-text-secondary)]'
                    }`}
                  >
                    Due: {new Date(item.due_date).toISOString().split('T')[0]}
                  </span>
                )}
              </div>

              {/* Notes */}
              {item.notes && (
                <p className="mt-2 text-sm text-[var(--ff-text-secondary)] italic">{item.notes}</p>
              )}

              {/* Tags */}
              {item.tags && item.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 text-xs bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Meeting transcript link — Fix #5: aria-label, themed colour, focus indicator */}
            {item.transcript_url && (
              <a
                href={item.transcript_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--ff-primary-600)] hover:text-[var(--ff-primary-700)] rounded focus:ring-2 focus:ring-[var(--ff-primary-600)] focus:outline-none"
                aria-label="View meeting transcript in new window"
              >
                <ExternalLink className="w-4 h-4" aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
