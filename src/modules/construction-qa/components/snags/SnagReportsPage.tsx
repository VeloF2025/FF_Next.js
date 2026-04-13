/**
 * SnagReportsPage — Resolution report with date range, Excel + PDF export.
 *
 * Shows all snags moved to pending_qa/resolved/verified/closed within
 * the selected date range. The "opened" date is the TQR report audit_date;
 * the "resolved" date is fixed_at (when the snag was marked pending QA / fixed).
 *
 * Exports:
 *  - Excel: via ExcelJS (same pattern as SnagSummaryPage)
 *  - PDF: via jsPDF + autotable (same pattern as snagCloseoutPdf)
 */

'use client';

import { useState, useCallback } from 'react';
import { FileSpreadsheet, FileText, Search } from 'lucide-react';
import ExcelJS from 'exceljs';
import toast from 'react-hot-toast';
import { log } from '@/lib/logger';

// ============================================================
// Types (inlined to avoid cross-boundary imports)
// ============================================================

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
}

// ============================================================
// Helpers
// ============================================================

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
    default:            return 'bg-zinc-700 text-zinc-300';
  }
}

function statusLabel(s: string): string {
  return s === 'pending_qa' ? 'Pending QA' : s.charAt(0).toUpperCase() + s.slice(1);
}

// ============================================================
// Component
// ============================================================

