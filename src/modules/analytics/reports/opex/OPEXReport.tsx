/**
 * OPEXReport — Operational Expenses from Data tab (col D == OPEX).
 * Table: Category × FY26/27/28 + monthly columns
 * Charts: Interactive stacked bar — click legend to cross-filter categories
 *         + total label on top of each bar
 */

// 🟢 WORKING: OPEX Report — table + interactive stacked bar chart
'use client';

import { useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, LabelList,
} from '@/components/ui/DynamicChart';
import { AlertCircle } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { ReportTabLayout } from '../ReportTabLayout';
import { useOPEXData } from './useOPEXData';

/** Row shape from the OPEX API response */
interface OPEXRow {
  category: string;
  isTotal?: boolean;
  monthly: Record<string, number>;
  fy26?: number;
  fy27?: number;
  fy28?: number;
  grandTotal: number;
}

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
  if (v === 0) return '';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `R ${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `R ${(abs / 1_000).toFixed(0)}k`;
  return `R ${Math.round(abs)}`;
}

const TOOLTIP_STYLE = {
  contentStyle: { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 6, color: '#F9FAFB', fontSize: 12 },
  itemStyle: { color: '#F9FAFB' },
};

// Custom legend that supports multi-select cross-filter
interface LegendProps {
  categories: string[];
  colors: string[];
  selected: Set<string>;
  onToggle: (cat: string) => void;
}

function InteractiveLegend({ categories, colors, selected, onToggle }: LegendProps) {
  const anySelected = selected.size > 0;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 px-1">
      {categories.map((cat, idx) => {
        const isActive = !anySelected || selected.has(cat);
        return (
          <button
            key={cat}
            onClick={() => onToggle(cat)}
            className="flex items-center gap-1.5 text-xs transition-opacity"
            style={{ opacity: isActive ? 1 : 0.3 }}
          >
            <span
              className="w-3 h-3 rounded-sm flex-shrink-0"
              style={{ background: colors[idx % colors.length] }}
            />
            <span className={`${selected.has(cat) ? 'font-bold text-white' : 'text-gray-400'}`}>
              {cat}
            </span>
          </button>
        );
      })}
      {anySelected && (
        <button
          onClick={() => onToggle('__clear__')}
          className="text-xs text-blue-400 hover:text-blue-300 underline ml-1"
        >
          Clear filter
        </button>
      )}
    </div>
  );
}

export default function OPEXReport() {
  const { data, isLoading, error } = useOPEXData();
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

  const toggleCategory = useCallback((cat: string) => {
    if (cat === '__clear__') { setSelectedCategories(new Set()); return; }
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <InlineSpinner size="md" className="mr-2" />
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

  const activeRows = rows.filter((r: OPEXRow) => !r.isTotal);
  const categories = activeRows.map((r: OPEXRow) => r.category);
  const anySelected = selectedCategories.size > 0;

  // Build chart data — zero out unselected categories so bars physically shrink
  const chartData = months.map((m: string) => {
    const entry: Record<string, number | string> = { month: m };
    let monthTotal = 0;
    for (const row of activeRows) {
      const val = Math.round(row.monthly[m] ?? 0);
      // If filter active: only include selected categories in bar data
      const effective = anySelected && !selectedCategories.has(row.category) ? 0 : val;
      entry[row.category] = effective;
      monthTotal += effective;
    }
    entry['__total__'] = monthTotal;
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
            {months.map((m: string) => <th key={m} className={thR}>{m}</th>)}
            <th className={thR}>Total</th>
          </tr>
        </thead>
        <tbody>
          {activeRows.map((row: OPEXRow, i: number) => (
            <tr key={row.category} className={i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60'}>
              <td className="px-3 py-2 text-gray-200 whitespace-nowrap" style={{ minWidth: 220 }}>{row.category}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-300 whitespace-nowrap">{fZAR(row.fy26 ?? 0)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-300 whitespace-nowrap">{fZAR(row.fy27 ?? 0)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-300 whitespace-nowrap">{fZAR(row.fy28 ?? 0)}</td>
              {months.map((m: string) => (
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
            {months.map((m: string) => (
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
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-white">Monthly OPEX by Category</h3>
      <p className="text-xs text-gray-500">Click a category in the legend to cross-filter. Click again to deselect.</p>
      <div className="h-96">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 24, right: 16, bottom: 60, left: 16 }}>
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
              formatter={(value: number, name: string) => {
                if (name === '__total__') return null;
                return [fZAR(value), name];
              }}
              itemSorter={(item: { value?: number }) => -(item.value as number)}
            />
            {categories.map((cat: string, idx: number) => {
              const colour = PALETTE[idx % PALETTE.length];
              const isLast = idx === categories.length - 1;
              return (
                <Bar
                  key={cat}
                  dataKey={cat}
                  stackId="opex"
                  fill={colour}
                  fillOpacity={1}
                  maxBarSize={48}
                  isAnimationActive={false}
                >
                  {/* Total label on top of last stack segment */}
                  {isLast && (
                    <LabelList
                      dataKey="__total__"
                      position="top"
                      formatter={fZARShort}
                      style={{ fill: '#E5E7EB', fontSize: 10, fontWeight: 600 }}
                    />
                  )}
                </Bar>
              );
            })}
            {/* Invisible bar just to carry the total label when filtering hides the last segment */}
            <Bar dataKey="__total__" stackId="__label__" fill="transparent" maxBarSize={48} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <InteractiveLegend
        categories={categories}
        colors={PALETTE}
        selected={selectedCategories}
        onToggle={toggleCategory}
      />
    </div>
  );

  return <ReportTabLayout tableContent={tableContent} chartsContent={chartsContent} />;
}
