/** Read-only serial-register drift panel: overall status banner + per-check tiles.
 * Auto-loads on mount via useSerialReconciliation; a manual refresh re-runs the checks. */
import { useState } from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { useSerialReconciliation } from '@/modules/procurement/field-stock/hooks/useSerialReconciliation';
import { ReconciliationTile } from './ReconciliationTile';

export function ReconciliationPanel() {
  const { summary, loading, error, refresh } = useSerialReconciliation();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const failedCount = summary ? summary.checks.filter((c) => !c.passed).length : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--ff-text-secondary)]">
          {summary ? `Last run ${new Date(summary.ranAt).toLocaleTimeString('en-ZA')}` : '—'}
        </p>
        <button onClick={handleRefresh} disabled={refreshing} aria-label={refreshing ? 'Refreshing…' : 'Refresh'}
          className="flex items-center gap-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] px-3 py-2 text-sm text-[var(--ff-text-primary)] disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {loading && !summary && (
        <div className="py-20 text-center text-[var(--ff-text-secondary)]">Running reconciliation checks…</div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-500">
          <p className="font-medium">Error running reconciliation</p>
          <p className="text-sm">{error}</p>
          <button onClick={handleRefresh} disabled={refreshing} className="mt-2 text-sm underline disabled:opacity-50">Try again</button>
        </div>
      )}

      {summary && (
        <>
          <div
            className={`flex items-center gap-3 rounded-xl border p-4 ${
              summary.allPassed
                ? 'border-green-500/30 bg-green-500/10 text-green-500'
                : 'border-red-500/40 bg-red-500/10 text-red-500'
            }`}
          >
            {summary.allPassed ? <CheckCircle2 className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
            <p className="font-medium">
              {summary.allPassed
                ? `All ${summary.checks.length} checks passed`
                : `${failedCount} of ${summary.checks.length} checks failing`}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {summary.checks.map((c) => (
              <ReconciliationTile key={c.name} result={c} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