export function SnagReportsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(monthAgo);
  const [dateTo, setDateTo] = useState(today);
  const [projectFilter, setProjectFilter] = useState('');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasQueried, setHasQueried] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const filteredRows = rows.filter(r =>
    !projectFilter || r.project_name.toLowerCase().includes(projectFilter.toLowerCase())
  );

  const runReport = useCallback(async () => {
    if (!dateFrom || !dateTo) {
      toast.error('Please select both date from and date to');
      return;
    }
    setIsLoading(true);
    setHasQueried(true);
    try {
      const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      const res = await fetch(`/api/snags/resolution-report?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { data: { rows: ReportRow[] } };
      setRows(json.data.rows);
    } catch (err) {
      log.error('SnagReportsPage: fetch failed', { err });
      toast.error('Failed to load report data');
    } finally {
      setIsLoading(false);
    }
  }, [dateFrom, dateTo]);

  async function exportExcel() {
    if (filteredRows.length === 0) return;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'FibreFlow';
    wb.created = new Date();
    const ws = wb.addWorksheet('Snag Resolution Report');

    // Title rows
    ws.mergeCells('A1:N1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `VelocityFibre — Snag Resolution Report`;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a1f2e' } };
    titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
    ws.getRow(1).height = 28;

    ws.mergeCells('A2:N2');
    const subCell = ws.getCell('A2');
    subCell.value = `Period: ${fmt(dateFrom)} — ${fmt(dateTo)}   |   Generated: ${fmt(today)}   |   Total snags: ${filteredRows.length}`;
    subCell.font = { size: 10, color: { argb: 'FF9CA3AF' } };
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
    subCell.alignment = { horizontal: 'left', vertical: 'middle' };
    ws.getRow(2).height = 18;

    // Header row
    const headers = ['#', 'Project', 'Report', 'Snag #', 'Category', 'Severity', 'Description', 'Pole', 'Zone', 'PON', 'Status', 'Date Opened', 'Date Resolved', 'Assigned To'];
    ws.addRow(headers);
    const headerRow = ws.getRow(3);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
    headerRow.height = 18;

    // Data rows
    filteredRows.forEach((r, i) => {
      ws.addRow([
        i + 1,
        r.project_name,
        r.report_number,
        r.snag_number,
        r.category,
        r.severity,
        r.description,
        r.pole_reference ?? '—',
        r.zone_no ?? '—',
        r.pon_no ?? '—',
        statusLabel(r.status),
        fmt(r.opened_date),
        fmt(r.resolved_date),
        r.assigned_to_name ?? '—',
      ]);
    });

    // Style data rows
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

    // Column widths
    ws.columns = [
      { key: 'num', width: 5 },
      { key: 'project', width: 18 },
      { key: 'report', width: 16 },
      { key: 'snag', width: 8 },
      { key: 'category', width: 12 },
      { key: 'severity', width: 10 },
      { key: 'description', width: 40 },
      { key: 'pole', width: 14 },
      { key: 'zone', width: 8 },
      { key: 'pon', width: 8 },
      { key: 'status', width: 14 },
      { key: 'opened', width: 14 },
      { key: 'resolved', width: 14 },
      { key: 'assigned', width: 20 },
    ];

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `snag-resolution-report-${dateFrom}-to-${dateTo}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Excel exported — ${filteredRows.length} snags`);
  }

  async function exportPdf() {
    if (filteredRows.length === 0) return;
    setExportingPdf(true);
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();

      // ── Header ──────────────────────────────────────────────
      doc.setFillColor(26, 31, 46);
      doc.rect(0, 0, pageW, 28, 'F');

      doc.setFontSize(16);
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.text('VelocityFibre — Snag Resolution Report', 12, 12);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(156, 163, 175);
      doc.text(`Period: ${fmt(dateFrom)} — ${fmt(dateTo)}`, 12, 20);
      doc.text(`Generated: ${fmt(today)}   |   Total: ${filteredRows.length} snags`, 12, 25);

      // ── Table ────────────────────────────────────────────────
      autoTable(doc, {
        startY: 32,
        head: [[
          '#', 'Project', 'Report', 'Snag #', 'Category', 'Description',
          'Pole', 'Zone', 'PON', 'Status', 'Date Opened', 'Date Resolved', 'Assigned To',
        ]],
        body: filteredRows.map((r, i) => [
          i + 1,
          r.project_name,
          r.report_number,
          r.snag_number,
          r.category,
          r.description.length > 60 ? r.description.slice(0, 57) + '…' : r.description,
          r.pole_reference ?? '—',
          r.zone_no ?? '—',
          r.pon_no ?? '—',
          statusLabel(r.status),
          fmt(r.opened_date),
          fmt(r.resolved_date),
          r.assigned_to_name ?? '—',
        ]),
        styles: {
          fontSize: 7,
          cellPadding: 2,
          textColor: [229, 231, 235],
          fillColor: [17, 24, 39],
          lineColor: [55, 65, 81],
          lineWidth: 0.1,
          overflow: 'linebreak',
        },
        headStyles: {
          fillColor: [31, 41, 55],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 7.5,
          halign: 'center',
        },
        alternateRowStyles: { fillColor: [26, 31, 46] },
        columnStyles: {
          0: { cellWidth: 8,  halign: 'center' },
          1: { cellWidth: 22 },
          2: { cellWidth: 22 },
          3: { cellWidth: 10, halign: 'center' },
          4: { cellWidth: 16 },
          5: { cellWidth: 'auto' },
          6: { cellWidth: 18 },
          7: { cellWidth: 10, halign: 'center' },
          8: { cellWidth: 10, halign: 'center' },
          9: { cellWidth: 18 },
          10: { cellWidth: 20 },
          11: { cellWidth: 20 },
          12: { cellWidth: 24 },
        },
        margin: { left: 8, right: 8 },
        didDrawPage: (data) => {
          // Footer
          const pageCount = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
          doc.setFontSize(7);
          doc.setTextColor(107, 114, 128);
          doc.text(
            `Page ${data.pageNumber} of ${pageCount}  |  Confidential — VelocityFibre`,
            pageW / 2,
            doc.internal.pageSize.getHeight() - 5,
            { align: 'center' }
          );
        },
      });

      doc.save(`snag-resolution-report-${dateFrom}-to-${dateTo}.pdf`);
      toast.success(`PDF exported — ${filteredRows.length} snags`);
    } catch (err) {
      log.error('SnagReportsPage: PDF export failed', { err });
      toast.error('PDF export failed');
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      {/* ── Filter bar ────────────────────────────────────────── */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-400">Date From (Opened)</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-100 focus:outline-none focus:border-zinc-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-400">Date To (Opened)</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-100 focus:outline-none focus:border-zinc-500"
          />
        </div>
        <button
          type="button"
          onClick={() => void runReport()}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors"
        >
          <Search className="w-3.5 h-3.5" />
          {isLoading ? 'Loading…' : 'Run Report'}
        </button>

        {rows.length > 0 && (
          <div className="relative">
            <input
              type="text"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              placeholder="Filter by project…"
              className="pl-3 pr-3 py-1.5 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 w-44"
            />
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {filteredRows.length > 0 && (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* ── Summary tiles ─────────────────────────────────────── */}
      {filteredRows.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-zinc-400">
          <span className="font-medium text-zinc-200">{filteredRows.length} snags</span>
          <span>·</span>
          <span>{filteredRows.filter(r => r.status === 'resolved' || r.status === 'verified' || r.status === 'closed').length} resolved/verified/closed</span>
          <span>·</span>
          <span>{filteredRows.filter(r => r.status === 'pending_qa').length} pending QA</span>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────── */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
        <div className="overflow-auto max-h-[calc(100vh-260px)]">
          <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
            <thead className="sticky top-0 z-10 bg-[var(--ff-bg-tertiary)]">
              <tr>
                {['#', 'Project', 'Report', 'Snag #', 'Category', 'Description', 'Pole', 'Zone', 'PON', 'Status', 'Date Opened', 'Date Resolved', 'Assigned To'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
              {isLoading && Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 13 }).map((__, j) => (
                    <td key={j} className="px-3 py-3">
                      <div className="h-3 bg-zinc-700 rounded w-full" />
                    </td>
                  ))}
                </tr>
              ))}

              {!isLoading && hasQueried && filteredRows.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-4 py-12 text-center text-sm text-zinc-500">
                    No resolved snags found in this period
                  </td>
                </tr>
              )}

              {!isLoading && !hasQueried && (
                <tr>
                  <td colSpan={13} className="px-4 py-12 text-center text-sm text-zinc-500">
                    Select a date range and click <span className="text-zinc-300 font-medium">Run Report</span>
                  </td>
                </tr>
              )}

              {!isLoading && filteredRows.map((r, i) => (
                <tr key={r.id} className="hover:bg-zinc-800/40 transition-colors">
                  <td className="px-3 py-2.5 text-xs text-zinc-500 tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2.5 text-xs text-zinc-300 whitespace-nowrap">{r.project_name}</td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap font-mono">{r.report_number}</td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 tabular-nums text-right">{r.snag_number}</td>
                  <td className="px-3 py-2.5 text-xs">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-700 text-zinc-300 capitalize">{r.category}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-zinc-300 max-w-xs">
                    <span className="line-clamp-2">{r.description}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap font-mono">{r.pole_reference ?? '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 tabular-nums">{r.zone_no ?? '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 tabular-nums">{r.pon_no ?? '—'}</td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusBadgeClass(r.status)}`}>
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{fmt(r.opened_date)}</td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{fmt(r.resolved_date)}</td>
                  <td className="px-3 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{r.assigned_to_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
