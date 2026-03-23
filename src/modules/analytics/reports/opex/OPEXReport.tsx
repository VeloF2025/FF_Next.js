/**
 * OPEXReport — Operational Expenses from Data tab (col D == OPEX).
 * Table: Category × FY26/27/28 + monthly columns
 * Charts: Stacked bar — monthly OPEX by expense category
 */

// 🟢 WORKING: OPEX Report — table + stacked bar chart
'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Loader2, AlertCircle } from 'lucide-react';
import { ReportTabLayout } from '../ReportTabLayout';
import { useOPEXData } from './useOPEXData';

// 20-colour palette — cycles if more categories
const PALETTE = [
  '#3b82f6','#f97316','#22c55e','#a855f7','#eab308',
  '#06b6d4','#ec4899','#84cc16','#f43f5e','#8b5cf6',
  '#14b8a6','#fb923c','#4ade80','#c084fc','#facc15',
  '#38bdf8','#f472b6','#a3e635','#fb7185','#818cf8',
];

function fZAR(v: number): string {
  if (v === 0) return '—';
  const abs = Math.abs(Math.round(v));
  return `R\u00a0${abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0')}`;
}

function fZARShort(v: number): string {
  if (v === 0) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `R ${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `R ${(abs / 1_000).toFixed(0)}k`;
  return `R ${Math.round(abs)}`;
}

const TOOLTIP_STYLE = {
  contentStyle: { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 6, color: '#F9FAFB', fontSize: 12 },
  itemStyle: { color: '#F9FAFB' },
};

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

  const { rows = [], months = [], grandTotals } = data?.data ?? {
    rows: [], months: [],
    grandTotals: { fy26: 0, fy27: 0, fy28: 0, monthly: {}, total: 0 },
  };

  const categories = rows.filter((r) => !r.isTotal).map((r) => r.category);

  // Build stacked bar chart data — one entry per month
  const chartData = months.map((m) => {
    const entry: Record<string, number | string> = { month: m };
    for (const row of rows.filter((r) => !r.isTotal)) {
      entry[row.category] = Math.round(row.monthly[m] ?? 0);
    }
    return entry;
  });

  // ── Table ──
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
            {months.map((m) => <th key={m} className={thR}>{m}</th>)}
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

  // ── Charts ──
  const chartsContent = (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-white">Monthly OPEX by Category</h3>
      <div className="h-96">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 60, left: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fill: '#9CA3AF', fontSize: 11 }}
              axisLine={{ stroke: '#4B5563' }}
              tickLine={false}
              angle={-35}
              textAnchor="end"
              interval={0}
            />
            <YAxis
              tick={{ fill: '#9CA3AF', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={fZARShort}
            />
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(value: number, name: string) => [fZAR(value), name]}
            />
            <Legend
              wrapperStyle={{ color: '#9CA3AF', fontSize: 11, paddingTop: 8 }}
              iconType="square"
            />
            {categories.map((cat, idx) => (
              <Bar
                key={cat}
                dataKey={cat}
                stackId="opex"
                fill={PALETTE[idx % PALETTE.length]}
                maxBarSize={48}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  return <ReportTabLayout tableContent={tableContent} chartsContent={chartsContent} />;
}
