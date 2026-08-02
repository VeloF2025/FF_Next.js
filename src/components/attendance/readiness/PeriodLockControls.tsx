import { useState } from 'react';
import { Lock, Plus, Unlock, X } from 'lucide-react';
import type { BulkWeekReadiness, PeriodReadiness, WeeklyLockView } from './usePeriodReadiness';
import { positiveLockVersion } from './lockReadback';

interface Props {
  readiness: PeriodReadiness;
  lock: WeeklyLockView | null;
  canManage: boolean;
  busy: boolean;
  error: string | null;
  bulkWeeks: BulkWeekReadiness[];
  onLock: (reason: string) => void;
  onUnlock: (reason: string) => void;
  onBulkLock: (weeks: string[], reason: string) => void;
  onAddBulkWeek: (week: string) => void;
  onRemoveBulkWeek: (week: string) => void;
}

function isMonday(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 1;
}

function LockSnapshot({ lock }: { lock: WeeklyLockView | null }) {
  const version = positiveLockVersion(lock?.lock_version);
  const fields = [
    ['Latest audit version', version === null ? 'Unavailable' : `v${version}`],
    ['Latest audit action', lock?.latest_action ?? 'Unavailable'],
    ['Latest audit actor', lock?.latest_actor_user_id ?? 'Unavailable'],
    ['Latest audit timestamp', lock?.latest_recorded_at ?? 'Unavailable'],
    ['Latest audit reason', lock?.latest_reason ?? 'Unavailable'],
  ];
  return (
    <div className="rounded-lg border border-[var(--ff-border-primary)] bg-[var(--ff-bg-primary)] p-3 text-xs">
      <div className="flex justify-between gap-3"><span className="text-[var(--ff-text-tertiary)]">Active lock version</span><strong>{lock && lock.unlocked_at === null && version !== null ? `v${version}` : 'None'}</strong></div>
      <dl className="mt-2 space-y-2">
        {fields.map(([label, value]) => <div key={label} className="flex justify-between gap-3">
          <dt className="text-[var(--ff-text-tertiary)]">{label}</dt><dd className="text-right font-semibold">{value}</dd>
        </div>)}
      </dl>
    </div>
  );
}

