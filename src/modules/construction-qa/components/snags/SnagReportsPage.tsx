/**
 * SnagReportsPage — Filterable snag report with Excel + PDF export.
 *
 * Filters (project, status, category, severity, assignee, zone/pon, photos,
 * min resolution age, date-field toggle) are applied server-side.
 * Excel and PDF exports always reflect the filtered dataset.
 */

'use client';

import { useState, useCallback } from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import ExcelJS from 'exceljs';
import toast from 'react-hot-toast';
import { log } from '@/lib/logger';
import { SnagReportsFilters } from './SnagReportsFilters';
import {
  buildReportQuery,
  emptyFilters,
  type ReportFilterState,
} from './snagReportFilterState';

interface ReportRowPhoto {
  id: string;
  phase: string;
  photo_url: string;
  thumbnail_url: string | null;
}
interface ReportRowNote {
  content: string;
  note_type: string;
  created_by_name: string | null;
  created_at: string;
}
interface ReportRow {
  id: string;
  project_name: string;
  report_number: string;
  description: string;
  pole_reference: string | null;
  zone_no: number | null;
  pon_no: number | null;
  category: string;
  severity: string;
  status: string;
  snag_number: number;
  opened_date: string;
  resolved_date: string | null;
  assigned_to_name: string | null;
  noc_ticket_uid: string | null;
  photos: ReportRowPhoto[];
  notes: ReportRowNote[];
}

