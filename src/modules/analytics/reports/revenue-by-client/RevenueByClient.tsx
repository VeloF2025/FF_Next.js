/**
 * RevenueByClient — Contract revenue grouped by client from the Data tab.
 * Table tab: Client | Revenue | % of Total
 * Charts tab: placeholder
 */

// 🟢 WORKING: Revenue by Client report component
'use client';

import { Loader2, AlertCircle } from 'lucide-react';
import { ReportTabLayout } from '../ReportTabLayout';
import { useRevenueByClientData } from './useRevenueByClientData';

function fZAR(value: number): string {
  if (value === 0) return '—';
  const abs = Math.abs(Math.round(value));
  const formatted = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return `R\u00a0${formatted}`;
}

export default function RevenueByClient() {
  const { data, isLoading, error } = useRevenueByClientData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--ff-text-muted)]">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading revenue by client&hellip;
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

  const rows = data?.data ?? [];
  const total = rows.reduce((sum, r) => sum + r.revenue, 0);

  const tableContent = (
    <div className="overflow-x-auto rounded border border-[var(--ff-border)]">
      <table className="min-w-full text-xs">
        <thead>
          <tr style={{ backgroundColor: '#1a3a4a' }}>
            <th className="px-3 py-2 text-left text-xs font-bold text-white">Client</th>
            <th className="px-3 py-2 text-right text-xs font-bold text-white">Revenue</th>
            <th className="px-3 py-2 text-right text-xs font-bold text-white">% of Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const pct = total > 0 ? ((row.revenue / total) * 100).toFixed(1) : '0.0';
            return (
              <tr key={row.client} className="border-b border-[var(--ff-border)] hover:bg-[var(--ff-surface-hover)]">
                <td className="px-3 py-1.5 text-xs text-[var(--ff-text)]">{row.client}</td>
                <td className="px-3 py-1.5 text-xs text-right text-[var(--ff-text)]">{fZAR(row.revenue)}</td>
                <td className="px-3 py-1.5 text-xs text-right text-[var(--ff-text-muted)]">{pct}%</td>
              </tr>
            );
          })}
          {rows.length > 0 && (
            <tr className="border-t border-[var(--ff-border)]">
              <td className="px-3 py-2 text-xs font-bold text-white">Total</td>
              <td className="px-3 py-2 text-xs text-right font-bold text-white">{fZAR(total)}</td>
              <td className="px-3 py-2 text-xs text-right font-bold text-white">100.0%</td>
            </tr>
          )}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="px-3 py-6 text-center text-[var(--ff-text-muted)]">
                No data available
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <ReportTabLayout
      tableContent={tableContent}
      chartsContent={
        <div className="flex items-center justify-center h-40 text-[var(--ff-text-muted)] text-sm">
          Charts coming soon
        </div>
      }
    />
  );
}
