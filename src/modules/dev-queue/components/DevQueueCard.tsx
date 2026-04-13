/**
 * DevQueue Card Component
 */

import { ThumbsUp, MessageSquare, Trash2, Clock, Paperclip } from 'lucide-react';
import type { DevQueueItem } from '../types/devQueue';

interface DevQueueCardProps {
  item: DevQueueItem;
  onVote: (itemId: string) => Promise<unknown>;
  onDelete: (itemId: string) => Promise<void>;
  onEdit?: (item: DevQueueItem) => void;
  onAttachments?: (item: DevQueueItem) => void;
  isDragging?: boolean;
}

export function DevQueueCard({ item, onVote, onDelete, onEdit, onAttachments, isDragging }: DevQueueCardProps) {
  const handleCardClick = (e: React.MouseEvent) => {
    // Don't trigger edit when clicking action buttons
    if ((e.target as HTMLElement).closest('button')) return;
    onEdit?.(item);
  };

  const handleVote = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await onVote(item.id);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this item?')) {
      await onDelete(item.id);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-secondary text-foreground border-border';
    }
  };

  const getEffortBadge = (effort?: string) => {
    if (!effort) return null;
    const colors: Record<string, string> = {
      'XS': 'bg-blue-100 text-blue-800',
      'S': 'bg-cyan-100 text-cyan-800',
      'M': 'bg-indigo-100 text-indigo-800',
      'L': 'bg-purple-100 text-purple-800',
      'XL': 'bg-pink-100 text-pink-800',
    };
    return (
      <span className={`text-xs px-2 py-0.5 rounded ${colors[effort] || 'bg-secondary text-foreground'}`}>
        {effort}
      </span>
    );
  };

  return (
    <div
      onClick={handleCardClick}
      className={`bg-[var(--ff-bg-primary)] rounded-lg p-4 border border-[var(--ff-border-light)] hover:shadow-md transition-all ${
        onEdit ? 'cursor-pointer hover:border-blue-300' : 'cursor-move'
      } ${isDragging ? 'opacity-50 shadow-xl' : ''}`}
    >
      {/* Card Header */}
      <div className="mb-3">
        <h4 className="font-medium text-sm text-[var(--ff-text-primary)] line-clamp-2">
          {item.title}
        </h4>
      </div>

      {/* Description */}
      {item.description && (
        <p className="text-xs text-[var(--ff-text-secondary)] mb-3 line-clamp-2">
          {item.description}
        </p>
      )}

      {/* Metadata */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded border ${getPriorityColor(item.priority)}`}>
            {item.priority}
          </span>
          {getEffortBadge(item.effort_estimate)}
        </div>
        {item.business_value && (
          <span className="text-xs text-[var(--ff-text-tertiary)]">
            Value: {item.business_value}/10
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={handleVote}
            className={`flex items-center gap-1 text-xs transition-colors ${
              item.has_voted
                ? 'text-blue-600'
                : 'text-[var(--ff-text-tertiary)] hover:text-blue-600'
            }`}
          >
            <ThumbsUp className={`h-3 w-3 ${item.has_voted ? 'fill-current' : ''}`} />
            {item.votes || 0}
          </button>
          {item.comments_count !== undefined && item.comments_count > 0 && (
            <span className="flex items-center gap-1 text-xs text-[var(--ff-text-tertiary)]">
              <MessageSquare className="h-3 w-3" />
              {item.comments_count}
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAttachments?.(item);
            }}
            className={`flex items-center gap-1 text-xs transition-colors ${
              item.attachments_count && item.attachments_count > 0
                ? 'text-blue-600'
                : 'text-[var(--ff-text-tertiary)] hover:text-blue-600'
            }`}
            title="Attachments"
          >
            <Paperclip className="h-3 w-3" />
            {item.attachments_count || 0}
          </button>
        </div>
        <button
          onClick={handleDelete}
          className="text-[var(--ff-text-tertiary)] hover:text-red-600 transition-colors"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* Footer */}
      {item.created_by_name && (
        <div className="mt-3 pt-3 border-t border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between text-xs text-[var(--ff-text-tertiary)]">
            <span>{item.created_by_name}</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {new Date(item.created_at).toISOString().split('T')[0]}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}