/**
 * ActivityTab Component - Display ticket activities like QContact
 *
 * Features:
 * - Timeline view of all activities
 * - Filter by type (All, Notes, Updates, Messages)
 * - Shows field changes for updates
 * - Source indicator (QContact vs FibreFlow)
 * - Pinned items shown first
 */

'use client';

import React, { useState } from 'react';
import {
  MessageSquare,
  Edit,
  UserPlus,
  Activity,
  Loader2,
  AlertTriangle,
  RefreshCw,
  StickyNote,
  GitCompare,
  Pin,
  ChevronRight,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useTicketActivities, type TicketActivity } from '../../hooks/useTicketActivities';

interface ActivityTabProps {
  ticketId: string;
}

type ActivityFilter = 'all' | 'note' | 'update' | 'message';

/**
 * Get icon for activity type
 */
function getActivityIcon(type: TicketActivity['type']) {
  switch (type) {
    case 'note':
      return StickyNote;
    case 'update':
    case 'status_change':
      return Edit;
    case 'assignment':
      return UserPlus;
    case 'message':
      return MessageSquare;
    case 'system':
    default:
      return Activity;
  }
}

/**
 * Get activity type label
 */
function getActivityTypeLabel(type: TicketActivity['type']): string {
  switch (type) {
    case 'note':
      return 'Note';
    case 'update':
      return 'Update';
    case 'status_change':
      return 'Status Change';
    case 'assignment':
      return 'Assignment';
    case 'message':
      return 'Message';
    case 'system':
      return 'System';
    default:
      return 'Activity';
  }
}

/**
 * Get activity type color
 */
