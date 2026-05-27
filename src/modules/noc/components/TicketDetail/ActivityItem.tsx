'use client';

/**
 * ActivityItem — generic timeline row for non-AI activity types. AI-summary
 * rows are routed to AiSummaryItem with its own dedicated layout.
 */

import { useState } from 'react';
import { GitCompare, Pin, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { formatDisplayDateTime } from '@/utils/dateFormat';
import { cn } from '@/lib/utils';
import type { TicketActivity } from '../../hooks/useTicketActivities';
import { AiSummaryItem } from './AiSummaryItem';
import {
  getActivityIcon,
  getActivityTypeLabel,
  getActivityTypeColor,
  isFieldChangeArray,
} from './activityHelpers';

interface ActivityItemProps {
  activity: TicketActivity;
  ticketId: string;
  onRegenerated: () => void;
}

export function ActivityItem({ activity, ticketId, onRegenerated }: ActivityItemProps) {
  const Icon = getActivityIcon(activity.type);
  const [expanded, setExpanded] = useState(false);

  if (activity.type === 'ai_summary') {
    return (
      <AiSummaryItem
        activity={activity}
        ticketId={ticketId}
        onRegenerated={onRegenerated}
      />
    );
  }

  const fieldChanges = isFieldChangeArray(activity.field_changes)
    ? activity.field_changes
    : null;

  return (
    <div
      className={cn(
        'relative pl-8 pb-6',
        activity.is_pinned && 'bg-yellow-500/5 -ml-4 pl-12 pr-4 py-3 rounded-lg border border-yellow-500/20'
      )}
    >
      <div className="absolute left-[11px] top-8 bottom-0 w-0.5 bg-[var(--ff-border-light)]" />
      <div
        className={cn(
          'absolute left-0 w-6 h-6 rounded-full flex items-center justify-center',
          getActivityTypeColor(activity.type),
          'border'
        )}
      >
        <Icon className="w-3.5 h-3.5" />
      </div>

      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {activity.is_pinned && <Pin className="w-3.5 h-3.5 text-yellow-400" />}
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

        {activity.description && (
          <p className="text-sm text-[var(--ff-text-secondary)] whitespace-pre-wrap">
            {activity.description}
          </p>
        )}

        {fieldChanges && fieldChanges.length > 0 && (
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
              {fieldChanges.length} field{fieldChanges.length > 1 ? 's' : ''} changed
            </button>

            {expanded && (
              <div className="mt-2 space-y-1.5 pl-4 border-l-2 border-[var(--ff-border-light)]">
                {fieldChanges.map((change, idx) => (
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

        <div className="text-xs text-[var(--ff-text-secondary)]">
          {formatDisplayDateTime(activity.created_at)}
        </div>
      </div>
    </div>
  );
}
