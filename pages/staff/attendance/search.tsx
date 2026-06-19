/**
 * /staff/attendance/search — Pulse · Search (PRD-061 Phase A + B).
 *
 * Shell component: owns state, data fetching, and wires subcomponents.
 * Heavy logic is extracted to:
 *   - `@/components/attendance/search/usePresets` — preset CRUD + auto-load
 *   - `@/components/attendance/search/searchUtils` — URL ↔ form serialisation
 * Presentation is delegated to FilterBar, PresetsBar, ResultTable, PaginationBar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Download, FileText, RefreshCw } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import { log } from '@/lib/logger';
import { FilterBar } from '@/components/attendance/search/FilterBar';
import { PresetsBar } from '@/components/attendance/search/PresetsBar';
import { ResultTable, TotalsStrip } from '@/components/attendance/search/ResultTable';
import { PaginationBar } from '@/components/attendance/search/PaginationBar';
import { usePresets } from '@/components/attendance/search/usePresets';
import { parseFormFromQuery, formToQuery } from '@/components/attendance/search/searchUtils';
import { DEFAULT_FORM, type FormState, type SearchResponse, type SortField, type SortDir } from '@/components/attendance/search/types';

export default function PulseSearchPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [committedForm, setCommittedForm] = useState<FormState>(DEFAULT_FORM);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [sortField, setSortField] = useState<SortField>('work_date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [confirmLong, setConfirmLong] = useState(false);
  const [exportLoading, setExportLoading] = useState<'csv' | 'xlsx' | null>(null);
  const initialFromUrl = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const presets = usePresets({
    routerIsReady: router.isReady,
    routerQueryIsEmpty: Object.keys(router.query).length === 0,
    committedForm,
    setForm,
    setCommittedForm,
    setPage,
  });

  // Hydrate form from URL on first ready.
  useEffect(() => {
    if (!router.isReady || initialFromUrl.current) return;
    initialFromUrl.current = true;
    const hydrated = parseFormFromQuery(router.query as Record<string, string | string[] | undefined>);
    setForm(hydrated);
    setCommittedForm(hydrated);
    const p = Number.parseInt((router.query.page as string) ?? '1', 10);
    setPage(Number.isFinite(p) && p > 0 ? p : 1);
    const sf = (router.query.sortField as string) ?? 'work_date';
    const sd = (router.query.sortDir as string) ?? 'desc';
    setSortField((['work_date', 'full_name', 'hours', 'overtime', 'department'].includes(sf) ? sf : 'work_date') as SortField);
    setSortDir((['asc', 'desc'].includes(sd) ? sd : 'desc') as SortDir);
    setConfirmLong(router.query.confirmLongRange === '1');
  }, [router.isReady, router.query]);

  const buildSearchUrl = useCallback(
    (overrides: Partial<{ page: number; sortField: SortField; sortDir: SortDir; confirmLongRange: boolean }> = {}) => {
      const q = new URLSearchParams(formToQuery(committedForm));
      const effPage = overrides.page ?? page;
      if (effPage !== 1) q.set('page', String(effPage));
      q.set('pageSize', String(pageSize));
      q.set('sortField', overrides.sortField ?? sortField);
      q.set('sortDir', overrides.sortDir ?? sortDir);
      if (overrides.confirmLongRange ?? confirmLong) q.set('confirmLongRange', '1');
      return q.toString();
    },
    [committedForm, page, pageSize, sortField, sortDir, confirmLong]
  );

  // Keep URL in sync with filter/page/sort state.
  useEffect(() => {
    if (!router.isReady || !initialFromUrl.current) return;
    const target = `/staff/attendance/search?${buildSearchUrl()}`;
    if (target !== router.asPath) {
      router.replace(target, undefined, { shallow: true }).catch((err) => {
        log.warn('PulseSearch URL sync failed', err instanceof Error ? { message: err.message } : { err });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.asPath, buildSearchUrl]);

  const runFetch = useCallback(async () => {
    if (!router.isReady) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    // Task 3: clear stale export notice on fresh search.
    setExportNotice(null);
    try {
      const res = await fetch(`/api/staff/attendance-search?${buildSearchUrl()}`, {
        credentials: 'include',
        signal: ctrl.signal,
      });
      const body = (await res.json()) as
        | { success: true; data: SearchResponse }
        | { success: false; error?: { message?: string } };
      if (!res.ok || !('success' in body) || !body.success) {
        const msg = (!body || 'success' in body && body.success === false ? body.error?.message : null) ?? 'Search failed.';
        setError(msg);
        setData(null);
        return;
      }
      setData(body.data);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      log.error('PulseSearch fetch failed', err instanceof Error ? { message: err.message } : { err });
      setError('Network error running the search.');
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
  }, [router.isReady, buildSearchUrl]);

  useEffect(() => { runFetch(); }, [runFetch]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setCommittedForm(form);
  };

  const onReset = () => {
    setForm(DEFAULT_FORM);
    setCommittedForm(DEFAULT_FORM);
    setPage(1);
    setSortField('work_date');
    setSortDir('desc');
    setConfirmLong(false);
  };

  const onSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const onExport = async (format: 'csv' | 'xlsx') => {
    setExportLoading(format);
    setExportNotice(null);
    try {
      const res = await fetch(`/api/staff/attendance-search-export?format=${format}&${buildSearchUrl()}`, { credentials: 'include' });
      if (!res.ok) {
        const body = await res.text();
        let message = 'Export failed.';
        try {
          const parsed = JSON.parse(body) as { error?: { message?: string } };
          if (parsed.error?.message) message = parsed.error.message;
        } catch { /* non-JSON body; keep generic message */ }
        setError(message);
        return;
      }
      if (res.headers.get('X-Pulse-Truncated') === 'true') {
        setExportNotice('Export truncated to the first 5,000 rows — narrow your filters to export everything.');
      }
      const blob = await res.blob();
      const dispo = res.headers.get('Content-Disposition') ?? '';
      const m = dispo.match(/filename="?([^"]+)"?/);
      const filename = m?.[1] ?? `pulse-search.${format}`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      log.error('PulseSearch export failed', err instanceof Error ? { message: err.message } : { err });
      setError('Network error during export.');
    } finally {
      setExportLoading(null);
    }
  };

  const rows = data?.rows ?? [];
  const totalRows = data?.pagination.totalRows ?? 0;
  const scopeNote = data?.scopeNote;

  const emptyMessage = useMemo(() => {
    if (!data || rows.length > 0) return null;
    if (scopeNote?.kind === 'no_scope') return scopeNote.reason;
    if (scopeNote?.kind === 'scoped' && scopeNote.staffCount === 0) {
      return 'You have no staff in scope. Ask your administrator if this is unexpected.';
    }
    return 'No attendance rows match your filters. Try widening the date range or removing exception filters.';
  }, [data, rows.length, scopeNote]);

  return (
    <AppLayout>
      <AttendanceNav />
      <div className="px-6 py-6 max-w-7xl mx-auto">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Pulse · Search</h1>
            <p className="text-sm text-neutral-500">
              Cross-staff, cross-period attendance search. Filters honour your supervisor scope.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={runFetch} disabled={loading}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-neutral-700 text-sm hover:bg-neutral-800/60 disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button type="button" onClick={() => onExport('xlsx')} disabled={exportLoading !== null || rows.length === 0}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50">
              <Download className="h-4 w-4" />
              {exportLoading === 'xlsx' ? 'Exporting…' : 'XLSX'}
            </button>
            <button type="button" onClick={() => onExport('csv')} disabled={exportLoading !== null || rows.length === 0}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-emerald-700 text-emerald-300 text-sm hover:bg-emerald-900/30 disabled:opacity-50">
              <FileText className="h-4 w-4" />
              {exportLoading === 'csv' ? 'Exporting…' : 'CSV'}
            </button>
          </div>
        </header>

        <PresetsBar
          presets={presets.presets}
          loading={presets.presetsLoading}
          actionMsg={presets.presetActionMsg}
          onSave={presets.onSavePreset}
          onApply={presets.onApplyPreset}
          onUpdate={presets.onUpdatePreset}
          onDelete={presets.onDeletePreset}
        />

        <FilterBar form={form} setForm={setForm} setCommittedForm={setCommittedForm}
          onSubmit={onSubmit} onReset={onReset} confirmLong={confirmLong} loading={loading} />

        {exportNotice && (
          <div role="status" className="mt-4 rounded border border-amber-800 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
            {exportNotice}
          </div>
        )}
        {error && (
          <div role="alert" className="mt-4 rounded border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-200">
            {error}
            {/Date range spans .* days/.test(error) && (
              <button type="button" onClick={() => setConfirmLong(true)} className="ml-2 underline font-medium">
                Run anyway
              </button>
            )}
          </div>
        )}

        {data?.totals && <TotalsStrip totals={data.totals} scopeNote={scopeNote} />}

        <ResultTable rows={rows} loading={loading} emptyMessage={emptyMessage}
          sortField={sortField} sortDir={sortDir} onSort={onSort} />

        <PaginationBar page={page} pageSize={pageSize} totalRows={totalRows} loading={loading}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => p + 1)} />
      </div>
    </AppLayout>
  );
}
