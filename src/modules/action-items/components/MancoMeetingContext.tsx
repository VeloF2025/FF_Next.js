'use client';

import { Calendar } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { MancoMeetingContext as MeetingContextData } from '@/types/manco-action-items.types';
import { formatDate } from './manco-grid-helpers';

interface MancoMeetingContextProps {
  /** Meeting context data; null means "no meeting linked". */
  context: MeetingContextData | null;
  /** Whether the context is still being fetched. */
  loading: boolean;
}

/**
 * Read-only display of the meeting context (title, summary, decisions, excerpts)
 * for a manco action item.
 */
export function MancoMeetingContext({ context, loading }: MancoMeetingContextProps) {
  return (
    <div className="border-t border-[var(--ff-border-light)] pt-6">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="w-4 h-4 text-[var(--ff-text-secondary)]" />
        <p className="text-sm font-semibold text-[var(--ff-text-primary)]">Meeting Context</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <InlineSpinner size="sm" />
        </div>
      ) : context?.meeting ? (
        <div className="space-y-3 p-3 bg-[var(--ff-bg-secondary)] rounded text-xs">
          <div>
            <p className="font-semibold text-[var(--ff-text-primary)]">{context.meeting.title}</p>
            <p className="text-[var(--ff-text-secondary)] text-xs mt-1">
              {formatDate(context.meeting.meeting_date)}
            </p>
          </div>

          {context.summary?.overview && (
            <div>
              <p className="font-medium text-[var(--ff-text-primary)] mb-1">Overview:</p>
              <p className="text-[var(--ff-text-secondary)] text-xs leading-relaxed">
                {context.summary.overview}
              </p>
            </div>
          )}

          {context.summary?.decisions && context.summary.decisions.length > 0 && (
            <div>
              <p className="font-medium text-[var(--ff-text-primary)] mb-1">Key Decisions:</p>
              <ul className="space-y-1">
                {context.summary.decisions.slice(0, 2).map((decision, idx) => (
                  <li key={idx} className="text-[var(--ff-text-secondary)] text-xs">
                    • {decision}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {context.excerpts && context.excerpts.length > 0 && (
            <div>
              <p className="font-medium text-[var(--ff-text-primary)] mb-2">Relevant Discussion:</p>
              <div className="space-y-2">
                {context.excerpts.slice(0, 3).map((excerpt, idx) => (
                  <div key={idx} className="border-l-2 border-[var(--ff-primary)] pl-2 py-1">
                    <p className="text-[var(--ff-text-secondary)] text-xs">
                      <span className="font-semibold">{excerpt.timestamp}</span>
                      {excerpt.speaker ? ` • ${excerpt.speaker}` : ''}
                    </p>
                    <p className="text-[var(--ff-text-primary)] text-xs mt-1">
                      &ldquo;{excerpt.text.substring(0, 100)}{excerpt.text.length > 100 ? '…' : ''}&rdquo;
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="p-3 bg-[var(--ff-bg-secondary)] rounded text-xs text-[var(--ff-text-secondary)]">
          No meeting linked
        </div>
      )}
    </div>
  );
}
