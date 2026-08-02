import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import { ActionDetailPanel } from '@/components/attendance/actions/ActionDetailPanel';
import { ActionQueue } from '@/components/attendance/actions/ActionQueue';
import { ActionSummaryCards } from '@/components/attendance/actions/ActionSummaryCards';
import { useAttendanceActions } from '@/components/attendance/actions/useAttendanceActions';

export default function StaffAttendanceActionsPage() {
  const actions = useAttendanceActions();
  const noScope = actions.data?.scope.kind === 'no_scope';
  const empty = Boolean(actions.data && actions.data.items.length === 0 && !noScope && !actions.selected);

  return (
    <AppLayout>
      <AttendanceNav />
      <main data-testid="attendance-actions-page" className="space-y-5 p-4 lg:p-6">
        <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--ff-text-primary)]">Attendance Actions</h1>
            <p className="mt-1 text-sm text-[var(--ff-text-secondary)]">
              Review payroll blockers and attendance exceptions for workers in your assigned scope.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { void actions.reload(); }}
            disabled={actions.loading || actions.busy}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] px-4 text-sm font-medium text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" /> Refresh queue
          </button>
        </header>

        {actions.data && <ActionSummaryCards items={actions.data.items} />}

        {actions.staleMessage && (
          <div data-testid="stale-state-message" role="alert" className="flex items-start gap-2 rounded-lg border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{actions.staleMessage}</span>
          </div>
        )}
        {actions.error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-800 bg-red-950/30 p-3 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{actions.error}</span>
          </div>
        )}
        {actions.success && (
          <div data-testid="action-success" role="status" className="flex items-start gap-2 rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{actions.success}</span>
          </div>
        )}

        {actions.loading && !actions.data && (
          <div role="status" className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] text-sm text-[var(--ff-text-secondary)]">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading attendance actions…
          </div>
        )}

        {!actions.loading && noScope && (
          <section className="rounded-xl border border-amber-800 bg-amber-950/20 p-6">
            <h2 className="font-semibold text-amber-200">No workers are assigned to your attendance scope</h2>
            <p className="mt-2 text-sm text-amber-100/80">
              The queue remains scoped and will not fall back to organisation-wide attendance. Ask HR to confirm your supervisor assignment.
            </p>
          </section>
        )}

        {!actions.loading && empty && (
          <section className="rounded-xl border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] p-6 text-center">
            <h2 className="font-semibold text-[var(--ff-text-primary)]">No attendance actions match this scope and filters</h2>
            <p className="mt-2 text-sm text-[var(--ff-text-tertiary)]">
              Last checked with the current queue refresh. Try another bounded status or kind filter.
            </p>
          </section>
        )}

        {actions.data && (actions.data.items.length > 0 || actions.selected) && (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.6fr)]">
            <ActionQueue
              items={actions.data.items}
              selectedId={actions.selectedId}
              status={actions.status}
              kind={actions.kind}
              onSelect={actions.setSelectedId}
              onFiltersChange={actions.setFilters}
            />
            {actions.selected && (
              <ActionDetailPanel
                item={actions.selected}
                lastCheckedAt={actions.lastCheckedAt}
                busy={actions.busy}
                onSubmit={(decision) => actions.submit(actions.selected!, decision)}
              />
            )}
          </div>
        )}
      </main>
    </AppLayout>
  );
}
