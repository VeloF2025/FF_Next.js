/**
 * /staff/attendance/reports/[slug] — generic Pulse report page (PRD-061 §7.3).
 *
 * One page handles all six P1 reports. The catalogue (`REPORT_CATALOGUE`)
 * declares each report's input controls; this page renders the matching
 * form, fetches `/api/staff/attendance-report?slug=...`, and shows the
 * resulting columnar table + XLSX/CSV export buttons.
 *
 * Empty state, scope notes, and the 50k-row "narrow your filters" 413
 * surface here. Errors are caught at the fetch boundary and shown
 * in a red banner — not toasted (toasts compete with the table-cell
 * focus the user actually needs to see).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft, Download, FileText } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import { log } from '@/lib/logger';
import {
  REPORT_CATALOGUE,
  type ReportColumn,
  type ReportDef,
  type ReportInputDef,
  type ReportSlug,
} from '@/services/attendance/reports/types';
import { ReportFilterBar } from '@/components/attendance/reports/ReportFilterBar';
import { ReportTable } from '@/components/attendance/reports/ReportTable';
import {
  buildQuery,
  lastCompletedMonthSast,
  type ReportFormState,
} from '@/components/attendance/reports/reportFormatters';

type ScopeNote =
  | { kind: 'orgwide' }
  | { kind: 'scoped'; staffCount: number }
  | { kind: 'no_scope'; reason: string };

interface ReportResponse {
  slug: ReportSlug;
  rows: Array<Record<string, unknown>>;
  columns: ReadonlyArray<ReportColumn>;
  notes: string[];
  scopeNote: ScopeNote;
}

const DEFAULT_FORM: ReportFormState = {
  month: lastCompletedMonthSast(),
  dateRange: 'last_30d',
  dateFrom: '',
  dateTo: '',
  departments: '',
  siteIds: '',
  staffIds: '',
  groupBy: '',
};

function findDef(slug: string | undefined): ReportDef | null {
  if (!slug) return null;
  return REPORT_CATALOGUE.find((r) => r.slug === slug) ?? null;
}

export default function ReportSlugPage() {
  const router = useRouter();
  const slugParam = typeof router.query.slug === 'string' ? router.query.slug : undefined;
  const def = useMemo(() => findDef(slugParam), [slugParam]);

  const [form, setForm] = useState<ReportFormState>(DEFAULT_FORM);
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);

  // Initialise group_by + dateRange from the catalogue defaults once we know the slug.
  useEffect(() => {
    if (!def) return;
    setForm((s) => {
      const gb = def.inputs.find(
        (i): i is Extract<ReportInputDef, { kind: 'group_by' }> => i.kind === 'group_by',
      );
      const dr = def.inputs.find(
        (i): i is Extract<ReportInputDef, { kind: 'date_range' }> => i.kind === 'date_range',
      );
      return {
        ...s,
        groupBy: gb ? gb.default : '',
        dateRange: dr
          ? (dr.defaultPreset === 'last_12_weeks' ? 'last_30d' : dr.defaultPreset)
          : s.dateRange,
      };
    });
  }, [def]);

  const runFetch = useCallback(async () => {
    if (!def) return;
    setLoading(true);
    setError(null);
    try {
      const q = buildQuery(def.slug, def, form);
      const res = await fetch(`/api/staff/attendance-report?${q.toString()}`, { credentials: 'include' });
      if (res.status === 413) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? 'Result is too large — narrow your filters.');
        setData(null);
        return;
      }
      const body = (await res.json()) as
        | { success: true; data: ReportResponse }
        | { success: false; error?: { message?: string } };
      if (!res.ok || !('success' in body) || !body.success) {
        setError(('error' in body ? body.error?.message : null) ?? 'Report failed.');
        setData(null);
        return;
      }
      setData(body.data);
    } catch (err) {
      log.error('PulseReport fetch failed', err instanceof Error ? { message: err.message } : { err });
      setError('Network error running the report.');
    } finally {
      setLoading(false);
    }
  }, [def, form]);

  // Auto-run on mount and on slug-change ONLY — not on every form keystroke.
  // `runFetch` closes over `form`, so depending on it would refire the
  // network request whenever the user typed in a department / IDs box.
  // The explicit "Run report" submit button is the only way to re-fetch
  // with new filters.
  useEffect(() => {
    if (!router.isReady || !def) return;
    void runFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, def?.slug]);

  const onExport = async (format: 'csv' | 'xlsx') => {
    if (!def) return;
    setExporting(format);
    try {
      const q = buildQuery(def.slug, def, form);
      q.set('format', format);
      const res = await fetch(`/api/staff/attendance-report-export?${q.toString()}`, { credentials: 'include' });
      if (!res.ok) {
        const body = await res.text();
        let msg = 'Export failed.';
        try {
          const parsed = JSON.parse(body) as { error?: { message?: string } };
          if (parsed.error?.message) msg = parsed.error.message;
        } catch { /* keep generic */ }
        setError(msg);
        return;
      }
      const blob = await res.blob();
      const dispo = res.headers.get('Content-Disposition') ?? '';
      const m = dispo.match(/filename="?([^"]+)"?/);
      const filename = m?.[1] ?? `pulse-${def.slug}.${format}`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      log.error('PulseReport export failed', err instanceof Error ? { message: err.message } : { err });
      setError('Network error during export.');
    } finally {
      setExporting(null);
    }
  };

  if (!def) {
    return (
      <AppLayout>
        <AttendanceNav />
        <div className="px-6 py-10 max-w-3xl mx-auto text-center">
          <h1 className="text-xl font-semibold text-gray-900">Unknown report</h1>
          <p className="mt-2 text-sm text-gray-500">
            The slug &quot;{slugParam ?? ''}&quot; doesn&apos;t match any Pulse report.
          </p>
          <Link href="/staff/attendance/reports" className="mt-4 inline-block text-emerald-700 hover:underline">
            ← Back to reports
          </Link>
        </div>
      </AppLayout>
    );
  }

  const columns: ReadonlyArray<ReportColumn> = data?.columns ?? [];
  const rows = data?.rows ?? [];

  return (
    <AppLayout>
      <AttendanceNav />
      <div className="px-6 py-6 max-w-7xl mx-auto">
        <Link
          href="/staff/attendance/reports"
          className="mb-3 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-3 w-3" />
          All reports
        </Link>
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{def.title}</h1>
            <p className="text-sm text-gray-500">{def.blurb}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onExport('xlsx')}
              disabled={exporting !== null || rows.length === 0}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {exporting === 'xlsx' ? 'Exporting…' : 'XLSX'}
            </button>
            <button
              type="button"
              onClick={() => onExport('csv')}
              disabled={exporting !== null || rows.length === 0}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-emerald-600 text-emerald-700 text-sm hover:bg-emerald-50 disabled:opacity-50"
            >
              <FileText className="h-4 w-4" />
              {exporting === 'csv' ? 'Exporting…' : 'CSV'}
            </button>
          </div>
        </header>

        <ReportFilterBar def={def} form={form} setForm={setForm} onRun={runFetch} loading={loading} />

        {error && (
          <div role="alert" className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {data && data.notes.length > 0 && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 space-y-1">
            {data.notes.map((n, i) => <div key={i}>• {n}</div>)}
          </div>
        )}

        <div className="mt-4">
          <ReportTable columns={columns} rows={rows} loading={loading} />
        </div>

        {data?.scopeNote && (
          <div className="mt-3 text-xs text-gray-500">
            {data.scopeNote.kind === 'orgwide' && 'Scope: org-wide.'}
            {data.scopeNote.kind === 'scoped' && `Scope: ${data.scopeNote.staffCount.toLocaleString('en-ZA')} staff in your supervisor chain.`}
            {data.scopeNote.kind === 'no_scope' && data.scopeNote.reason}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
