/**
 * TicketTimeline Component - Ticket activity timeline
 *
 * 🟢 WORKING: Production-ready ticket timeline component
 *
 * Features:
 * - Display ticket activity history
 * - Status changes, assignments, notes
 * - Timestamp display
 * - User attribution
 * - Icon indicators for different event types
 */

'use client';

import React from 'react';
import {
  Clock,
  User,
  FileText,
  CheckCircle2,
  XCircle,
  ArrowRight,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

interface TimelineEvent {
  id: string;
  type: 'status_change' | 'assignment' | 'note' | 'created';
  description: string;
  timestamp: Date;
  user?: {
    id: string;
    name: string;
  };
}

interface TicketTimelineProps {
  /** Timeline events */
  events: TimelineEvent[];
  /** Compact mode */
  compact?: boolean;
}

/**
 * 🟢 WORKING: Get event icon and style
 */
function getEventConfig(type: string) {
  const configs: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
    status_change: { icon: ArrowRight, color: 'text-blue-400' },
    assignment: { icon: User, color: 'text-green-400' },
    note: { icon: FileText, color: 'text-purple-400' },
    created: { icon: CheckCircle2, color: 'text-cyan-400' },
  };

  return configs[type] || configs.note;
}

/**
 * 🟢 WORKING: Ticket timeline component
 */
export function TicketTimeline({ events, compact = false }: TicketTimelineProps) {
  if (!events || events.length === 0) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Activity Timeline</h3>
        <p className="text-sm text-[var(--ff-text-secondary)]">No activity recorded yet</p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
      <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Activity Timeline</h3>

      <div className="space-y-4">
        {events.map((event, index) => {
          const config = getEventConfig(event.type);
          const Icon = config.icon;

          return (
            <div key={event.id} className="relative">
              {/* Timeline line */}
              {index < events.length - 1 && (
                <div className="absolute left-[15px] top-8 bottom-0 w-px bg-[var(--ff-border-light)]" />
              )}

              {/* Event */}
              <div className="flex items-start gap-3">
                {/* Icon */}
                <div className={cn('flex-shrink-0 w-8 h-8 rounded-full bg-[var(--ff-bg-tertiary)] flex items-center justify-center', config.color)}>
                  <Icon className="w-4 h-4" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-1">
                  <p className="text-sm text-[var(--ff-text-primary)]">{event.description}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-[var(--ff-text-secondary)]">
                    {event.user && <span>{event.user.name}</span>}
                    <span>•</span>
                    <span>{formatDistanceToNow(event.timestamp, { addSuffix: true })}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
