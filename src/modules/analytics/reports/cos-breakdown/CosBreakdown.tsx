/**
 * CosBreakdown — Expenses by Category monthly pivot (Data tab source)
 * Table: Category | FY26 | FY27 | [monthly columns...]
 * 🟢 WORKING
 */
'use client';

import { Loader2, AlertCircle } from 'lucide-react';
import { ReportTabLayout } from '../ReportTabLayout';
import { useCosBreakdownData } from './useCosBreakdownData';
import type { CosBreakdownRow } from './useCosBreakdownData';

const HEADER_BG = '#1a3a4a';

function fZAR(v: number): string {
  if (!v) return '—';
  const abs = Math.abs(Math.round(v));
  if (abs >= 1_000_000) return `R ${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `R ${Math.round(v / 1_000)}K`;
  return `R ${abs}`;
}

const PivotTable = ({
  rows,
  months,
  totals,
}: {
  rows: CosBreakdownRow[];
  months: string[];
  totals: { fy26: number; fy27: number; monthly: Record<string, number> };
}) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm" style={{ minWidth: months.length * 90 + 360 }}>
      <thead>
        <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
          <th className="px-3 py-2 text-left font-semibold sticky left-0" style={{ minWidth: 200, backgroundColor: HEADER_BG }}>
            Category
          </th>
          <th className="px-3 py-2 text-right font-semibold border-l border-gray-600" style={{ minWidth: 110 }}>FY26</th>
          <th className="px-3 py-2 text-right font-semibold" style={{ minWidth: 110 }}>FY27</th>
          {months.map(m => (
            <th key={m} className="px-2 py-2 text-right font-semibold border-l border-gray-700 text-xs" style={{ minWidth: 88 }}>{m}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={row.category} className={idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-750'}>
            <td className="px-3 py-2 text-white sticky left-0 bg-inherit">{row.category}</td>
            <td className="px-3 py-2 text-right text-gray-300 border-l border-gray-600">{fZAR(row.fy26)}</td>
            <td className="px-3 py-2 text-right text-gray-300">{fZAR(row.fy27)}</td>
            {months.map(m => (
              <td key={m} className="px-2 py-2 text-right text-gray-400 text-xs border-l border-gray-700">
                {fZAR(row.monthly[m] ?? 0)}
              </td>
            ))}
          </tr>
        ))}
        <tr className="bg-gray-900 text-white font-semibold border-t-2 border-gray-600">
          <td className="px-3 py-2 sticky left-0 bg-gray-900">Total</td>
          <td className="px-3 py-2 text-right border-l border-gray-600">{fZAR(totals.fy26)}</td>
          <td className="px-3 py-2 text-right">{fZAR(totals.fy27)}</td>
          {months.map(m => (
            <td key={m} className="px-2 py-2 text-right text-xs border-l border-gray-700">
              {fZAR(totals.monthly[m] ?? 0)}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  </div>
);

export default function CosBreakdown() {
  const { data, isLoading, error } = useCosBreakdownData();

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      <Loader2 className="w-6 h-6 animate-spin mr-2" />Loading COS breakdown…
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 text-red-400 p-4">
      <AlertCircle className="w-5 h-5 flex-shrink-0" /><span>{error.message}</span>
    </div>
  );

  if (!data) return null;

  return (
    <ReportTabLayout
      tableContent={<PivotTable rows={data.rows} months={data.months} totals={data.totals} />}
      chartsContent={
        <div className="text-gray-400 text-sm p-4">Charts coming soon</div>
      }
    />
  );
}
