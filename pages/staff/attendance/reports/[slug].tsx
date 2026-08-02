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
import { ArrowLeft } from 'lucide-react';
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
import { ReportExportButtons } from '@/components/attendance/reports/ReportExportButtons';
import {
  ReportResultPanel,
  type ScopeNote,
} from '@/components/attendance/reports/ReportResultPanel';
import {
  buildQuery,
  lastCompletedMonthSast,
  type ReportFormState,
} from '@/components/attendance/reports/reportFormatters';

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
        // `last_12_weeks` is the ot-trend server-side window (fixed, not
        // driven by the form date-range). Coerce to `last_30d` so the form
        // control shows a valid preset — the displayed value is cosmetic only;
        // the API ignores it for ot-trend and always uses its 12-week window.
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

  if (!def) {
    return (
      <AppLayout>
        <AttendanceNav />
        <div className="px-6 py-10 max-w-3xl mx-auto text-center">
          <h1 className="text-xl font-semibold">Unknown report</h1>
          <p className="mt-2 text-sm text-neutral-400">
            The slug &quot;{slugParam ?? ''}&quot; doesn&apos;t match any Pulse report.
          </p>
          <Link href="/staff/attendance/reports" className="mt-4 inline-block text-emerald-400 hover:text-emerald-300">
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
          className="mb-3 inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300"
        >
          <ArrowLeft className="h-3 w-3" />
          All reports
        </Link>
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{def.title}</h1>
            <p className="text-sm text-neutral-400">{def.blurb}</p>
          </div>
          <ReportExportButtons
            def={def}
            form={form}
            enabled={data !== null && !loading && error === null}
            onError={setError}
          />
        </header>

        <ReportFilterBar def={def} form={form} setForm={setForm} onRun={runFetch} loading={loading} />

        <ReportResultPanel
          columns={columns}
          rows={rows}
          notes={data?.notes ?? []}
          scopeNote={data?.scopeNote}
          loading={loading}
          error={error}
        />
      </div>
    </AppLayout>
  );
}
