/**
 * Bulk lock weeks UI block (PRD-061 §6.4.1, FR-BULK-*).
 *
 * Lets a super_admin / admin lock a list of payroll weeks in one action
 * with a shared reason note. Posts to /api/staff/attendance-bulk-lock,
 * which is transactional and writes one audit row per affected staff.
 *
 * UX flow:
 *   1. User clicks "Open bulk lock" → form expands.
 *   2. Adds Mondays via the date input + "Add week" (any non-Monday
 *      auto-snaps to the containing ISO Monday so the user doesn't have
 *      to know the convention).
 *   3. Types a reason note ≥ 10 chars (live char-count gate).
 *   4. Clicks "Lock N weeks" → green confirmation with batch_id and
 *      `staff_audited` count, then auto-collapses after 2.5s.
 *
 * Permission gate: this block is only mounted when the user actually
 * has `people.staff.attendance.bulk_lock` create — server still enforces,
 * but hiding the form for read-only viewers prevents the click-then-403
 * dead-end.
 */

import { useEffect, useRef, useState } from 'react';
import { Layers, Lock, X } from 'lucide-react';
import { log } from '@/lib/logger';
import { isoMondayOf, thisWeekMondaySast } from './dateUtils';

export function BulkLockSection({ onCommitted }: { onCommitted: () => void }) {
  const [open, setOpen] = useState(false);
  const [weeks, setWeeks] = useState<string[]>([thisWeekMondaySast()]);
  const [draftWeek, setDraftWeek] = useState<string>(thisWeekMondaySast());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  // Track the auto-close timer so we can clear it on unmount / state-reset
  // and avoid setState-on-unmounted noise.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const reasonValid = reason.trim().length >= 10;

  function addWeek() {
    if (!draftWeek) return;
    if (weeks.includes(draftWeek)) {
      setErrorMsg(`Week ${draftWeek} is already in the list.`);
      return;
    }
    const monday = isoMondayOf(draftWeek);
    setWeeks((s) => Array.from(new Set([...s, monday])).sort());
    setErrorMsg(null);
  }

  function removeWeek(w: string) {
    setWeeks((s) => s.filter((x) => x !== w));
  }

  async function submit() {
    setBusy(true);
    setErrorMsg(null);
    setResultMsg(null);
    try {
      const res = await fetch('/api/staff/attendance-bulk-lock', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          week_start_dates: weeks,
          reason: reason.trim(),
        }),
      });
      const body = (await res.json()) as
        | { success: true; data: { batch_id: string; weeks: string[]; locks_created: number; staff_audited: number } }
        | { success: false; error?: { message?: string } };
      if (!res.ok || !('success' in body) || !body.success) {
        const msg = ('error' in body ? body.error?.message : null) ?? `HTTP ${res.status}`;
        setErrorMsg(msg);
        return;
      }
      setResultMsg(
        `Locked ${body.data.locks_created} week(s); ${body.data.staff_audited} per-staff audit row(s) written. Batch ${body.data.batch_id.slice(0, 8)}…`
      );
      onCommitted();
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        setOpen(false);
        setReason('');
        setResultMsg(null);
        closeTimerRef.current = null;
      }, 2500);
    } catch (err) {
      log.error('[locks] bulk lock failed', { error: err instanceof Error ? err.message : String(err) });
      setErrorMsg('Network error during bulk lock.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded border border-neutral-800 bg-neutral-900 p-3 space-y-2 max-w-xl">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium flex items-center gap-2">
          <Layers className="w-4 h-4 text-amber-400" />
          Bulk lock weeks
        </div>
        <button
          type="button"
          onClick={() => setOpen((s) => !s)}
          className="px-3 py-1 rounded border border-neutral-700 hover:bg-neutral-800 text-xs"
        >
          {open ? 'Cancel' : 'Open bulk lock'}
        </button>
      </div>
      {!open && (
        <div className="text-xs text-neutral-500">
          Lock several payroll weeks in one transactional action. Requires admin or super-admin.
        </div>
      )}
      {open && (
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-xs text-neutral-400">Weeks (each must be a Monday)</div>
            <div className="flex flex-wrap gap-1">
              {weeks.map((w) => (
                <span
                  key={w}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-900/40 border border-amber-700 text-xs"
                >
                  {w}
                  <button
                    type="button"
                    onClick={() => removeWeek(w)}
                    className="text-amber-400 hover:text-white"
                    aria-label={`Remove ${w}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="date"
                value={draftWeek}
                onChange={(e) => setDraftWeek(e.target.value)}
                className="bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={addWeek}
                className="px-2 py-1 rounded border border-neutral-700 hover:bg-neutral-800 text-xs"
              >
                Add week
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-neutral-400">
              Reason note (≥ 10 chars — recorded on every per-staff audit row, so avoid PII)
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-sm"
              placeholder="e.g. Closing payroll for weeks 14–16 — no further corrections accepted."
            />
            <div className="text-[10px] text-neutral-500">
              {reason.trim().length} / 10 chars minimum
            </div>
          </div>

          {errorMsg && (
            <div className="rounded border border-red-800 bg-red-950/30 p-2 text-xs text-red-200">
              {errorMsg}
            </div>
          )}
          {resultMsg && (
            <div className="rounded border border-emerald-800 bg-emerald-950/30 p-2 text-xs text-emerald-200">
              {resultMsg}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-1 rounded border border-neutral-700 hover:bg-neutral-800 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || weeks.length === 0 || !reasonValid}
              onClick={submit}
              className="px-3 py-1 rounded bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-sm flex items-center gap-1"
            >
              <Lock className="w-4 h-4" />
              {busy ? 'Locking…' : `Lock ${weeks.length} week${weeks.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
