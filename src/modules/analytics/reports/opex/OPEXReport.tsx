/**
 * OPEXReport — Operational Expenses from OPEX worksheet.
 * Category rows × monthly columns — same grid format as Expense Pivot.
 * No type toggle — OPEX tab is pure operational expenses only.
 */

// 🟢 WORKING: OPEX Report component — reads OPEX tab only
'use client';

import { Loader2, AlertCircle } from 'lucide-react';
import { ReportTabLayout } from '../ReportTabLayout';
import { useOPEXData } from './useOPEXData';

function fZAR(v: number): string {
  if (v === 0) return '—';
  const abs = Math.abs(Math.round(v));
  return `R\u00a0${abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0')}`;
}

export default function OPEXReport() {
  const { data, isLoading, error } = useOPEXData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading operational expenses&hellip;
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

  const { rows = [], months = [], grandTotals } = data?.data ?? { rows: [], months: [], grandTotals: { fy26: 0, fy27: 0, monthly: {}, total: 0 } };

  const th = 'px-3 py-2.5 text-left text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap';
  const thR = 'px-3 py-2.5 text-right text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap';

  const tableContent = (
    <div className="overflow-x-auto rounded-lg border border-gray-700">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ backgroundColor: '#1a3a4a' }}>
            <th className={th} style={{ minWidth: 220 }}>Category</th>
            <th className={thR}>FY26</th>
            <th className={thR}>FY27</th>
            <th className={thR}>FY28</th>
            {months.map((m) => (
              <th key={m} className={thR}>{m}</th>
            ))}
            <th className={thR}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.filter((r) => !r.isTotal).map((row, i) => (
            <tr key={row.category} className={i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60'}>
              <td className="px-3 py-2 text-gray-200 whitespace-nowrap" style={{ minWidth: 220 }}>{row.category}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-300 whitespace-nowrap">{fZAR(row.fy26 ?? 0)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-300 whitespace-nowrap">{fZAR(row.fy27 ?? 0)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-300 whitespace-nowrap">{fZAR(row.fy28 ?? 0)}</td>
              {months.map((m) => (
                <td key={m} className="px-3 py-2 text-right tabular-nums text-gray-300 whitespace-nowrap">{fZAR(row.monthly[m] ?? 0)}</td>
              ))}
              <td className="px-3 py-2 text-right tabular-nums text-gray-300 whitespace-nowrap">{fZAR(row.grandTotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-500 font-bold" style={{ backgroundColor: '#1a3a4a' }}>
            <td className="px-3 py-2.5 text-white">Total</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-white whitespace-nowrap">{fZAR(grandTotals?.fy26 ?? 0)}</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-white whitespace-nowrap">{fZAR(grandTotals?.fy27 ?? 0)}</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-white whitespace-nowrap">{fZAR(grandTotals?.fy28 ?? 0)}</td>
            {months.map((m) => (
              <td key={m} className="px-3 py-2.5 text-right tabular-nums text-white whitespace-nowrap">{fZAR(grandTotals?.monthly?.[m] ?? 0)}</td>
            ))}
            <td className="px-3 py-2.5 text-right tabular-nums text-white whitespace-nowrap">{fZAR(grandTotals?.total ?? 0)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  return (
    <ReportTabLayout
      tableContent={tableContent}
      chartsContent={
        <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
          Charts coming soon
        </div>
      }
    />
  );
}
