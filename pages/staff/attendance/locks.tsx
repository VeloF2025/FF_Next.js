/**
 * /staff/attendance/locks — weekly lock management.
 *
 * Shows recent lock rows with lock/unlock controls. Export action elsewhere
 * auto-locks the week; this page is for HR-level overrides.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import { BulkLockSection } from '@/components/attendance/BulkLockSection';
import { LockReasonPrompt } from '@/components/attendance/LockReasonPrompt';
import { LockRowsTable, type LockRow } from '@/components/attendance/LockRowsTable';
import { thisWeekMondaySast } from '@/components/attendance/dateUtils';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import { useCanDo } from '@/hooks/usePermission';

function parseApiError(body: unknown, status: number): string {
  const e = (body as { error?: { message?: string } | string } | null)?.error;
  if (typeof e === 'string') return e;
  return e?.message ?? `HTTP ${status}`;
}

export default function StaffAttendanceLocksPage() {
  const [locks, setLocks] = useState<LockRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [newWeek, setNewWeek] = useState(thisWeekMondaySast());
  const [newReason, setNewReason] = useState('');
  // #2006: gate the bulk-lock UI on the actual RBAC permission rather than a
  // hard-coded role-name list. Server-side withPermission is the real
  // enforcement; this only hides the form for users who'd hit a 403.
  const canBulkLock = useCanDo('people.staff.attendance.bulk_lock', 'create');
  // #2005: capture unlock / re-lock reasons via an inline prompt instead of
  // window.prompt and a hard-coded 'manual-relock' reason.
  const [pending, setPending] = useState<{ week: string; action: 'lock' | 'unlock' } | null>(null);
  const [pendingReason, setPendingReason] = useState('');

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

  function openPrompt(week: string, action: 'lock' | 'unlock') {
    setPendingReason('');
    setPending({ week, action });
  }
  function closePrompt() {
    setPending(null);
    setPendingReason('');
  }
  function confirmPending() {
    if (!pending) return;
    const reason = pendingReason.trim();
    // Unlock needs a ≥10-char audit reason (server enforces the same); re-lock
    // needs a short one so the audit trail isn't empty.
    const minLen = pending.action === 'unlock' ? 10 : 3;
    if (reason.length < minLen) {
      setError(`Reason must be at least ${minLen} characters.`);
      return;
    }
    void call(pending.action, pending.week, reason);
    closePrompt();
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

        {canBulkLock && <BulkLockSection onCommitted={load} />}

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

        {pending && (
          <LockReasonPrompt
            action={pending.action}
            week={pending.week}
            reason={pendingReason}
            busy={busy === pending.week}
            onReasonChange={setPendingReason}
            onConfirm={confirmPending}
            onCancel={closePrompt}
          />
        )}

        {loading && (
          <div className="flex items-center gap-2 text-neutral-400 text-sm">
            <LoadingSpinner /> Loading…
          </div>
        )}

        {!loading && locks && (
          <LockRowsTable locks={locks} busy={busy} onAction={openPrompt} />
        )}
      </div>
    </AppLayout>
  );
}
