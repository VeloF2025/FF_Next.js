/**
 * WorkerTimeRow — one attendance entry in the Time tab table.
 *
 * Shows: date, clock-in, clock-out (or open/missing labels), hours, status badge.
 * Each clock time carries a ProximityBadge beneath it — where that event
 * happened relative to the nearest project site. The two are shown separately
 * rather than summarised into one verdict because they genuinely differ:
 * staff who travel to site after clocking in read as off-site at clock-in and
 * on-site at clock-out, and collapsing that loses the whole signal.
 * "Fix time" opens AdjustTimeDialog for the entry.
 */

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { type FieldAttendanceRow } from '../api';
import { safeFormatTime, safeFormatDate, formatHours } from '../timeHelpers';
import { AdjustTimeDialog } from './AdjustTimeDialog';
import { ProximityBadge } from './ProximityBadge';

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  complete:   'bg-emerald-900/50 text-emerald-300 border-emerald-700',
  active:     'bg-blue-900/50 text-blue-300 border-blue-700',
  open:       'bg-amber-900/50 text-amber-300 border-amber-700',
  pending:    'bg-neutral-800 text-neutral-400 border-neutral-600',
  adjusted:   'bg-purple-900/50 text-purple-300 border-purple-700',
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? 'bg-neutral-800 text-neutral-400 border-neutral-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs capitalize ${style}`}>
      {status}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface WorkerTimeRowProps {
  row: FieldAttendanceRow;
  /** Called after a successful adjustment so the parent re-fetches. */
  onAdjusted: () => void;
}

export function WorkerTimeRow({ row, onAdjusted }: WorkerTimeRowProps) {
  const [showAdjust, setShowAdjust] = useState(false);

  const clockInDisplay = row.clock_in_at ? safeFormatTime(row.clock_in_at) : '— missing';
  const clockOutDisplay = row.clock_out_at
    ? safeFormatTime(row.clock_out_at)
    : row.clock_in_at
      ? '— open'
      : '— missing';

  return (
    <>
      <tr className="border-t border-neutral-800 hover:bg-neutral-900/50 align-middle text-sm">
        {/* Date */}
        <td className="px-3 py-2 text-neutral-300 whitespace-nowrap">
          {safeFormatDate(row.work_date)}
        </td>

        {/* Clock in */}
        <td className={`px-3 py-2 tabular-nums whitespace-nowrap ${row.clock_in_at ? 'text-neutral-200' : 'text-neutral-500 italic'}`}>
          {clockInDisplay}
          <ProximityBadge
            event="Clock in"
            projectName={row.clock_in_aoi_project}
            distanceM={row.clock_in_aoi_distance_m}
          />
        </td>

        {/* Clock out */}
        <td className={`px-3 py-2 tabular-nums whitespace-nowrap ${row.clock_out_at ? 'text-neutral-200' : 'text-neutral-500 italic'}`}>
          {clockOutDisplay}
          <ProximityBadge
            event="Clock out"
            projectName={row.clock_out_aoi_project}
            distanceM={row.clock_out_aoi_distance_m}
          />
        </td>

        {/* Hours */}
        <td className="px-3 py-2 tabular-nums text-neutral-300 whitespace-nowrap">
          {formatHours(row.hours)}
        </td>

        {/* Status */}
        <td className="px-3 py-2">
          <StatusBadge status={row.entry_status} />
        </td>

        {/* Action */}
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={() => setShowAdjust(true)}
            aria-label={`Fix time for ${row.staff_name} on ${row.work_date}`}
            className="px-2 py-1 rounded border border-neutral-700 hover:border-emerald-600 hover:text-emerald-300 text-neutral-400 text-xs flex items-center gap-1 transition-colors"
          >
            <Pencil className="w-3 h-3" />
            Fix time
          </button>
        </td>
      </tr>

      {showAdjust && (
        <AdjustTimeDialog
          row={row}
          onSuccess={onAdjusted}
          onClose={() => setShowAdjust(false)}
        />
      )}
    </>
  );
}
