'use client';

import { useState } from 'react';
import { CheckCircle, Clock, AlertCircle, Calendar, User, ExternalLink } from 'lucide-react';
import { ActionItem } from '@/types/action-items.types';
import { actionItemsService } from '@/services/action-items/actionItemsService';

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
      console.error('Error updating action item:', error);
      alert('Failed to update action item');
    } finally {
      setUpdatingId(null);
    }
  };

  const getStatusIcon = (status: ActionItem['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'in_progress':
        return <Clock className="w-5 h-5 text-blue-500" />;
      case 'cancelled':
        return <AlertCircle className="w-5 h-5 text-gray-400" />;
      default:
        return <Clock className="w-5 h-5 text-yellow-500" />;
    }
  };

  const getPriorityBadge = (priority: ActionItem['priority']) => {
    const colors = {
      urgent: 'bg-red-500/20 text-red-400',
      high: 'bg-orange-500/20 text-orange-400',
      medium: 'bg-blue-500/20 text-blue-400',
      low: 'bg-gray-500/20 text-gray-400',
    };

    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded ${colors[priority]}`}>
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
            {/* Status Icon */}
            <button
              onClick={() => handleToggleComplete(item)}
              disabled={updatingId === item.id}
              className="mt-1 hover:scale-110 transition-transform disabled:opacity-50"
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
                    <span className="truncate max-w-xs">{item.meeting_title}</span>
                  </div>
                )}

                {/* Meeting timestamp */}
                {item.mentioned_at && (
                  <span className="text-xs text-[var(--ff-text-secondary)]">@ {item.mentioned_at}</span>
                )}

                {/* Priority */}
                {getPriorityBadge(item.priority)}

                {/* Due date */}
                {item.due_date && (
                  <span
                    className={`text-xs ${
                      new Date(item.due_date) < new Date() && item.status !== 'completed'
                        ? 'text-red-400 font-semibold'
                        : 'text-[var(--ff-text-secondary)]'
                    }`}
                  >
                    Due: {new Date(item.due_date).toLocaleDateString()}
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

            {/* Meeting transcript link */}
            {item.transcript_url && (
              <a
                href={item.transcript_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300"
                title="View meeting transcript"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
