/**
 * One row of the daily check-in board.
 *
 * Split out of the board page to keep that component under the 200-line limit.
 * A blocked row is tinted and is the only row offering an action, because it is
 * the only one that needs a human to do something.
 */

import { AlertTriangle } from 'lucide-react';
import {
  CHECKIN_WARNING_LABELS,
  type CheckinWarning,
} from '@/modules/health-safety/types/checkin.types';

export interface CheckinRow {
  id: string;
  worker_name: string;
  project_name: string | null;
  contractor_name: string | null;
  capture_mode: string;
  clearance: string;
  blocked_reasons: string[];
  declared_activities: string[];
  hazard_reported: string | null;
  warnings: string[];
  clearance_note: string | null;
}

const BLOCK_LABELS: Record<string, string> = {
  self_declared_unfit: 'Declared unfit',
  medical_not_current: 'No current medical',
};

export function CheckinBoardRow({
  row,
  busy,
  onClear,
}: {
  row: CheckinRow;
  busy: boolean;
  onClear: () => void;
}) {
  const blocked = row.clearance === 'blocked';
  const findings = [
    ...row.blocked_reasons.map((b) => BLOCK_LABELS[b] ?? b),
    ...row.warnings.map((w) => CHECKIN_WARNING_LABELS[w as CheckinWarning] ?? w),
  ];

  return (
    <tr
      className={`border-t border-[var(--ff-border-light)] ${
        blocked ? 'bg-red-50/60 dark:bg-red-900/10' : ''
      }`}
    >
      <td className="px-4 py-2 font-medium text-[var(--ff-text-primary)]">
        {row.worker_name}
        {row.capture_mode === 'crew_lead' && (
          <span
            className="ml-2 text-xs text-[var(--ff-text-tertiary)]"
            title="Attested by a crew lead, not declared personally — weaker evidence than a personal declaration"
          >
            lead-attested
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-[var(--ff-text-secondary)]">
        {row.contractor_name ?? 'Velocity'}
        {row.project_name ? ` · ${row.project_name}` : ''}
      </td>
      <td className="px-4 py-2">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded whitespace-nowrap ${
            blocked
              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              : row.clearance === 'cleared_by_override'
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          }`}
        >
          {blocked && <AlertTriangle className="w-3 h-3" />}
          {blocked ? 'Blocked' : row.clearance === 'cleared_by_override' ? 'Overridden' : 'Cleared'}
        </span>
      </td>
      <td className="px-4 py-2 text-xs text-[var(--ff-text-secondary)]">
        {findings.join(' · ') || '—'}
        {row.hazard_reported && (
          <div className="mt-1 text-[var(--ff-text-tertiary)]">
            &ldquo;{row.hazard_reported}&rdquo;
          </div>
        )}
      </td>
      <td className="px-4 py-2 text-right whitespace-nowrap">
        {blocked ? (
          <button
            onClick={onClear}
            disabled={busy}
            className="text-[var(--ff-primary-500)] hover:underline disabled:opacity-50"
          >
            {busy ? 'Clearing…' : 'Clear'}
          </button>
        ) : (
          <span className="text-[var(--ff-text-tertiary)]" title={row.clearance_note ?? ''}>
            —
          </span>
        )}
      </td>
    </tr>
  );
}
