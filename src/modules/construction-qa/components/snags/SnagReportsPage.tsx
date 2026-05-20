/**
 * SnagReportsPage — Two-panel view:
 *
 * 1. Reports Library (shown when projectId prop is provided): SWR-driven
 *    paginated list of saved snag_reports records (TQR / Works QA / Scoped),
 *    filterable by source via chip row.
 *
 * 2. Resolution-Report Viewer: Filterable query over individual resolved
 *    snags with Excel + PDF export. Always visible.
 *
 * Heavy sub-concerns live in sibling files:
 *   - LegacySnagReportCard.tsx — table-row component for the viewer
 *   - ScopeReportCard.tsx      — card for source='scope' library rows
 *   - snagReportExporter.ts    — exportExcel / exportPdf helpers
 */

'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import { FileSpreadsheet, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { log } from '@/lib/logger';
import { SnagReportsFilters } from './SnagReportsFilters';
import {
  buildReportQuery,
  emptyFilters,
  type ReportFilterState,
} from './snagReportFilterState';
import { LegacySnagReportRow, type ReportRow } from './LegacySnagReportCard';
import { ScopeReportCard, type ScopeReport } from './ScopeReportCard';
import { exportSnagReportExcel, exportSnagReportPdf } from './snagReportExporter';

// ─── Source chip types ───────────────────────────────────────────────────────

type SourceFilter = 'all' | 'tqr' | 'works_qa' | 'scope';

const SOURCE_CHIPS: { value: SourceFilter; label: string }[] = [
  { value: 'all',      label: 'All' },
  { value: 'tqr',      label: 'TQR' },
  { value: 'works_qa', label: 'Works QA' },
  { value: 'scope',    label: 'Scoped' },
];

// ─── Library report row (union of TQR/works_qa and scope shapes) ─────────────

interface LibraryRow {
  id: string;
  source: string;
  report_number: string;
  project_name: string;
  [key: string]: unknown;
}

interface LibraryApiResponse {
  data: LibraryRow[];
  pagination: { total: number; page: number; pageSize: number };
}

async function libraryFetcher(url: string): Promise<LibraryApiResponse> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<LibraryApiResponse>;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface SnagReportsPageProps {
  /** When provided, renders the Reports Library panel above the viewer. */
  projectId?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SnagReportsPage({ projectId }: SnagReportsPageProps = {}) {
  // Resolution-report viewer state
  const [filters, setFilters] = useState<ReportFilterState>(emptyFilters());
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasQueried, setHasQueried] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  // Library source chip state
  const [source, setSource] = useState<SourceFilter>('all');

  // SWR key for the reports library — null when no projectId
  const swrKey = projectId
    ? `/api/snags/reports?projectId=${encodeURIComponent(projectId)}&pageSize=20${source !== 'all' ? `&source=${source}` : ''}`
    : null;

  const { data: libraryData } = useSWR<LibraryApiResponse>(swrKey, libraryFetcher);

  // Run the resolution report
  const runReport = useCallback(async () => {
    if (!filters.dateFrom || !filters.dateTo) {
      toast.error('Please select both date from and date to');
      return;
    }
    setIsLoading(true);
    setHasQueried(true);
    try {
      const qs = buildReportQuery(filters);
      const res = await fetch(`/api/snags/resolution-report?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { data: { rows: ReportRow[] } };
      setRows(json.data.rows);
    } catch (err) {
      log.error('SnagReportsPage: fetch failed', { err });
      toast.error('Failed to load report data');
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  async function handleExportExcel() {
    await exportSnagReportExcel(rows, filters);
  }

  async function handleExportPdf() {
    setExportingPdf(true);
    try {
      await exportSnagReportPdf(rows, filters);
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="p-4 space-y-4">

      {/* ── Reports Library ─────────────────────────────────────────────── */}
      {projectId && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-slate-300">Reports Library</h3>

          {/* Source filter chips */}
          <div className="flex gap-2">
            {SOURCE_CHIPS.map(c => (
              <button
                key={c.value}
                type="button"
                onClick={() => setSource(c.value)}
                aria-pressed={source === c.value}
                className={
                  'px-3 py-1 rounded-full text-xs border ' +
                  (source === c.value
                    ? 'bg-emerald-600 border-emerald-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500')
                }
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Library cards */}
          {libraryData && libraryData.data.length === 0 && (
            <p className="text-xs text-slate-500 py-4 text-center">No reports found</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(libraryData?.data ?? []).map(row =>
              row.source === 'scope'
                ? <ScopeReportCard key={row.id} report={row as unknown as ScopeReport} />
                : (
                  <div
                    key={row.id}
                    className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-sm text-slate-300"
                  >
                    <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                      {row.source === 'tqr' ? 'TQR' : 'Works QA'}
                    </div>
                    <div className="font-semibold text-slate-100 truncate">{row.report_number}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{row.project_name}</div>
                  </div>
                )
            )}
          </div>
        </div>
      )}

      {/* ── Resolution-Report Viewer ─────────────────────────────────────── */}
      <SnagReportsFilters
        value={filters}
        onChange={setFilters}
        onRun={() => void runReport()}
        isLoading={isLoading}
      />

      {rows.length > 0 && (
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-4 text-xs text-zinc-400">
            <span className="font-medium text-zinc-200">{rows.length} snags</span>
            <span>·</span>
            <span>{rows.filter(r => ['resolved', 'verified', 'closed'].includes(r.status)).length} resolved/verified/closed</span>
            <span>·</span>
            <span>{rows.filter(r => r.status === 'pending_qa').length} pending QA</span>
            <span>·</span>
            <span>{rows.filter(r => ['open', 'reopened', 'assigned', 'in_progress'].includes(r.status)).length} active</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExportExcel()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-green-400" />
              Export Excel
            </button>
            <button
              type="button"
              onClick={() => void handleExportPdf()}
              disabled={exportingPdf}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 transition-colors"
            >
              <FileText className="w-3.5 h-3.5 text-red-400" />
              {exportingPdf ? 'Generating…' : 'Export PDF'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
        <div className="overflow-auto max-h-[calc(100vh-320px)]">
          <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
            <thead className="sticky top-0 z-10 bg-[var(--ff-bg-tertiary)]">
              <tr>
                {['#', 'Project', 'Report', 'Snag #', 'Category', 'Severity', 'Description', 'Ref', 'Zone', 'PON', 'Status', 'Date Opened', 'Date Resolved', 'Assigned To', 'Photos', 'Notes'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
              {isLoading && Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 16 }).map((__, j) => (
                    <td key={j} className="px-3 py-3"><div className="h-3 bg-zinc-700 rounded w-full" /></td>
                  ))}
                </tr>
              ))}
              {!isLoading && hasQueried && rows.length === 0 && (
                <tr><td colSpan={16} className="px-4 py-12 text-center text-sm text-zinc-500">No snags match the selected filters</td></tr>
              )}
              {!isLoading && !hasQueried && (
                <tr><td colSpan={16} className="px-4 py-12 text-center text-sm text-zinc-500">
                  Adjust filters and click <span className="text-zinc-300 font-medium">Run Report</span>
                </td></tr>
              )}
              {!isLoading && rows.map((r, i) => (
                <LegacySnagReportRow key={r.id} row={r} index={i} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
