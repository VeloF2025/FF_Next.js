/**
 * The export button (stage 8, task 9).
 *
 * It was a plain `<a href>` and that was the wrong shape. The export endpoint
 * answers a rejected filter with a JSON envelope, so a browser following the
 * link renders `{"success":false,…}` in a tab: the reader is taken OFF the
 * screen and shown the raw refusal rather than the sentence explaining it.
 *
 * So it fetches, and hands a failure back to the section to render in the same
 * error box the report's own failures use, with the server's own words. The
 * URL it asks for is still `operationsExportUrl` of exactly the filters the
 * screen was built from — the parity claim is unchanged, and `data-export-url`
 * keeps it assertable now that there is no `href` to read.
 */
import { useState } from 'react';
import { Download } from 'lucide-react';
import { log } from '@/lib/logger';
import { IncidentApiError } from './incidentApi';
import { fetchOperationsExport, operationsExportUrl } from './operationsAnalyticsApi';
import type { OperationsQueryExtras } from './operationsAnalyticsApi';
import type { OperationsFilters } from '../analytics/types';

export interface OperationsExportButtonProps {
  filters: OperationsFilters;
  extras: OperationsQueryExtras;
  /** `null` clears a previous failure; a string is the sentence to show. */
  onError: (message: string | null) => void;
}

/** Saves the bytes under a name that says which range they answer. */
function save(blob: Blob, filters: OperationsFilters): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = `fleet-operations-${filters.start}-to-${filters.end}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export function OperationsExportButton({ filters, extras, onError }: OperationsExportButtonProps) {
  const [busy, setBusy] = useState(false);

  async function onClick(): Promise<void> {
    setBusy(true);
    onError(null);
    try {
      save(await fetchOperationsExport(filters, extras), filters);
    } catch (cause) {
      onError(cause instanceof IncidentApiError ? cause.message : 'The operations export could not be produced');
      log.error('Fleet operations export failed', { error: cause }, 'fleet');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button" data-testid="operations-export" disabled={busy}
      data-export-url={operationsExportUrl(filters, extras)}
      onClick={() => { void onClick(); }}
      className="px-3 py-2 text-sm border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] flex items-center gap-1.5 disabled:opacity-60"
    >
      <Download className="w-4 h-4" /> {busy ? 'Preparing…' : 'Export'}
    </button>
  );
}
