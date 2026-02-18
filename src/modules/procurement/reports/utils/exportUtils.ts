import { log } from '@/lib/logger';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

export interface ExportOptions {
  format: 'pdf' | 'excel' | 'csv';
  filename?: string;
  includeCharts?: boolean;
  sections?: string[];
}

/** Trigger a browser file download from a Blob */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Extract a flat array of rows + header keys from heterogeneous report data */
function extractRows(data: Record<string, unknown>): { headers: string[]; rows: Record<string, unknown>[] } {
  const arrayField = Object.values(data).find(v => Array.isArray(v)) as Record<string, unknown>[] | undefined;
  if (!arrayField || arrayField.length === 0) {
    return { headers: [], rows: [] };
  }
  const firstRow = arrayField[0];
  if (!firstRow) return { headers: [], rows: [] };
  const headers = Object.keys(firstRow);
  return { headers, rows: arrayField };
}

// 🟢 WORKING: CSV export
export function exportToCSV(data: Record<string, unknown>[], headers: string[], filename: string = 'report'): void {
  try {
    const csvContent = [
      headers.join(','),
      ...data.map(row =>
        headers.map(header => {
          const value = (row[header] as string | number) ?? '';
          return typeof value === 'string' && (value.includes(',') || value.includes('"'))
            ? `"${value.replace(/"/g, '""')}"`
            : value;
        }).join(',')
      )
    ].join('\n');
    downloadBlob(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }), `${filename}.csv`);
  } catch (error) {
    log.error('CSV export failed', { data: error }, 'exportUtils');
    throw new Error('Failed to export CSV file');
  }
}

// 🟢 WORKING: PDF export via jsPDF + autoTable
export async function exportToPDF(data: Record<string, unknown>, filename: string = 'report'): Promise<void> {
  try {
    const { headers, rows } = extractRows(data);
    if (headers.length === 0) {
      throw new Error('No tabular data found for PDF export');
    }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // Header
    doc.setFontSize(16);
    doc.text(`FibreFlow Report - ${filename}`, 14, 18);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toISOString().split('T')[0]}`, 14, 25);

    // Data table
    autoTable(doc, {
      startY: 32,
      head: [headers],
      body: rows.map(row => headers.map(h => String(row[h] ?? ''))),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 245] },
    });

    const blob = doc.output('blob');
    downloadBlob(blob, `${filename}.pdf`);
  } catch (error) {
    log.error('PDF export failed', { data: error }, 'exportUtils');
    throw new Error('Failed to export PDF file');
  }
}

// 🟢 WORKING: Excel export via SheetJS
export async function exportToExcel(data: Record<string, unknown>, filename: string = 'report'): Promise<void> {
  try {
    const { headers, rows } = extractRows(data);
    if (headers.length === 0) {
      throw new Error('No tabular data found for Excel export');
    }

    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });

    // Auto-fit column widths: max of header length vs longest cell value
    ws['!cols'] = headers.map(h => {
      const maxLen = Math.max(
        h.length,
        ...rows.map(r => String(r[h] ?? '').length)
      );
      return { wch: Math.min(maxLen + 2, 40) };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');

    const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, `${filename}.xlsx`);
  } catch (error) {
    log.error('Excel export failed', { data: error }, 'exportUtils');
    throw new Error('Failed to export Excel file');
  }
}

// 🟢 WORKING: Main export dispatcher
export async function exportReport(
  reportType: string,
  data: Record<string, unknown>,
  options: ExportOptions
): Promise<void> {
  const filename = options.filename || `${reportType}-${Date.now()}`;

  try {
    switch (options.format) {
      case 'csv': {
        if (reportType === 'supplier-performance' && data.topPerformers) {
          const headers = ['name', 'rating', 'totalSpend', 'performanceScore', 'onTimeDelivery', 'qualityScore'];
          exportToCSV(data.topPerformers as Record<string, unknown>[], headers, filename);
        } else if (reportType === 'cost-savings' && data.categoryBreakdown) {
          const headers = ['category', 'budgeted', 'actual', 'variance', 'variancePercentage'];
          exportToCSV(data.categoryBreakdown as Record<string, unknown>[], headers, filename);
        } else {
          throw new Error(`CSV export not supported for ${reportType}`);
        }
        break;
      }
      case 'pdf':
        await exportToPDF(data, filename);
        break;
      case 'excel':
        await exportToExcel(data, filename);
        break;
      default:
        throw new Error(`Export format ${options.format} not supported`);
    }
  } catch (error) {
    log.error('Export failed', { data: error }, 'exportUtils');
    throw error;
  }
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0
  }).format(amount);
}

export function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0] ?? '';
}