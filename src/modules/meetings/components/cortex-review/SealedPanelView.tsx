/**
 * SealedPanelView — read-only published view (spec §4.1).
 *
 * Renders the local cortex_meeting_actions snapshot (items + summary + seal badges).
 * A Re-open button (admin+ via PermissionGate :delete) calls unpublish; the server
 * reconciles the stale local row (§4.4).
 */

import { RotateCcw, Loader2, AlertCircle } from 'lucide-react';
import { usePermission } from '@/hooks/usePermission';
import { PermissionGate } from '@/components/PermissionGate';
import { log } from '@/lib/logger';
import { useCortexReviewMutation } from './useCortexReview';
import type { SealedPanel } from './types';
import { confidenceLabel, confidenceColor } from './types';

interface SealedPanelViewProps {
  meetingId: string;
  data: SealedPanel;
}

export function SealedPanelView({ meetingId, data }: SealedPanelViewProps) {
  const { cortexMeetingId, sealSource, humanReviewed, sealedAt, summary, items } = data;
  const { can } = usePermission();
  const reopen = useCortexReviewMutation(meetingId);

  function handleReopen() {
    reopen.mutate({ op: 'unpublish' }, {
      onError: (e) => log.error('Re-open failed', { error: e.message }, 'CortexMeetingReviewPanel'),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">
          Cortex Scribe — Published Actions
        </h3>
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 text-xs rounded-full bg-green-600/20 text-green-500">
            {sealSource === 'human' ? 'Human Sealed' : 'Auto Sealed'}
          </span>
          {humanReviewed && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-blue-600/20 text-blue-400">
              Human Reviewed
            </span>
          )}
        </div>
      </div>

      {sealedAt && (
        <p className="text-xs text-[var(--ff-text-secondary)]">
          Published {new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(sealedAt))}
        </p>
      )}

      {summary && (
        <p className="text-sm text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)] rounded-lg p-3">
          {summary}
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-[var(--ff-text-secondary)]">No action items in this published snapshot.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={item.action_id || `item-${idx}`} className="border border-[var(--ff-border-light)] rounded-lg p-3">
              <p className="text-sm text-[var(--ff-text-primary)]">{item.text}</p>
              <div className="flex flex-wrap gap-3 mt-1 text-xs text-[var(--ff-text-secondary)]">
                {item.owner && <span>Owner: <strong>{item.owner}</strong></span>}
                {item.due && <span>Due: <strong>{item.due}</strong></span>}
                <span className={confidenceColor(item.confidence)}>
                  {confidenceLabel(item.confidence)} confidence
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {reopen.isError && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5" />{reopen.error.message}
        </p>
      )}

      <PermissionGate permission="cortex.review" action="delete">
        <button
          onClick={handleReopen}
          disabled={reopen.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-orange-400 hover:text-orange-300 border border-orange-500/30 hover:border-orange-400/50 rounded-lg transition-colors disabled:opacity-50"
          title="Re-open for review (admin)"
        >
          {reopen.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
          {reopen.isPending ? 'Re-opening…' : 'Re-open for Review'}
        </button>
      </PermissionGate>

      {/* Cortex meeting id is operational detail — only shown to admin (delete tier) */}
      {can('cortex.review', 'delete') && (
        <p className="text-xs text-[var(--ff-text-tertiary)]">Cortex ID: {cortexMeetingId}</p>
      )}
    </div>
  );
}