function fmt(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusBadgeClass(s: string): string {
  switch (s) {
    case 'pending_qa':  return 'bg-orange-900/60 text-orange-300';
    case 'resolved':    return 'bg-blue-900/60 text-blue-300';
    case 'verified':    return 'bg-green-900/60 text-green-300';
    case 'closed':      return 'bg-green-900/80 text-green-200';
    case 'open':        return 'bg-red-900/60 text-red-300';
    case 'reopened':    return 'bg-red-900/60 text-red-300';
    default:            return 'bg-zinc-700 text-zinc-300';
  }
}

function statusLabel(s: string): string {
  return s === 'pending_qa' ? 'Pending QA' : s.charAt(0).toUpperCase() + s.slice(1);
}

export function SnagReportsPage() {
  const [filters, setFilters] = useState<ReportFilterState>(emptyFilters());
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasQueried, setHasQueried] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

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

  async function exportExcel() {
    if (rows.length === 0) return;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'FibreFlow';
    wb.created = new Date();
    const ws = wb.addWorksheet('Snag Report');

    ws.mergeCells('A1:P1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `VelocityFibre — Snag Report`;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a1f2e' } };
    titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
    ws.getRow(1).height = 28;

    ws.mergeCells('A2:P2');
    const subCell = ws.getCell('A2');
    const today = new Date().toISOString().slice(0, 10);
    subCell.value =
      `Period (${filters.dateField === 'resolved' ? 'Resolved' : 'Opened'}): ${fmt(filters.dateFrom)} — ${fmt(filters.dateTo)}` +
      `   |   Generated: ${fmt(today)}   |   Total snags: ${rows.length}`;
    subCell.font = { size: 10, color: { argb: 'FF9CA3AF' } };
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
    subCell.alignment = { horizontal: 'left', vertical: 'middle' };
    ws.getRow(2).height = 18;

    const headers = ['#', 'Project', 'Report', 'Snag #', 'Category', 'Severity', 'Description', 'Ref', 'Zone', 'PON', 'Status', 'Date Opened', 'Date Resolved', 'Assigned To', 'Photos (B/A)', 'Notes'];
    ws.addRow(headers);
    const headerRow = ws.getRow(3);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
    headerRow.height = 18;

    rows.forEach((r, i) => {
      const beforeCount = r.photos.filter(p => p.phase === 'before').length;
      const afterCount  = r.photos.filter(p => p.phase === 'after').length;
      ws.addRow([
        i + 1, r.project_name, r.report_number, r.snag_number,
        r.category, r.severity, r.description,
        r.pole_reference ?? '—', r.zone_no ?? '—', r.pon_no ?? '—',
        statusLabel(r.status), fmt(r.opened_date), fmt(r.resolved_date),
        r.assigned_to_name ?? '—',
        `${beforeCount}B / ${afterCount}A`,
        r.notes.length > 0 ? r.notes.map(n => `[${n.note_type}] ${n.created_by_name ?? 'Unknown'}: ${n.content}`).join(' | ') : '—',
      ]);
    });

    ws.eachRow((row, rowNum) => {
      if (rowNum <= 3) return;
      row.font = { size: 9, color: { argb: 'FFE5E7EB' } };
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowNum % 2 === 0 ? 'FF1F2937' : 'FF111827' } };
      row.alignment = { vertical: 'middle', wrapText: false };
      row.height = 15;
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF374151' } },
          bottom: { style: 'thin', color: { argb: 'FF374151' } },
          left: { style: 'thin', color: { argb: 'FF374151' } },
          right: { style: 'thin', color: { argb: 'FF374151' } },
        };
      });
    });

    ws.columns = [
      { key: 'num', width: 5 },  { key: 'project', width: 18 },
      { key: 'report', width: 16 }, { key: 'snag', width: 8 },
      { key: 'category', width: 12 }, { key: 'severity', width: 10 },
      { key: 'description', width: 40 }, { key: 'ref', width: 14 },
      { key: 'zone', width: 8 }, { key: 'pon', width: 8 },
      { key: 'status', width: 14 }, { key: 'opened', width: 14 },
      { key: 'resolved', width: 14 }, { key: 'assigned', width: 20 },
      { key: 'photos', width: 12 }, { key: 'notes', width: 50 },
    ];

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `snag-report-${filters.dateFrom}-to-${filters.dateTo}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Excel exported — ${rows.length} snags`);
  }

  async function exportPdf() {
    if (rows.length === 0) return;
    setExportingPdf(true);
    try {
      const { generateSnagResolutionPdf } = await import('../../utils/snagResolutionPdf');
      const blob = await generateSnagResolutionPdf(
        rows as Parameters<typeof generateSnagResolutionPdf>[0],
        filters.dateFrom,
        filters.dateTo,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `snag-report-${filters.dateFrom}-to-${filters.dateTo}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`PDF exported — ${rows.length} snags`);
    } catch (err) {
      log.error('SnagReportsPage: PDF export failed', { err });
      toast.error('PDF export failed');
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
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
              onClick={() => void exportExcel()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-green-400" />
              Export Excel
            </button>
            <button
              type="button"
              onClick={() => void exportPdf()}
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
                <tr key={r.id} className="hover:bg-zinc-800/40 transition-colors">
                  <td className="px-3 py-2.5 text-xs text-zinc-500 tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2.5 text-xs text-zinc-300 whitespace-nowrap">{r.project_name}</td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap font-mono">{r.report_number}</td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 tabular-nums text-right">{r.snag_number}</td>
                  <td className="px-3 py-2.5 text-xs">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-700 text-zinc-300 capitalize">{r.category}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-700 text-zinc-300 capitalize">{r.severity}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-zinc-300 max-w-xs"><span className="line-clamp-2">{r.description}</span></td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap font-mono">{r.pole_reference ?? '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 tabular-nums">{r.zone_no ?? '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 tabular-nums">{r.pon_no ?? '—'}</td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusBadgeClass(r.status)}`}>{statusLabel(r.status)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{fmt(r.opened_date)}</td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{fmt(r.resolved_date)}</td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{r.assigned_to_name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap">
                    {r.photos.length > 0 ? (
                      <span className="flex items-center gap-1">
                        {r.photos.filter(p => p.phase === 'before').length > 0 && (
                          <span className="px-1 py-0.5 rounded text-[10px] bg-zinc-700 text-zinc-300">
                            {r.photos.filter(p => p.phase === 'before').length}B
                          </span>
                        )}
                        {r.photos.filter(p => p.phase === 'after').length > 0 && (
                          <span className="px-1 py-0.5 rounded text-[10px] bg-blue-900/60 text-blue-300">
                            {r.photos.filter(p => p.phase === 'after').length}A
                          </span>
                        )}
                      </span>
                    ) : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap">
                    {r.notes.length > 0
                      ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-700 text-zinc-300">{r.notes.length}</span>
                      : <span className="text-zinc-600">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
