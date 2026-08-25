/**
 * The Operations section on /fleet/analytics (stage 8, task 9).
 *
 * It sits BELOW the existing vehicle scorecard and shares nothing with it. The
 * scorecard's period, vehicle-type and ownership controls are component state
 * on the page; these filters live on the URL under their own `op_` names. The
 * two sets never read each other, which is what stops a deep link into one
 * silently pre-filtering the other.
 *
 * Everything on screen is a figure the server produced. This component divides
 * nothing and sums nothing across metric keys — see `OperationsOverview` for
 * why. What it does add is the saying-out-loud: which months are derived from
 * retained detail and which from published aggregates, what the aggregates
 * withheld, and whether the job behind them last succeeded.
 *
 * No leaderboard, no driver score, no ranking, no disciplinary rating. That is
 * a standing constraint of the whole stage, not a thing left for later.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { AlertTriangle, Download, ListTree } from 'lucide-react';
import { log } from '@/lib/logger';
import { IncidentApiError, isIncidentApiAbort } from './incidentApi';
import {
  operationsAnalyticsApi, operationsExportUrl, operationsQueryString, parseOperationsUrlFilters,
} from './operationsAnalyticsApi';
import { OperationsCharts } from './OperationsCharts';
import { OperationsFilters } from './OperationsFilters';
import { OperationsHistoryDrawer } from './OperationsHistoryDrawer';
import { OperationsOverview } from './OperationsOverview';
import type { OperationsAnalyticsResponse, OperationsFilters as Filters } from '../analytics/types';

/** Whole months, because every figure this section can show is monthly. */
function defaultRange(): { start: string; end: string } {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function OperationsAnalytics() {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(defaultRange);
  const [report, setReport] = useState<OperationsAnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drilling, setDrilling] = useState(false);

  // Read from the URL after mount rather than during the first render: this
  // page renders on the server too, and initialising from `window` there would
  // hydrate different markup than it served.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setFilters((current) => parseOperationsUrlFilters(window.location.search, current));
    setMounted(true);
  }, []);

  const query = operationsQueryString(filters);

  useEffect(() => {
    if (!mounted) return undefined;
    const controller = new AbortController();
    setLoading(true);
    operationsAnalyticsApi.report(filters, controller.signal)
      .then((result) => { setReport(result); setError(null); })
      .catch((cause: unknown) => {
        if (isIncidentApiAbort(cause)) return;
        // The server's own words where it has them — a filter that cannot span
        // the retention boundary explains itself, and a generic "failed to
        // load" would send the reader looking for a fault instead.
        setError(cause instanceof IncidentApiError ? cause.message : 'Could not load operations analytics');
        // A failed request must never leave stale figures on screen reading as
        // the answer to the question just asked.
        setReport(null);
        log.error('Fleet operations analytics failed', { error: cause }, 'fleet');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
    // Keyed on the serialized filters: a new object with the same values is the
    // same question, and refetching for it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, query]);

  useEffect(() => {
    if (!mounted) return;
    router.replace(`${router.pathname}${query}`, undefined, { shallow: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, query]);

  const onFiltersChange = useCallback((next: Filters) => {
    setFilters(next);
    // Closed on any filter change: the drawer answers one filter set, and
    // leaving it open would show the incidents behind the previous question.
    setDrilling(false);
  }, []);

  const freshnessWarning = useMemo(() => {
    if (report === null) return null;
    const { aggregatesThrough, lastRunStatus } = report.freshness;
    if (lastRunStatus === 'succeeded' && aggregatesThrough !== null) return null;
    return `The nightly aggregation last finished as "${lastRunStatus ?? 'never run'}", so months before the `
      + 'retention boundary may be incomplete or out of date. Those figures are missing, not zero.';
  }, [report]);

  return (
    <section className="space-y-4" data-testid="operations-analytics">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--ff-text-primary)]">Operations</h2>
          <p className="text-xs text-[var(--ff-text-secondary)]">
            Presence, incidents, review outcomes and system reliability across the projects you manage.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button" data-testid="operations-drilldown-open"
            onClick={() => setDrilling((open) => !open)}
            className="px-3 py-2 text-sm border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] flex items-center gap-1.5"
          >
            <ListTree className="w-4 h-4" /> Incidents behind these figures
          </button>
          <a
            data-testid="operations-export" href={operationsExportUrl(filters)}
            className="px-3 py-2 text-sm border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" /> Export
          </a>
        </div>
      </div>

      <OperationsFilters filters={filters} onChange={onFiltersChange} />

      {error !== null && (
        <div data-testid="operations-error" className="bg-red-900/20 border border-red-800 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
          <span className="text-red-300 text-sm">{error}</span>
        </div>
      )}

      {loading && error === null && (
        <p data-testid="operations-loading" className="text-sm text-[var(--ff-text-secondary)]">
          Loading operations analytics…
        </p>
      )}

      {report !== null && (
        <>
          <p data-testid="operations-boundary" className="text-xs text-[var(--ff-text-tertiary)]">
            Months from {report.retainedDetailFrom} are derived from retained operational detail.
            Earlier months come from published anonymous monthly aggregates, which hold counts but no
            durations and describe groups of five people or more.
          </p>

          {freshnessWarning !== null && (
            <p data-testid="operations-freshness" className="text-xs text-amber-400">{freshnessWarning}</p>
          )}

          {report.suppressionNotices.length > 0 && (
            <ul data-testid="operations-notices" className="text-xs text-amber-400 space-y-1">
              {report.suppressionNotices.map((notice) => <li key={notice}>{notice}</li>)}
            </ul>
          )}

          {report.cards.length === 0 && (
            <p data-testid="operations-empty" className="text-sm text-[var(--ff-text-secondary)]">
              No figures matched these filters. That is not a count of zero — any months whose figures
              were withheld are named above.
            </p>
          )}

          <OperationsOverview cards={report.cards} />
          <OperationsCharts report={report} />
          {drilling && <OperationsHistoryDrawer filters={filters} onClose={() => setDrilling(false)} />}
        </>
      )}
    </section>
  );
}
