import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { OperationalAttentionRow } from '../presentationTypes';
import type { OperationalEvidenceDetail } from '../statusService';
import { serializeOperationFilters, type OperationFilters } from './operationFilters';
import { OperationsPresentationApiError, operationsPresentationApi } from './operationsPresentationApi';

interface OperationalEvidenceDrawerProps {
  row: OperationalAttentionRow;
  filters: OperationFilters;
  returnFocus: HTMLElement | null;
  onClose: () => void;
}

function mapHref(row: OperationalAttentionRow, filters: OperationFilters): string {
  return `/fleet/map?${serializeOperationFilters({
    ...filters, projectId: row.projectId ?? filters.projectId, staffId: row.staffId,
  })}`;
}

function assignmentHref(row: OperationalAttentionRow, filters: OperationFilters): string {
  const query = new URLSearchParams();
  const projectId = row.projectId ?? filters.projectId;
  if (projectId) query.set('projectId', projectId);
  query.set('staffId', row.staffId);
  if (filters.workDate) { query.set('from', filters.workDate); query.set('to', filters.workDate); }
  return `/fleet/assignments?${query.toString()}`;
}

export function OperationalEvidenceDrawer({ row, filters, returnFocus, onClose }: OperationalEvidenceDrawerProps) {
  const drawer = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [detail, setDetail] = useState<OperationalEvidenceDetail | null>(null);
  const [error, setError] = useState<OperationsPresentationApiError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null); setError(null);
    void operationsPresentationApi.detail(row.staffId, filters, controller.signal)
      .then((value) => setDetail(value))
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof OperationsPresentationApiError ? caught
          : new OperationsPresentationApiError('Evidence request failed', 0, 'UNKNOWN_ERROR'));
      });
    closeButton.current?.focus();
    return () => {
      controller.abort();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [filters, returnFocus, row.staffId]);

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(drawer.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])',
    ) ?? []);
    if (!focusable.length) return;
    const first = focusable[0]!; const last = focusable.at(-1)!;
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div ref={drawer} role="dialog" aria-modal="true" aria-label={`Evidence for ${row.staffName}`}
        onKeyDown={handleKeys} className="h-full w-full max-w-lg overflow-y-auto bg-[var(--ff-bg-secondary)] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div><h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">{row.staffName}</h3>
            <p className="text-sm text-[var(--ff-text-secondary)]">Operational evidence</p></div>
          <button ref={closeButton} type="button" aria-label="Close evidence" onClick={onClose}
            className="rounded border border-[var(--ff-border-light)] px-3 py-2">Close</button>
        </div>
        {error && <p role="alert" className="mt-4 text-sm text-red-600">
          {error.kind === 'permission' ? 'Evidence is unavailable for this selection.' : 'Evidence could not be loaded.'}
        </p>}
        {!detail && !error && <p className="mt-4 text-[var(--ff-text-secondary)]">Loading evidence…</p>}
        {detail && <div className="mt-5 space-y-4 text-sm text-[var(--ff-text-secondary)]">
          <p><strong className="text-[var(--ff-text-primary)]">Project / site:</strong> {detail.projectName ?? 'No project'} · {detail.operationalSiteName ?? 'No site'}</p>
          <p><strong className="text-[var(--ff-text-primary)]">Reasons:</strong> {detail.evaluation.reasonCodes.map((code) => code.replaceAll('_', ' ')).join('; ') || 'No reason recorded'}</p>
          <p><strong className="text-[var(--ff-text-primary)]">Evidence:</strong> {detail.points.length} decision-relevant point{detail.points.length === 1 ? '' : 's'}</p>
          <p><strong className="text-[var(--ff-text-primary)]">Rule:</strong> version {detail.evaluation.ruleVersion}</p>
        </div>}
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href={mapHref(row, filters)} className="rounded bg-[var(--ff-primary)] px-3 py-2 text-sm text-white">View on map</Link>
          <Link href={assignmentHref(row, filters)} className="rounded border border-[var(--ff-border-light)] px-3 py-2 text-sm">Manage assignment</Link>
        </div>
      </div>
    </div>
  );
}