function getActivityTypeColor(type: TicketActivity['type']): string {
  switch (type) {
    case 'note':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'update':
    case 'status_change':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'assignment':
      return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
    case 'message':
      return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'system':
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

/**
 * Single activity item
 */
function ActivityItem({ activity }: { activity: TicketActivity }) {
  const Icon = getActivityIcon(activity.type);
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        'relative pl-8 pb-6',
        activity.is_pinned && 'bg-yellow-500/5 -ml-4 pl-12 pr-4 py-3 rounded-lg border border-yellow-500/20'
      )}
    >
      {/* Timeline line */}
      <div className="absolute left-[11px] top-8 bottom-0 w-0.5 bg-[var(--ff-border-light)]" />

      {/* Icon */}
      <div
        className={cn(
          'absolute left-0 w-6 h-6 rounded-full flex items-center justify-center',
          getActivityTypeColor(activity.type),
          'border'
        )}
      >
        <Icon className="w-3.5 h-3.5" />
      </div>

      {/* Content */}
      <div className="space-y-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {activity.is_pinned && (
              <Pin className="w-3.5 h-3.5 text-yellow-400" />
            )}
            <span
              className={cn(
                'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border',
                getActivityTypeColor(activity.type)
              )}
            >
              {getActivityTypeLabel(activity.type)}
            </span>
            {activity.created_by && (
              <span className="text-sm text-[var(--ff-text-primary)] font-medium">
                {activity.created_by.name}
              </span>
            )}
            <span className="text-xs text-[var(--ff-text-secondary)]">
              {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
            </span>
          </div>
          <span
            className={cn(
              'text-xs px-1.5 py-0.5 rounded',
              activity.source === 'qcontact'
                ? 'bg-purple-500/20 text-purple-400'
                : 'bg-blue-500/20 text-blue-400'
            )}
          >
            {activity.source === 'qcontact' ? 'QContact' : 'FibreFlow'}
          </span>
        </div>

        {/* Description */}
        {activity.description && (
          <p className="text-sm text-[var(--ff-text-secondary)] whitespace-pre-wrap">
            {activity.description}
          </p>
        )}

        {/* Field Changes */}
        {activity.field_changes && activity.field_changes.length > 0 && (
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
            >
              <ChevronRight
                className={cn('w-3.5 h-3.5 transition-transform', expanded && 'rotate-90')}
              />
              <GitCompare className="w-3.5 h-3.5" />
              {activity.field_changes.length} field{activity.field_changes.length > 1 ? 's' : ''} changed
            </button>

            {expanded && (
              <div className="mt-2 space-y-1.5 pl-4 border-l-2 border-[var(--ff-border-light)]">
                {activity.field_changes.map((change, idx) => (
                  <div key={idx} className="text-xs">
                    <span className="text-[var(--ff-text-secondary)] font-medium capitalize">
                      {change.field.replace(/_/g, ' ')}:
                    </span>
                    {change.old_value && (
                      <>
                        <span className="text-red-400 line-through mx-1">{change.old_value}</span>
                        <span className="text-[var(--ff-text-secondary)]">→</span>
                      </>
                    )}
                    <span className="text-green-400 ml-1">{change.new_value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Timestamp detail */}
        <div className="text-xs text-[var(--ff-text-secondary)]">
          {format(new Date(activity.created_at), 'MMM d, yyyy \'at\' h:mm a')}
        </div>
      </div>
    </div>
  );
}

/**
 * Activity Tab Component
 */
export function ActivityTab({ ticketId }: ActivityTabProps) {
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const { activities, summary, isLoading, isError, error, refetch } = useTicketActivities(ticketId);

  // Filter activities based on selected filter
  const filteredActivities = React.useMemo(() => {
    if (filter === 'all') return activities;
    if (filter === 'update') {
      return activities.filter(a => a.type === 'update' || a.type === 'status_change');
    }
    return activities.filter(a => a.type === filter);
  }, [activities, filter]);

  // Sort: pinned first, then by date
  const sortedActivities = React.useMemo(() => {
    return [...filteredActivities].sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [filteredActivities]);

  // Filter buttons
  const filters: { key: ActivityFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: summary.total },
    { key: 'note', label: 'Notes', count: summary.notes },
    { key: 'update', label: 'Updates', count: summary.updates },
    { key: 'message', label: 'Messages', count: summary.messages },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 text-[var(--ff-text-secondary)] animate-spin" />
        <span className="ml-2 text-[var(--ff-text-secondary)]">Loading activities...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-lg">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <div className="flex-1">
            <h4 className="text-sm font-medium text-red-400">Failed to load activities</h4>
            <p className="text-xs text-red-300 mt-1">{error?.message}</p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="p-1.5 hover:bg-red-500/20 rounded transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-red-400" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {filters.map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              filter === key
                ? 'bg-blue-600 text-white'
                : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] hover:text-[var(--ff-text-primary)]'
            )}
          >
            {label}
            {count > 0 && (
              <span
                className={cn(
                  'ml-1.5 px-1.5 py-0.5 rounded-full text-xs',
                  filter === key ? 'bg-blue-500 text-white' : 'bg-[var(--ff-bg-tertiary)]'
                )}
              >
                {count}
              </span>
            )}
          </button>
        ))}

        <button
          type="button"
          onClick={() => refetch()}
          className="ml-auto p-2 hover:bg-[var(--ff-bg-secondary)] rounded-lg transition-colors"
          title="Refresh activities"
        >
          <RefreshCw className="w-4 h-4 text-[var(--ff-text-secondary)]" />
        </button>
      </div>

      {/* Activity List */}
      {sortedActivities.length === 0 ? (
        <div className="text-center py-8 text-[var(--ff-text-secondary)]">
          <Activity className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No activities found</p>
          {filter !== 'all' && (
            <button
              type="button"
              onClick={() => setFilter('all')}
              className="mt-2 text-sm text-blue-400 hover:text-blue-300"
            >
              Show all activities
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-0">
          {sortedActivities.map((activity) => (
            <ActivityItem key={activity.id} activity={activity} />
          ))}
        </div>
      )}
    </div>
  );
}
