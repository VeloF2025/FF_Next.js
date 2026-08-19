/**
 * BySiteTab — who is on which site over the selected date range.
 *
 * Reads the same /api/field/attendance payload the Time tab does and groups
 * it client-side; there is no second endpoint and no second definition of
 * "on site" (see bySite.ts for the attribution rule and why it is narrow).
 *
 * Defaults to today rather than the current week: the question this answers
 * is "who is where", which is a today question.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, MapPin, HelpCircle } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import { getFieldAttendance, type FieldAttendanceRow } from '../api';
import { getSastToday, safeFormatTime, safeFormatDate } from '../timeHelpers';
import { groupBySite, type SiteGroup } from '../bySite';
import { proximityLabel } from '../aoiProximity';

function WorkerLine({ row, showDate }: { row: FieldAttendanceRow; showDate: boolean }) {
  const inTime = row.clock_in_at ? safeFormatTime(row.clock_in_at) : '— missing';
  const outTime = row.clock_out_at ? safeFormatTime(row.clock_out_at) : 'open';
  // Only meaningful in the unattributed bucket, where the reader needs to see
  // how far off they were; on a named site it would restate the heading.
  const nearest = proximityLabel(row.clock_in_aoi_project, row.clock_in_aoi_distance_m);

  return (
    <li className="flex items-center gap-3 px-3 py-1.5 border-t border-neutral-800 text-sm">
      <span className="text-neutral-200 flex-1 truncate">{row.staff_name}</span>
      {showDate && (
        <span className="text-neutral-500 text-xs whitespace-nowrap">
          {safeFormatDate(row.work_date)}
        </span>
      )}
      <span className="text-neutral-400 tabular-nums text-xs whitespace-nowrap">
        {inTime} → {outTime}
      </span>
      {nearest && (
        <span className="text-rose-300 text-xs whitespace-nowrap">nearest {row.clock_in_aoi_project ?? 'site'} {nearest}</span>
      )}
    </li>
  );
}

function SiteCard({ group, showDate }: { group: SiteGroup; showDate: boolean }) {
  const unattributed = group.siteName === null;
  return (
    <div className="border border-neutral-800 rounded overflow-hidden">
      <div className="px-3 py-2 bg-neutral-900 border-b border-neutral-800 flex items-center gap-2">
        {unattributed
          ? <HelpCircle className="w-4 h-4 text-neutral-500 shrink-0" />
          : <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />}
        <span className={`font-medium text-sm ${unattributed ? 'text-neutral-400' : 'text-neutral-100'}`}>
          {group.siteName ?? 'Not on any site'}
        </span>
        <span className="ml-auto text-xs text-neutral-500">
          {group.workerCount} {group.workerCount === 1 ? 'worker' : 'workers'}
        </span>
      </div>
      <ul>
        {group.rows.map((row) => (
          <WorkerLine key={row.entry_id} row={row} showDate={showDate} />
        ))}
      </ul>
    </div>
  );
}

export function BySiteTab() {
  const today = getSastToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<FieldAttendanceRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await getFieldAttendance(from, to, 'all'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      log.error('[BySiteTab] load failed', { from, to, error: message });
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const groups = rows ? groupBySite(rows) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From date"
          className="px-2 py-1.5 rounded border border-neutral-700 bg-neutral-900 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <span className="text-neutral-500 text-sm">—</span>
        <input
          type="date"
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To date"
          className="px-2 py-1.5 rounded border border-neutral-700 bg-neutral-900 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </div>

      <p className="text-xs text-neutral-500">
        A shift is listed under a site only when a clock event landed inside that
        site&rsquo;s boundary. Everyone else appears under &ldquo;Not on any
        site&rdquo; with their distance — the nearest site is not necessarily
        anywhere they were working.
      </p>

      {error && (
        <div className="rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-neutral-400 text-sm">
          <LoadingSpinner /> Loading…
        </div>
      )}

      {!loading && rows !== null && groups.length === 0 && (
        <p className="text-neutral-500 text-sm py-8 text-center">No clock activity in range.</p>
      )}

      {!loading && groups.map((group) => (
        <SiteCard key={group.siteName ?? '__unattributed__'} group={group} showDate={from !== to} />
      ))}
    </div>
  );
}
