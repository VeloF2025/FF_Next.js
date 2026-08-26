/**
 * The incidents behind the figures on screen (stage 8, task 9).
 *
 * It drills into the CURRENT FILTERS, not into a particular card — the
 * drill-down endpoint answers one filter set at a time, and a drawer opened
 * from a single card would claim to explain that card while listing everything
 * the filters match.
 *
 * `aggregate_only` is the case this component exists for. It is not an error
 * and not an empty result: the months asked about no longer hold identifiable
 * detail, and an empty list rendered without saying so reads as "no incidents
 * happened", which is the one answer this must never give.
 */
import { useEffect, useState } from 'react';
import { log } from '@/lib/logger';
import { IncidentApiError, isIncidentApiAbort } from './incidentApi';
import { operationsAnalyticsApi } from './operationsAnalyticsApi';
import type { OperationsQueryExtras } from './operationsAnalyticsApi';
import { metricLabel } from './operationsMetricLabels';
import type { OperationsDrillDownResponse, OperationsFilters } from '../analytics/types';

export interface OperationsHistoryDrawerProps {
  filters: OperationsFilters;
  /** Unshaped `op_` keys from the URL, carried so the server judges them here too. */
  extras?: OperationsQueryExtras;
  onClose: () => void;
}

export function OperationsHistoryDrawer({ filters, extras, onClose }: OperationsHistoryDrawerProps) {
  const [page, setPage] = useState<OperationsDrillDownResponse | null>(null);
  const [incidentIds, setIncidentIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    operationsAnalyticsApi.drillDown(filters, cursor, controller.signal, extras)
      .then((result) => {
        setPage(result);
        // Appended rather than replaced: paging through a long list must not
        // discard the page the reader is already looking at.
        // Deduplicated on append. The cursor is an incident id and the server
        // pages inclusively of it, so the last row of one page is the first row
        // of the next; concatenating blind repeats it, and React then renders
        // two <li> under one key. A repeated id is also a reader counting the
        // same incident twice down a list that is meant to explain a figure.
        setIncidentIds((seen) => (cursor === null
          ? [...new Set(result.incidentIds)]
          : [...new Set([...seen, ...result.incidentIds])]));
        setError(null);
      })
      .catch((cause: unknown) => {
        if (isIncidentApiAbort(cause)) return;
        // The server's own words. A drill-down refused because the range
        // straddles the retention boundary has a specific reason, and a generic
        // "failed to load" would send the reader looking for a fault.
        setError(cause instanceof IncidentApiError ? cause.message : 'Could not load the incidents behind these figures');
        log.error('Fleet operations drill-down failed', { error: cause }, 'fleet');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [filters, cursor, extras]);

  return (
    <div
      data-testid="operations-drilldown"
      className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)] space-y-3"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-[var(--ff-text-primary)]">Incidents behind these figures</h4>
        <button
          type="button" onClick={onClose}
          className="text-xs text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
        >
          Close
        </button>
      </div>

      {error !== null && (
        <p data-testid="operations-drilldown-error" role="alert" className="text-sm text-red-700">{error}</p>
      )}

      {page?.mode === 'aggregate_only' && (
        <div className="space-y-2">
          <p className="text-sm text-[var(--ff-text-secondary)]">
            The identifiable detail for these months is no longer retained, so there is nothing to open.
            The figures below are what the anonymous monthly aggregates still hold.
          </p>
          <ul className="text-xs text-[var(--ff-text-primary)] space-y-0.5">
            {page.values.map((value) => (
              <li key={value.metricKey}>
                {metricLabel(value.metricKey)}: {value.numerator}
                {value.denominator !== null && <> of {value.denominator}</>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {page?.mode === 'retained_detail' && (
        <ul className="text-xs space-y-1">
          {incidentIds.map((incidentId) => (
            <li key={incidentId}>
              {/* Into the queue, which enforces the viewer's scope on the
                  incident itself. This list is ids only — nothing about the
                  incident travels through the analytics response. */}
              <a
                data-testid={`operations-incident-${incidentId}`}
                href={`/fleet/incidents?incidentId=${encodeURIComponent(incidentId)}`}
                className="text-[var(--ff-primary)] hover:underline"
              >
                {incidentId}
              </a>
            </li>
          ))}
        </ul>
      )}

      {loading && <p className="text-xs text-[var(--ff-text-tertiary)]">Loading…</p>}

      {page?.nextCursor && (
        <button
          type="button" data-testid="operations-drilldown-more"
          onClick={() => setCursor(page.nextCursor)}
          className="px-3 py-1.5 text-xs border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]"
        >
          Load more
        </button>
      )}
    </div>
  );
}
