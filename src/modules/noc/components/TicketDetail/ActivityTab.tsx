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
import { Activity, AlertTriangle, RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { cn } from '@/lib/utils';
import { useTicketActivities } from '../../hooks/useTicketActivities';
import { ActivityItem } from './ActivityItem';

interface ActivityTabProps {
  ticketId: string;
}

type ActivityFilter = 'all' | 'note' | 'update' | 'message';

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

  // Sort: AI summaries first (most recent narrative is the entry point),
  // then pinned, then by date.
  const sortedActivities = React.useMemo(() => {
    return [...filteredActivities].sort((a, b) => {
      const aIsAi = a.type === 'ai_summary';
      const bIsAi = b.type === 'ai_summary';
      if (aIsAi && !bIsAi) return -1;
      if (!aIsAi && bIsAi) return 1;
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
      <LoadingSpinner className="p-8" label="Loading activities..." />
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
            <ActivityItem
              key={activity.id}
              activity={activity}
              ticketId={ticketId}
              onRegenerated={refetch}
            />
          ))}
        </div>
      )}
    </div>
  );
}
