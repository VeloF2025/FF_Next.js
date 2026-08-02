import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import { thisWeekMondaySast } from '@/components/attendance/dateUtils';
import { PeriodLockControls } from '@/components/attendance/readiness/PeriodLockControls';
import { ReadinessBlockers } from '@/components/attendance/readiness/ReadinessBlockers';
import { ReadinessSummary } from '@/components/attendance/readiness/ReadinessSummary';
import { usePeriodReadiness } from '@/components/attendance/readiness/usePeriodReadiness';
import { useAuth } from '@/contexts/AuthContext';

function isMonday(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 1;
}

function queryWeek(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export default function StaffAttendanceLocksPage() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const selectedWeek = queryWeek(router.query.week) ?? thisWeekMondaySast();
  const validWeek = isMonday(selectedWeek);
  const period = usePeriodReadiness(validWeek ? selectedWeek : null);
  const role = currentUser?.role as string | undefined;
  const canManage = role === 'admin' || role === 'super_admin';

  function changeWeek(next: string) {
    void router.replace({ pathname: router.pathname, query: { week: next } }, undefined, { shallow: true });
  }

  return (
    <AppLayout>
      <AttendanceNav />
      <main data-testid="attendance-readiness-page" className="space-y-5 p-4 lg:p-6">
        <header className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--ff-text-primary)]">Payroll readiness and locks</h1>
            <p className="mt-1 text-sm text-[var(--ff-text-secondary)]">Review server-calculated attendance readiness before closing a payroll week.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-[var(--ff-text-secondary)]" htmlFor="readiness-week">Payroll week</label>
            <input id="readiness-week" type="date" value={selectedWeek} onChange={(event) => changeWeek(event.target.value)}
              className="min-h-[44px] rounded-lg border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] px-3 text-sm" />
            <button type="button" disabled={!validWeek || period.loading || period.busy} onClick={() => { void period.reload(); }}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] px-4 text-sm disabled:opacity-50">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </div>
        </header>

        {!validWeek && (
          <div role="alert" className="rounded-lg border border-red-800 bg-red-950/30 p-3 text-sm text-red-200">
            Payroll week must be a Monday in YYYY-MM-DD format.
          </div>
        )}
        {period.staleMessage && (
          <div data-testid="lock-stale" role="alert" className="flex items-start gap-2 rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {period.staleMessage}
          </div>
        )}
        {period.error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-800 bg-red-950/30 p-3 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {period.error}
          </div>
        )}
        {period.success && (
          <div data-testid="lock-success" role="status" className="flex items-start gap-2 rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {period.success}
          </div>
        )}

        {period.loading && !period.readiness && validWeek && (
          <div role="status" className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] text-sm text-[var(--ff-text-secondary)]">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading period readiness…
          </div>
        )}

        {period.readiness && (
          <>
            <div className="flex justify-end text-xs text-[var(--ff-text-tertiary)]">
              Last checked {period.lastCheckedAt ? new Date(period.lastCheckedAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }) : '—'}
            </div>
            <ReadinessSummary readiness={period.readiness} />
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(20rem,0.7fr)]">
              <ReadinessBlockers blockers={period.readiness.blockers} />
              <PeriodLockControls readiness={period.readiness} lock={period.lock}
                canManage={canManage} busy={period.busy} error={period.error}
                bulkWeeks={period.bulkWeeks} onLock={period.lockWeek} onUnlock={period.unlockWeek}
                onBulkLock={period.bulkLock} onAddBulkWeek={period.addBulkWeek}
                onRemoveBulkWeek={period.removeBulkWeek} />
            </div>
          </>
        )}
      </main>
    </AppLayout>
  );
}
