/**
 * TimeTab — clock-in/out viewer + manual-entry + time-correction for field workers.
 *
 * - Date-range picker (default = current SAST Mon–Sun week).
 * - Status filter: all | pending | active.
 * - Loads getFieldAttendance(), groups rows by worker.
 * - "Add entry" → ManualEntryDialog.
 * - Each worker's entries → WorkerGroupCard → WorkerTimeRow → AdjustTimeDialog.
 * - Corrections approve/reject deferred — link to /staff/attendance/corrections.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Plus, ExternalLink } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { getFieldAttendance, type FieldAttendanceRow } from '../api';
import { getCurrentSastWeek } from '../timeHelpers';
import { WorkerGroupCard, type WorkerGroup } from './WorkerGroupCard';
import { ManualEntryDialog } from './ManualEntryDialog';
import { log } from '@/lib/logger';

type StatusFilter = 'all' | 'pending' | 'active';

const STATUS_OPTIONS: readonly { key: StatusFilter; label: string }[] = [
  { key: 'all',     label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'active',  label: 'Active' },
];

function groupByWorker(rows: FieldAttendanceRow[]): WorkerGroup[] {
  const map = new Map<string, WorkerGroup>();
  for (const row of rows) {
    const existing = map.get(row.staff_id);
    if (existing) {
      existing.rows.push(row);
    } else {
      map.set(row.staff_id, {
        staff_id:   row.staff_id,
        staff_name: row.staff_name,
        role:       row.role,
        rows:       [row],
      });
    }
  }
  return Array.from(map.values());
}

export function TimeTab() {
  const defaultWeek = getCurrentSastWeek();
  const [from, setFrom] = useState(defaultWeek.from);
  const [to, setTo]     = useState(defaultWeek.to);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [rows, setRows] = useState<FieldAttendanceRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getFieldAttendance(from, to, status);
      setRows(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      log.error('[TimeTab] load failed', { from, to, status, error: message });
    } finally {
      setLoading(false);
    }
  }, [from, to, status]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = rows ? groupByWorker(rows) : [];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
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

        {/* Status filter */}
        <nav role="tablist" aria-label="Status filter" className="flex gap-1">
          {STATUS_OPTIONS.map((opt) => {
            const isActive = opt.key === status;
            return (
              <button
                key={opt.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setStatus(opt.key)}
                className={`px-3 py-1 rounded-full border text-xs font-medium transition ${
                  isActive
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:border-neutral-600'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={() => setShowManual(true)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded border border-emerald-700 bg-emerald-900/40 hover:bg-emerald-800/60 text-emerald-200 text-sm transition"
        >
          <Plus className="w-4 h-4" />
          Add entry
        </button>
      </div>

      {/* Deferred corrections link */}
      <div className="flex items-center gap-1.5 text-xs text-neutral-500">
        <ExternalLink className="w-3 h-3" />
        <a
          href="/staff/attendance/corrections"
          className="hover:text-neutral-300 underline underline-offset-2 transition-colors"
        >
          Review pending correction requests
        </a>
      </div>

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
        <p className="text-neutral-500 text-sm py-8 text-center">
          No clock activity in range.
        </p>
      )}

      {!loading && groups.map((group) => (
        <WorkerGroupCard key={group.staff_id} group={group} onAdjusted={load} />
      ))}

      {showManual && (
        <ManualEntryDialog
          allRows={rows ?? []}
          onSuccess={load}
          onClose={() => setShowManual(false)}
        />
      )}
    </div>
  );
}
