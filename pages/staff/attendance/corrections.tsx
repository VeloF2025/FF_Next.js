/**
 * /staff/attendance/corrections — supervisor review queue.
 *
 * Lists pending adjustments with approve / reject controls. Approve
 * applies the adjustment to the underlying entry and invalidates the
 * affected daily summary so the reconcile cron recomputes.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, X, Clock } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';

type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';

interface AdjustmentRow {
  id: string;
  entry_id: string;
  requested_by: string;
  adjustment_kind: string;
  adjusted_clock_in_at: string | null;
  adjusted_clock_out_at: string | null;
  adjusted_site_geofence_id: string | null;
  reason: string;
  status: Status;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  entry_staff_id?: string;
  entry_work_date?: string;
  entry_clock_in_at?: string;
  entry_clock_out_at?: string | null;
  staff_full_name?: string;
}

function parseApiError(body: unknown, status: number): string {
  const e = (body as { error?: { message?: string } | string } | null)?.error;
  if (typeof e === 'string') return e;
  return e?.message ?? `HTTP ${status}`;
}

function formatTs(ts: string | null | undefined): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return ts;
  }
}

export default function StaffAttendanceCorrectionsPage() {
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('pending');
  const [adjustments, setAdjustments] = useState<AdjustmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/staff/attendance-corrections?status=${encodeURIComponent(statusFilter)}`,
        { credentials: 'same-origin' }
      );
      if (!res.ok) {
        let body: unknown = {};
        try {
          body = await res.json();
        } catch (parseErr) {
          log.warn('[corrections] non-JSON error body', {
            status: res.status,
            err: parseErr instanceof Error ? parseErr.message : String(parseErr),
          });
        }
        throw new Error(parseApiError(body, res.status));
      }
      const body = (await res.json()) as {
        success: true;
        data: { adjustments: AdjustmentRow[] };
      };
      setAdjustments(body.data.adjustments);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      log.error('[corrections] load failed', { statusFilter, error: message });
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleReview(id: string, action: 'approve' | 'reject') {
    setReviewing(id);
    try {
      const note = action === 'reject'
        ? (window.prompt('Reason for rejection (will be shown to the staff member):') ?? '')
        : '';
      const res = await fetch('/api/staff/attendance-corrections-review', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjustment_id: id, action, review_note: note || undefined }),
      });
      if (!res.ok) {
        let body: unknown = {};
        try {
          body = await res.json();
        } catch (parseErr) {
          log.warn('[corrections] non-JSON review body', {
            status: res.status,
            err: parseErr instanceof Error ? parseErr.message : String(parseErr),
          });
        }
        throw new Error(parseApiError(body, res.status));
      }
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      log.error('[corrections] review failed', { id, action, error: message });
    } finally {
      setReviewing(null);
    }
  }

  return (
    <AppLayout>
      <AttendanceNav />
      <div className="p-6 space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Attendance Corrections</h1>
            <p className="text-sm text-neutral-400">
              Approve or reject staff-submitted changes to clock entries.
            </p>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as Status | 'all')}
            className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
            aria-label="Filter by status"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All (recent)</option>
          </select>
        </header>

        {error && (
          <div className="rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <div>{error}</div>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-neutral-400 text-sm">
            <LoadingSpinner /> Loading…
          </div>
        )}

        {!loading && adjustments && (
          <div className="overflow-x-auto border border-neutral-800 rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-900 text-neutral-300">
                <tr>
                  <th className="text-left px-3 py-2">Staff</th>
                  <th className="text-left px-3 py-2">Work Date</th>
                  <th className="text-left px-3 py-2">Kind</th>
                  <th className="text-left px-3 py-2">Current In / Out</th>
                  <th className="text-left px-3 py-2">Proposed In / Out</th>
                  <th className="text-left px-3 py-2">Reason</th>
                  <th className="text-left px-3 py-2">Submitted</th>
                  <th className="text-left px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-6 text-neutral-500">
                      No corrections in this status.
                    </td>
                  </tr>
                )}
                {adjustments.map((a) => (
                  <tr key={a.id} className="border-t border-neutral-800 hover:bg-neutral-900/50 align-top">
                    <td className="px-3 py-2 font-medium">{a.staff_full_name ?? a.entry_staff_id}</td>
                    <td className="px-3 py-2">{a.entry_work_date ?? '—'}</td>
                    <td className="px-3 py-2 text-neutral-300">{a.adjustment_kind}</td>
                    <td className="px-3 py-2 text-xs text-neutral-400">
                      {formatTs(a.entry_clock_in_at)}<br />
                      {formatTs(a.entry_clock_out_at)}
                    </td>
                    <td className="px-3 py-2 text-xs text-emerald-300">
                      {a.adjusted_clock_in_at ? formatTs(a.adjusted_clock_in_at) : '—'}<br />
                      {a.adjusted_clock_out_at ? formatTs(a.adjusted_clock_out_at) : '—'}
                    </td>
                    <td className="px-3 py-2 max-w-sm">{a.reason}</td>
                    <td className="px-3 py-2 text-xs text-neutral-400 whitespace-nowrap">
                      <Clock className="w-3 h-3 inline mr-1" />
                      {formatTs(a.created_at)}
                    </td>
                    <td className="px-3 py-2">
                      {a.status !== 'pending' ? (
                        <span className="text-xs text-neutral-500">
                          {a.status} {a.reviewed_at ? `· ${formatTs(a.reviewed_at)}` : ''}
                        </span>
                      ) : (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            disabled={reviewing === a.id}
                            onClick={() => handleReview(a.id, 'approve')}
                            className="px-2 py-1 rounded bg-emerald-900/40 border border-emerald-700 hover:bg-emerald-800/60 disabled:opacity-50 text-xs flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" /> Approve
                          </button>
                          <button
                            type="button"
                            disabled={reviewing === a.id}
                            onClick={() => handleReview(a.id, 'reject')}
                            className="px-2 py-1 rounded bg-red-900/40 border border-red-700 hover:bg-red-800/60 disabled:opacity-50 text-xs flex items-center gap-1"
                          >
                            <X className="w-3 h-3" /> Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
