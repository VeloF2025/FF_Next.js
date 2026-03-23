/**
 * ActivationsReport — OES activations by year/month/week.
 * Table: collapsible Year → Month → Week drill-down.
 * Charts: monthly bar chart, click to drill into weekly view.
 */

// 🟢 WORKING: Activations Report — collapsible table + monthly/weekly bar chart
'use client';

import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { ChevronDown, ChevronRight, Loader2, AlertCircle, ChevronLeft } from 'lucide-react';
import { ReportTabLayout } from '../ReportTabLayout';
import { useActivationsData } from './useActivationsData';
import type { ActivationYear, ActivationMonth } from './useActivationsData';

function fZAR(v: number): string {
  if (v === 0) return '—';
  return `R\u00a0${v.toLocaleString('en-ZA').replace(/,/g, '\u00a0')}`;
}

const TOOLTIP_STYLE = {
  contentStyle: { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 6, color: '#F9FAFB', fontSize: 12 },
  itemStyle: { color: '#F9FAFB' },
};

// ── Table ────────────────────────────────────────────────────────────────────

function ActivationsTable({ years }: { years: ActivationYear[] }) {
  const initExpand = () => {
    const m = new Map<string, boolean>();
    for (const y of years) m.set(`year-${y.year}`, true);
    return m;
  };
  const [expanded, setExpanded] = useState<Map<string, boolean>>(initExpand);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Map(prev);
      next.set(key, !prev.get(key));
      return next;
    });
  }

  const th = 'px-3 py-2.5 text-left text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap';
  const thR = 'px-3 py-2.5 text-right text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap';

  const totalActivations = years.reduce((s, y) => s + y.activations, 0);
  const totalRevenue = years.reduce((s, y) => s + y.revenue, 0);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ backgroundColor: '#1a3a4a' }}>
            <th className={th} style={{ minWidth: 280 }}>Period</th>
            <th className={thR}>Activations</th>
            <th className={thR}>Revenue (R)</th>
          </tr>
        </thead>
        <tbody>
          {years.map((year) => {
            const yearKey = `year-${year.year}`;
            const yearOpen = expanded.get(yearKey) ?? true;
            return (
              <>
                {/* Year row */}
                <tr
                  key={yearKey}
                  className="cursor-pointer select-none"
                  style={{ backgroundColor: '#1a3a4a' }}
                  onClick={() => toggle(yearKey)}
                >
                  <td className="px-3 py-2.5 text-white font-bold flex items-center gap-2" style={{ minWidth: 280 }}>
                    {yearOpen ? <ChevronDown className="w-4 h-4 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 flex-shrink-0" />}
                    {year.year}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-white font-bold whitespace-nowrap">{year.activations.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-white font-bold whitespace-nowrap">{fZAR(year.revenue)}</td>
                </tr>

                {/* Month rows */}
                {yearOpen && year.months.map((month) => {
                  const monthKey = `month-${month.monthKey}`;
                  const monthOpen = expanded.get(monthKey) ?? false;
                  return (
                    <>
                      <tr
                        key={monthKey}
                        className="cursor-pointer select-none"
                        style={{ backgroundColor: '#1e3a4a' }}
                        onClick={() => toggle(monthKey)}
                      >
                        <td className="px-3 py-2 text-gray-200 font-semibold whitespace-nowrap pl-8 flex items-center gap-2">
                          {monthOpen ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />}
                          {month.monthLabel}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-200 font-semibold whitespace-nowrap">{month.activations.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-200 font-semibold whitespace-nowrap">{fZAR(month.revenue)}</td>
                      </tr>

                      {/* Week rows */}
                      {monthOpen && month.weeks.map((week, wi) => (
                        <tr key={week.weekStart} className={wi % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60'}>
                          <td className="px-3 py-2 text-gray-400 whitespace-nowrap pl-14">{week.weekLabel}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-300 whitespace-nowrap">{week.activations.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-300 whitespace-nowrap">{fZAR(week.revenue)}</td>
                        </tr>
                      ))}
                    </>
                  );
                })}
              </>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-500 font-bold" style={{ backgroundColor: '#1a3a4a' }}>
            <td className="px-3 py-2.5 text-white">Total</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-white whitespace-nowrap">{totalActivations.toLocaleString()}</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-white whitespace-nowrap">{fZAR(totalRevenue)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Charts ───────────────────────────────────────────────────────────────────

function ActivationsChart({ years }: { years: ActivationYear[] }) {
  const [drillMonth, setDrillMonth] = useState<string | null>(null);

  // Build flat month list (chronological) across all years
  const allMonths: { key: string; label: string; activations: number; revenue: number }[] = [];
  const sortedYears = [...years].sort((a, b) => a.year - b.year);
  for (const yr of sortedYears) {
    const sortedMonths = [...yr.months].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    for (const mo of sortedMonths) {
      allMonths.push({ key: mo.monthKey, label: mo.monthLabel, activations: mo.activations, revenue: mo.revenue });
    }
  }

  // Drilled: find the selected month's weeks
  let drilledMonth: ActivationMonth | undefined;
  if (drillMonth) {
    for (const yr of years) {
      drilledMonth = yr.months.find((m) => m.monthKey === drillMonth);
      if (drilledMonth) break;
    }
  }

  const chartData = drillMonth && drilledMonth
    ? [...drilledMonth.weeks]
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
        .map((w) => ({ label: w.weekLabel.split(' – ')[0] ?? w.weekStart, activations: w.activations, revenue: w.revenue }))
    : allMonths.map((m) => ({ label: m.label.split(' ')[0] + ' ' + m.label.split(' ')[1], activations: m.activations, revenue: m.revenue, _key: m.key }));

  return (
    <div className="space-y-3">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <button
          className={`font-medium transition-colors ${drillMonth ? 'text-blue-400 hover:text-blue-300 underline cursor-pointer' : 'text-white'}`}
          onClick={() => drillMonth && setDrillMonth(null)}
        >
          All Months
        </button>
        {drillMonth && drilledMonth && (
          <>
            <span className="text-gray-500">›</span>
            <span className="text-white font-medium">{drilledMonth.monthLabel}</span>
            <button
              onClick={() => setDrillMonth(null)}
              className="ml-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 border border-gray-600 rounded px-2 py-0.5"
            >
              <ChevronLeft className="w-3 h-3" /> Back
            </button>
          </>
        )}
      </div>

      <p className="text-xs text-gray-500">
        {drillMonth ? 'Weekly activations for selected month' : 'Click a bar to drill into weekly view'}
      </p>

      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 16, right: 16, bottom: 60, left: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
            <XAxis
              dataKey="label"
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
              allowDecimals={false}
            />
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(value: number, name: string) => {
                if (name === 'activations') return [value.toLocaleString(), 'Activations'];
                return [fZAR(value), 'Revenue'];
              }}
            />
            <Bar
              dataKey="activations"
              maxBarSize={48}
              isAnimationActive={false}
              cursor={drillMonth ? 'default' : 'pointer'}
              onClick={(entry) => {
                if (!drillMonth && '_key' in entry) setDrillMonth(entry._key as string);
              }}
            >
              {chartData.map((_, idx) => (
                <Cell key={idx} fill="#3b82f6" />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function ActivationsReport() {
  const { data, isLoading, error } = useActivationsData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading activations&hellip;
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

  const years = data?.data?.years ?? [];

  return (
    <ReportTabLayout
      tableContent={<ActivationsTable years={years} />}
      chartsContent={<ActivationsChart years={years} />}
    />
  );
}
