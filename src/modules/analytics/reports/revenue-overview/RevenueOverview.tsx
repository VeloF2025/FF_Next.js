/**
 * RevenueOverview — Cashflow Statement report.
 * Table: Cash In / Cash Out / Cash Movement / Closing Balance with FY + monthly columns.
 * Charts: placeholder (charts to be added later).
 */

'use client';

import { useRevenueData } from './useRevenueData';
import type { CashflowRow } from './useRevenueData';
import { AlertCircle, Loader2 } from 'lucide-react';
import { ReportTabLayout } from '../ReportTabLayout';

function fZAR(value: number): { text: string; negative: boolean } {
  if (value === 0) return { text: '—', negative: false };
  const negative = value < 0;
  const abs = Math.abs(Math.round(value));
  const formatted = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return { text: `R\u00a0${formatted}`, negative };
}

function NumCell({ value }: { value: number }) {
  const { text, negative } = fZAR(value);
  return (
    <td className={`px-3 py-1.5 text-xs text-right whitespace-nowrap ${negative ? 'text-red-400' : 'text-[var(--ff-text)]'}`}>
      {text}
    </td>
  );
}

function RowEl({ row, months }: { row: CashflowRow; months: string[] }) {
  const labelClass = row.isBold ? 'font-bold border-t border-[var(--ff-border)]' : '';

  // Compute total across all months
  const total = months.reduce((sum, m) => sum + (row.monthly[m] ?? 0), 0);

  return (
    <tr className="border-b border-[var(--ff-border)] hover:bg-[var(--ff-surface-hover)]">
      <td
        className={`px-3 py-1.5 text-xs text-[var(--ff-text)] whitespace-nowrap ${labelClass}`}
        style={{ minWidth: 200 }}
      >
        {row.label}
      </td>
      <NumCell value={row.fy26} />
      <NumCell value={row.fy27} />
      <NumCell value={row.fy28} />
      {months.map((m) => (
        <NumCell key={m} value={row.monthly[m] ?? 0} />
      ))}
      <NumCell value={total} />
    </tr>
  );
}

function CashflowStatementTable({ rows, months }: { rows: CashflowRow[]; months: string[] }) {
  return (
    <div className="overflow-x-auto rounded border border-[var(--ff-border)]">
      <table className="min-w-full text-xs">
        <thead>
          <tr style={{ backgroundColor: '#1a3a4a' }}>
            <th
              className="px-3 py-2 text-left text-xs font-bold text-white whitespace-nowrap sticky left-0 bg-inherit z-10"
              style={{ minWidth: 200 }}
            >
              Label
            </th>
            <th className="px-3 py-2 text-right text-xs font-bold text-white whitespace-nowrap">FY26</th>
            <th className="px-3 py-2 text-right text-xs font-bold text-white whitespace-nowrap">FY27</th>
            <th className="px-3 py-2 text-right text-xs font-bold text-white whitespace-nowrap">FY28</th>
            {months.map((m) => (
              <th key={m} className="px-3 py-2 text-right text-xs font-bold text-white whitespace-nowrap">
                {m}
              </th>
            ))}
            <th className="px-3 py-2 text-right text-xs font-bold text-white whitespace-nowrap">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <RowEl key={`${row.label}-${i}`} row={row} months={months} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 🟢 WORKING: Cashflow Statement — FY + monthly columns table
export default function RevenueOverview() {
  const { data, isLoading, error } = useRevenueData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--ff-text-muted)]">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading cashflow data&hellip;
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-400 p-4">
        <AlertCircle className="w-5 h-5 flex-shrink-0" />
        <span>{error.message}</span>
      </div>
    );
  }

  const cashflowData = data?.data;

  if (!cashflowData) {
    return null;
  }

  return (
    <ReportTabLayout
      tableContent={
        <CashflowStatementTable rows={cashflowData.rows} months={cashflowData.months} />
      }
      chartsContent={
        <div className="flex items-center justify-center h-64 text-[var(--ff-text-muted)] text-sm">
          Charts coming soon
        </div>
      }
    />
  );
}
