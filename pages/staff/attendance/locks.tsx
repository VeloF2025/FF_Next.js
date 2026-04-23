/**
 * /staff/attendance/locks — weekly lock management.
 *
 * Shows recent lock rows with lock/unlock controls. Export action elsewhere
 * auto-locks the week; this page is for HR-level overrides.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Lock, Unlock } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';

interface LockRow {
  week_start_date: string;
  locked_at: string;
  locked_by: string;
  lock_reason: string | null;
  unlocked_at: string | null;
  unlocked_by: string | null;
  unlock_reason: string | null;
}

function parseApiError(body: unknown, status: number): string {
  const e = (body as { error?: { message?: string } | string } | null)?.error;
  if (typeof e === 'string') return e;
  return e?.message ?? `HTTP ${status}`;
}

function formatTs(ts: string | null): string {
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

function thisWeekMonday(): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  const dow = d.getUTCDay();
  const deltaToMon = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + deltaToMon);
  return d.toISOString().slice(0, 10);
}

export default function StaffAttendanceLocksPage() {
  const [locks, setLocks] = useState<LockRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [newWeek, setNewWeek] = useState(thisWeekMonday());
  const [newReason, setNewReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/staff/attendance-weekly-locks', {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        let body: unknown = {};
        try {
          body = await res.json();
        } catch (parseErr) {
          log.warn('[locks] non-JSON error body', {
            status: res.status,
            err: parseErr instanceof Error ? parseErr.message : String(parseErr),
          });
        }
        throw new Error(parseApiError(body, res.status));
      }
      const body = (await res.json()) as {
        success: true;
        data: { locks: LockRow[] };
      };
      setLocks(body.data.locks);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      log.error('[locks] load failed', { error: message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function call(
    action: 'lock' | 'unlock',
    weekStart: string,
    reason: string
  ) {
    setBusy(weekStart);
    setError(null);
    try {
      const res = await fetch('/api/staff/attendance-weekly-locks', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          week_start_date: weekStart,
          action,
          lock_reason: action === 'lock' ? reason : undefined,
          unlock_reason: action === 'unlock' ? reason : undefined,
        }),
      });
      if (!res.ok) {
        let body: unknown = {};
        try {
          body = await res.json();
        } catch (parseErr) {
          log.warn('[locks] non-JSON action body', {
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
      log.error('[locks] action failed', { action, weekStart, error: message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppLayout>
      <AttendanceNav />
      <div className="p-6 space-y-4">
        <header>
          <h1 className="text-2xl font-semibold">Weekly Locks</h1>
          <p className="text-sm text-neutral-400">
            Payroll weeks freeze on export. HR can unlock to allow a correction, and re-lock afterwards.
          </p>
        </header>

        {error && (
          <div className="rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <div>{error}</div>
          </div>
        )}

        <section className="rounded border border-neutral-800 bg-neutral-900 p-3 space-y-2 max-w-xl">
          <div className="text-sm font-medium">Manually lock a week</div>
          <div className="flex gap-2 items-center">
            <input
              type="date"
              value={newWeek}
              onChange={(e) => setNewWeek(e.target.value)}
              className="bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-sm"
            />
            <input
              type="text"
              value={newReason}
              placeholder="Lock reason (optional)"
              onChange={(e) => setNewReason(e.target.value)}
              className="bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-sm flex-1"
            />
            <button
              type="button"
              disabled={busy === newWeek}
              onClick={() => call('lock', newWeek, newReason)}
              className="px-3 py-1 rounded bg-amber-900/40 border border-amber-700 hover:bg-amber-800/60 disabled:opacity-50 text-sm flex items-center gap-1"
            >
              <Lock className="w-4 h-4" /> Lock
            </button>
          </div>
        </section>

        {loading && (
          <div className="flex items-center gap-2 text-neutral-400 text-sm">
            <LoadingSpinner /> Loading…
          </div>
        )}

        {!loading && locks && (
          <div className="overflow-x-auto border border-neutral-800 rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-900 text-neutral-300">
                <tr>
                  <th className="text-left px-3 py-2">Week Start</th>
                  <th className="text-left px-3 py-2">State</th>
                  <th className="text-left px-3 py-2">Locked</th>
                  <th className="text-left px-3 py-2">Unlocked</th>
                  <th className="text-left px-3 py-2">Reason</th>
                  <th className="text-left px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {locks.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-6 text-neutral-500">
                      No locks yet. Exports will create them automatically.
                    </td>
                  </tr>
                )}
                {locks.map((l) => {
                  const isLocked = l.unlocked_at == null;
                  return (
                    <tr key={l.week_start_date} className="border-t border-neutral-800 hover:bg-neutral-900/50">
                      <td className="px-3 py-2 font-medium">{l.week_start_date}</td>
                      <td className="px-3 py-2">
                        {isLocked ? (
                          <span className="text-amber-400 inline-flex items-center gap-1">
                            <Lock className="w-3 h-3" /> locked
                          </span>
                        ) : (
                          <span className="text-emerald-400 inline-flex items-center gap-1">
                            <Unlock className="w-3 h-3" /> unlocked
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-neutral-400">
                        {formatTs(l.locked_at)}
                      </td>
                      <td className="px-3 py-2 text-xs text-neutral-400">
                        {formatTs(l.unlocked_at)}
                      </td>
                      <td className="px-3 py-2 max-w-sm text-xs">
                        {isLocked ? l.lock_reason : l.unlock_reason}
                      </td>
                      <td className="px-3 py-2">
                        {isLocked ? (
                          <button
                            type="button"
                            disabled={busy === l.week_start_date}
                            onClick={() => {
                              const reason = window.prompt(
                                'Unlock reason (≥ 10 chars, audit trail):'
                              );
                              if (reason && reason.length >= 10) {
                                call('unlock', l.week_start_date, reason);
                              }
                            }}
                            className="px-2 py-1 rounded bg-emerald-900/40 border border-emerald-700 hover:bg-emerald-800/60 disabled:opacity-50 text-xs flex items-center gap-1"
                          >
                            <Unlock className="w-3 h-3" /> Unlock
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy === l.week_start_date}
                            onClick={() => call('lock', l.week_start_date, 'manual-relock')}
                            className="px-2 py-1 rounded bg-amber-900/40 border border-amber-700 hover:bg-amber-800/60 disabled:opacity-50 text-xs flex items-center gap-1"
                          >
                            <Lock className="w-3 h-3" /> Re-lock
                          </button>
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
