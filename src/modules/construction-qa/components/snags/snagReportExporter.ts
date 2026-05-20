/**
 * snagReportExporter — Excel + PDF export utilities for the snag resolution
 * report viewer. Extracted from SnagReportsPage to honour the 300-line limit.
 */

import ExcelJS from 'exceljs';
import toast from 'react-hot-toast';
import { log } from '@/lib/logger';
import { type ReportFilterState } from './snagReportFilterState';
import { type ReportRow, statusLabel } from './LegacySnagReportCard';

function fmt(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Build and download an Excel workbook from the current report rows. */
export async function exportSnagReportExcel(rows: ReportRow[], filters: ReportFilterState): Promise<void> {
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
      r.notes.length > 0
        ? r.notes.map(n => `[${n.note_type}] ${n.created_by_name ?? 'Unknown'}: ${n.content}`).join(' | ')
        : '—',
    ]);
  });

  ws.eachRow((row, rowNum) => {
    if (rowNum <= 3) return;
    row.font = { size: 9, color: { argb: 'FFE5E7EB' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowNum % 2 === 0 ? 'FF1F2937' : 'FF111827' } };
    row.alignment = { vertical: 'middle', wrapText: false };
    row.height = 15;
    row.eachCell(cell => {
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

/** Generate and download a PDF from the current report rows. */
export async function exportSnagReportPdf(rows: ReportRow[], filters: ReportFilterState): Promise<void> {
  if (rows.length === 0) return;
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
    log.error('snagReportExporter: PDF export failed', { err });
    toast.error('PDF export failed');
  }
}