export function PeriodLockControls({
  readiness, lock, canManage, busy, error, bulkWeeks, onLock, onUnlock,
  onBulkLock, onAddBulkWeek, onRemoveBulkWeek,
}: Props) {
  const [lockReason, setLockReason] = useState('');
  const [unlockReason, setUnlockReason] = useState('');
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
  const [draftWeek, setDraftWeek] = useState('');
  const active = Boolean(lock && lock.unlocked_at === null && positiveLockVersion(lock.lock_version) !== null);
  const allBulkReady = bulkWeeks.length > 0 && bulkWeeks.every((item) =>
    !item.loading && !item.error && item.readiness?.readyToLock === true
  );

  return (
    <aside className="space-y-4" aria-label="Period lock controls">
      <section className="space-y-4 rounded-xl border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ff-text-primary)]">Lock controls</h2>
        <LockSnapshot lock={lock} />
        {!canManage ? (
          <p data-testid="lock-read-only" className="rounded-lg border border-blue-800 bg-blue-950/20 p-3 text-sm text-blue-200">
            Read-only: only admin and super-admin may lock or unlock payroll weeks.
          </p>
        ) : active ? (
          <div className="space-y-3">
            {!confirmUnlock ? (
              <button type="button" disabled={busy} onClick={() => setConfirmUnlock(true)}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-emerald-700 bg-emerald-950/30 px-4 text-sm font-medium text-emerald-200 disabled:opacity-50">
                <Unlock className="h-4 w-4" /> Unlock week
              </button>
            ) : (
              <div className="space-y-2 rounded-lg border border-emerald-800 p-3">
                <label className="block text-xs text-[var(--ff-text-secondary)]" htmlFor="unlock-reason">Unlock reason (at least 10 characters)</label>
                <textarea id="unlock-reason" value={unlockReason} onChange={(event) => setUnlockReason(event.target.value)} rows={3}
                  className="w-full rounded-lg border border-[var(--ff-border-medium)] bg-[var(--ff-bg-primary)] p-2 text-sm" />
                <div className="flex gap-2">
                  <button type="button" disabled={busy || unlockReason.trim().length < 10} onClick={() => onUnlock(unlockReason.trim())}
                    className="min-h-[44px] rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white disabled:opacity-50">Confirm unlock</button>
                  <button type="button" disabled={busy} onClick={() => setConfirmUnlock(false)}
                    className="min-h-[44px] rounded-lg border border-[var(--ff-border-primary)] px-4 text-sm">Cancel</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-xs text-[var(--ff-text-secondary)]" htmlFor="lock-reason">Lock reason</label>
            <input id="lock-reason" value={lockReason} onChange={(event) => setLockReason(event.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-[var(--ff-border-medium)] bg-[var(--ff-bg-primary)] px-3 text-sm" />
            {!readiness.readyToLock && <p className="text-xs text-red-300">Server reports this week is not ready. Resolve all readiness checks first.</p>}
            <button type="button" disabled={busy || !readiness.readyToLock || lockReason.trim().length < 3}
              onClick={() => onLock(lockReason.trim())}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-amber-700 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-[var(--ff-bg-tertiary)] disabled:text-[var(--ff-text-tertiary)]">
              <Lock className="h-4 w-4" /> Lock week {readiness.weekStartDate}
            </button>
          </div>
        )}
        {error && <p className="text-xs text-red-300">Your entered reason is retained while you review this error.</p>}
      </section>

      {canManage && !active && (
        <section className="space-y-3 rounded-xl border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide">Bulk lock</h2>
          <div className="flex gap-2">
            <input type="date" aria-label="Add payroll week" value={draftWeek} onChange={(event) => setDraftWeek(event.target.value)}
              className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-[var(--ff-border-medium)] bg-[var(--ff-bg-primary)] px-2 text-sm" />
            <button type="button" disabled={!isMonday(draftWeek) || busy} onClick={() => { onAddBulkWeek(draftWeek); setDraftWeek(''); }}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-[var(--ff-border-primary)] px-3 text-sm disabled:opacity-50"><Plus className="h-4 w-4" /> Add</button>
          </div>
          <ul className="space-y-2">
            {bulkWeeks.map((item) => (
              <li key={item.weekStartDate} className="flex items-center justify-between rounded-lg bg-[var(--ff-bg-primary)] px-3 py-2 text-xs">
                <span>{item.weekStartDate} · {item.loading ? 'Checking…' : item.error ? 'Check failed' : item.readiness?.readyToLock ? 'Ready' : 'Not ready'}</span>
                {bulkWeeks.length > 1 && <button type="button" aria-label={`Remove ${item.weekStartDate}`} onClick={() => onRemoveBulkWeek(item.weekStartDate)}><X className="h-4 w-4" /></button>}
              </li>
            ))}
          </ul>
          <label className="block text-xs text-[var(--ff-text-secondary)]" htmlFor="bulk-lock-reason">Bulk lock reason</label>
          <textarea id="bulk-lock-reason" value={bulkReason} onChange={(event) => setBulkReason(event.target.value)} rows={2}
            className="w-full rounded-lg border border-[var(--ff-border-medium)] bg-[var(--ff-bg-primary)] p-2 text-sm" />
          <button type="button" disabled={busy || !allBulkReady || bulkReason.trim().length < 10}
            onClick={() => onBulkLock(bulkWeeks.map((item) => item.weekStartDate), bulkReason.trim())}
            className="min-h-[44px] w-full rounded-lg bg-amber-700 px-4 text-sm font-medium text-white disabled:bg-[var(--ff-bg-tertiary)] disabled:text-[var(--ff-text-tertiary)]">
            Lock selected weeks
          </button>
          {!allBulkReady && <p className="text-xs text-amber-300">Every selected week must independently report ready before the atomic bulk lock is enabled.</p>}
        </section>
      )}
    </aside>
  );
}
