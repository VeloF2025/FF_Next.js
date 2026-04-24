/**
 * /staff/attendance/corrections — supervisor review queue.
 *
 * Lists pending adjustments for staff the viewer supervises
 * (#1405 / #1407 gate + SQL scope). Approve applies the adjustment
 * and invalidates the affected daily summary so the reconcile cron
 * recomputes; reject requires a >=10-char review note.
 *
 * UX parity with the /my side (#1412):
 *   - Status tabs with live count badges pulled from the handler's
 *     `counts` response (covers every supervisee, not just the
 *     filtered page — so the badge never lies).
 *   - Inline reject drawer with a textarea + live counter instead of
 *     the previous window.prompt — supervisors type context without
 *     a tiny modal.
 *   - Kind label + short hint pulled from the #1410 hints catalogue
 *     so supervisors see "Forgot to clock out" instead of the enum.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  MessageSquare,
  X,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import { useStatusFilterUrlSync } from '@/modules/attendance/corrections/useStatusFilterUrl';

type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';
type StatusFilter = Status | 'all';

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

interface Counts {
  pending: number;
  approved: number;
  rejected: number;
  cancelled: number;
}

interface HintCatalogueEntry {
  label: string;
  placeholder: string;
  hint: string;
  minReasonChars: number;
}

type HintCatalogue = Record<string, HintCatalogueEntry>;

const ZERO_COUNTS: Counts = {
  pending: 0,
  approved: 0,
  rejected: 0,
  cancelled: 0,
};

const REJECT_MIN_CHARS = 10;

const STATUS_TABS: readonly { key: StatusFilter; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];

const VALID_STATUS_FILTERS: readonly StatusFilter[] = STATUS_TABS.map(
  (t) => t.key
);

const DEFAULT_STATUS_FILTER: StatusFilter = 'pending';

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

function prettyKind(kind: string): string {
  return kind.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export default function StaffAttendanceCorrectionsPage() {
  const { statusFilter, setStatusFilter: handleTabChange } =
    useStatusFilterUrlSync<StatusFilter>(
      VALID_STATUS_FILTERS,
      DEFAULT_STATUS_FILTER
    );
  const [adjustments, setAdjustments] = useState<AdjustmentRow[] | null>(null);
  const [counts, setCounts] = useState<Counts>(ZERO_COUNTS);
  const [hints, setHints] = useState<HintCatalogue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  // Hints only fetched once — static catalogue, deploy-busted.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/my/attendance-corrections-hints', {
          credentials: 'same-origin',
        });
        if (!res.ok) return; // Non-fatal — labels fall back to prettyKind().
        const body = (await res.json()) as {
          success: true;
          data: { hints: HintCatalogue };
        };
        if (!cancelled) setHints(body.data.hints);
      } catch (err) {
        log.warn('[corrections] hint catalogue load failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        data: { adjustments: AdjustmentRow[]; counts?: Counts };
      };
      setAdjustments(body.data.adjustments);
      setCounts(body.data.counts ?? ZERO_COUNTS);
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

  async function handleApprove(id: string) {
    await postReview(id, 'approve', '');
  }

  async function postReview(
    id: string,
    action: 'approve' | 'reject',
    reviewNote: string
  ) {
    setReviewing(id);
    setError(null);
    try {
      const res = await fetch('/api/staff/attendance-corrections-review', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adjustment_id: id,
          action,
          review_note: reviewNote || undefined,
        }),
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
      setRejectingId(null);
      setRejectNote('');
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
        <header>
          <h1 className="text-2xl font-semibold">Attendance Corrections</h1>
          <p className="text-sm text-neutral-400">
            Approve or reject staff-submitted changes to clock entries.
          </p>
        </header>

        <nav
          role="tablist"
          aria-label="Correction status filter"
          className="flex gap-2 flex-wrap"
        >
          {STATUS_TABS.map((tab) => {
            const count =
              tab.key === 'all'
                ? counts.pending +
                  counts.approved +
                  counts.rejected +
                  counts.cancelled
                : counts[tab.key];
            const isActive = tab.key === statusFilter;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
                type="button"
                onClick={() => handleTabChange(tab.key)}
                className={`px-3 py-1.5 rounded-full border text-sm font-medium transition ${
                  isActive
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-neutral-900 border-neutral-700 text-neutral-300 hover:border-neutral-600'
                }`}
              >
                {tab.label}
                <span
                  className={`ml-2 inline-block min-w-[1.5rem] px-1.5 py-0.5 rounded-full text-xs tabular-nums ${
                    isActive ? 'bg-white/20' : 'bg-neutral-800 text-neutral-400'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </nav>

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
                {adjustments.map((a) => {
                  const hint = hints?.[a.adjustment_kind];
                  const kindLabel = hint?.label ?? prettyKind(a.adjustment_kind);
                  const isRejecting = rejectingId === a.id;
                  return (
                    <tr
                      key={a.id}
                      className="border-t border-neutral-800 hover:bg-neutral-900/50 align-top"
                    >
                      <td className="px-3 py-2 font-medium">
                        {a.staff_full_name ?? a.entry_staff_id}
                      </td>
                      <td className="px-3 py-2">{a.entry_work_date ?? '—'}</td>
                      <td className="px-3 py-2 text-neutral-300">
                        <div>{kindLabel}</div>
                        {hint?.hint && (
                          <div className="text-xs text-neutral-500 mt-0.5 max-w-xs">
                            {hint.hint}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-neutral-400">
                        {formatTs(a.entry_clock_in_at)}
                        <br />
                        {formatTs(a.entry_clock_out_at)}
                      </td>
                      <td className="px-3 py-2 text-xs text-emerald-300">
                        {a.adjusted_clock_in_at
                          ? formatTs(a.adjusted_clock_in_at)
                          : '—'}
                        <br />
                        {a.adjusted_clock_out_at
                          ? formatTs(a.adjusted_clock_out_at)
                          : '—'}
                      </td>
                      <td className="px-3 py-2 max-w-sm">{a.reason}</td>
                      <td className="px-3 py-2 text-xs text-neutral-400 whitespace-nowrap">
                        <Clock className="w-3 h-3 inline mr-1" />
                        {formatTs(a.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        {a.status !== 'pending' ? (
                          <div className="text-xs text-neutral-500">
                            {a.status}
                            {a.reviewed_at && ` · ${formatTs(a.reviewed_at)}`}
                            {a.review_note && (
                              <div className="mt-1 text-neutral-400 italic max-w-xs">
                                <MessageSquare className="w-3 h-3 inline mr-1" />
                                {a.review_note}
                              </div>
                            )}
                          </div>
                        ) : isRejecting ? (
                          <RejectDrawer
                            busy={reviewing === a.id}
                            note={rejectNote}
                            onNoteChange={setRejectNote}
                            onCancel={() => {
                              setRejectingId(null);
                              setRejectNote('');
                            }}
                            onConfirm={() => postReview(a.id, 'reject', rejectNote.trim())}
                          />
                        ) : (
                          <div className="flex gap-1">
                            <button
                              type="button"
                              disabled={reviewing === a.id}
                              onClick={() => handleApprove(a.id)}
                              className="px-2 py-1 rounded bg-emerald-900/40 border border-emerald-700 hover:bg-emerald-800/60 disabled:opacity-50 text-xs flex items-center gap-1"
                            >
                              <Check className="w-3 h-3" /> Approve
                            </button>
                            <button
                              type="button"
                              disabled={reviewing === a.id}
                              onClick={() => {
                                setRejectingId(a.id);
                                setRejectNote('');
                              }}
                              className="px-2 py-1 rounded bg-red-900/40 border border-red-700 hover:bg-red-800/60 disabled:opacity-50 text-xs flex items-center gap-1"
                            >
                              <X className="w-3 h-3" /> Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function RejectDrawer({
  busy,
  note,
  onNoteChange,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  note: string;
  onNoteChange: (next: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const trimmed = note.trim();
  const ok = trimmed.length >= REJECT_MIN_CHARS;
  return (
    <div className="flex flex-col gap-1 min-w-[20rem]">
      <textarea
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        placeholder="Why is this being rejected? (shown to the staff member)"
        rows={3}
        className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white focus:border-red-500 focus:ring-1 focus:ring-red-500"
      />
      <div className="flex items-center justify-between text-[11px]">
        <span
          className={
            ok ? 'text-neutral-500' : 'text-amber-400 font-medium'
          }
        >
          {ok
            ? 'Looks good.'
            : `${Math.max(0, REJECT_MIN_CHARS - trimmed.length)} more char${
                REJECT_MIN_CHARS - trimmed.length === 1 ? '' : 's'
              } needed.`}
        </span>
        <span className="text-neutral-500 tabular-nums">
          {trimmed.length} / {REJECT_MIN_CHARS}
        </span>
      </div>
      <div className="flex gap-1 mt-1">
        <button
          type="button"
          disabled={!ok || busy}
          onClick={onConfirm}
          className="flex-1 px-2 py-1 rounded bg-red-800 border border-red-700 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs"
        >
          {busy ? 'Rejecting…' : 'Confirm reject'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="px-2 py-1 rounded border border-neutral-700 hover:border-neutral-600 disabled:opacity-50 text-xs"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
