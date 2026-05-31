/**
 * CortexMeetingReviewPanel
 *
 * Mounted inside MeetingDetailModal for Teams-sourced meetings on the Action Items
 * tab (spec §4.1). The mount is already wrapped in a view PermissionGate, so this
 * component only renders for users with cortex.review:view.
 *
 * Three states (decided server-side):
 *   unsealed  → UnsealedPanelView (pre-seal reviewer)
 *   sealed    → SealedPanelView (read-only published view + Re-open)
 *   none      → quiet note
 *
 * The fetch is gated by `active` + view permission so it never round-trips Cortex
 * when the panel is hidden (wrong tab / no permission).
 */

import { Loader2, AlertCircle } from 'lucide-react';
import { usePermission } from '@/hooks/usePermission';
import { useCortexReviewQuery } from './cortex-review/useCortexReview';
import { SealedPanelView } from './cortex-review/SealedPanelView';
import { UnsealedPanelView } from './cortex-review/UnsealedPanelView';

interface CortexMeetingReviewPanelProps {
  /** FibreFlow meeting.id (numeric as string) */
  meetingId: string;
  /** True when the panel is visible (its tab is active); gates the data fetch. */
  active?: boolean;
}

export function CortexMeetingReviewPanel({ meetingId, active = true }: CortexMeetingReviewPanelProps) {
  const { can } = usePermission();
  // Only fetch when visible AND the user can view — avoids a needless Cortex round-trip.
  const enabled = active && can('cortex.review', 'view');

  const { data, isLoading, isError, error, refetch } = useCortexReviewQuery(meetingId, enabled);

  if (!enabled) return null;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-[var(--ff-text-secondary)]">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading Cortex actions…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-red-400">
        <AlertCircle className="w-4 h-4" />
        {error instanceof Error ? error.message : 'Failed to load Cortex actions'}
        <button onClick={() => refetch()} className="ml-2 underline text-xs">retry</button>
      </div>
    );
  }

  if (!data || data.panelState === 'none') {
    return (
      <p className="py-4 text-xs text-[var(--ff-text-tertiary)]">
        No Cortex Scribe actions for this meeting.
      </p>
    );
  }

  if (data.panelState === 'sealed') {
    return <SealedPanelView meetingId={meetingId} data={data} />;
  }

  return <UnsealedPanelView meetingId={meetingId} data={data} />;
}

export default CortexMeetingReviewPanel;
