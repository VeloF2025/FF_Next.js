/**
 * ProjectRevenue — Project Profitability (Cost Centre view).
 * Table tab: tiered Revenue | COS | Gross Profit | Margin% grid
 * Charts tab:
 *   1. Grouped Bar — Revenue vs COS vs Gross Profit per project
 *   2. Horizontal Bar — Margin % ranked, colour-coded (green/yellow/red)
 */

'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from 'recharts';
import { useProjectRevenueData } from './useProjectRevenueData';
import { AlertCircle, Loader2 } from 'lucide-react';
import { ReportTabLayout } from '../ReportTabLayout';
import { CostCentreRevenueTable } from '../tables/ProjectRevenueTable';
import type { ProjectProfitabilityRow } from './useProjectRevenueData';

// 🟢 WORKING: Project Profitability — grouped bar + margin% charts
function fZAR(v: number): string {
  const abs = Math.abs(Math.round(v));
  const s = abs.toLocaleString('en-ZA').replace(/,/g, '\u202f');
  return `R ${s}`;
}

function marginColor(margin: number): string {
  if (margin >= 0.2) return '#22c55e';  // green-500
  if (margin >= 0.1) return '#eab308';  // yellow-500
  return '#ef4444';                      // red-500
}

const TOOLTIP_STYLE = {
  contentStyle: { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 6, color: '#F9FAFB', fontSize: 12 },
  itemStyle: { color: '#F9FAFB' },
};

function shortName(name: string): string {
  // Shorten long project names for axis labels
  return name.length > 16 ? name.slice(0, 14) + '…' : name;
}

interface ChartsProps { rows: ProjectProfitabilityRow[] }

function ProfitabilityCharts({ rows }: ChartsProps) {
  if (!rows.length) {
    return <div className="flex items-center justify-center h-48 text-gray-500 text-sm">No project data available</div>;
  }

  // Chart 1 data — Revenue, COS, Gross Profit per project
  const groupedData = rows.map((r) => ({
    name: shortName(r.project),
    fullName: r.project,
    Revenue: Math.round(r.revenue),
    COS: Math.round(r.cos),
    'Gross Profit': Math.round(r.grossProfit),
  }));

  // Chart 2 data — Margin % ranked highest → lowest
  const marginData = [...rows]
    .sort((a, b) => b.margin - a.margin)
    .map((r) => ({
      name: shortName(r.project),
      fullName: r.project,
      margin: r.margin,
      marginPct: parseFloat((r.margin * 100).toFixed(1)),
    }));

  return (
    <div className="space-y-10">

      {/* Chart 1 — Revenue vs COS vs Gross Profit */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-4">Revenue vs COS vs Gross Profit</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={groupedData} margin={{ top: 4, right: 16, bottom: 60, left: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis
                dataKey="name"
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
                tickFormatter={(v) => `R ${(v / 1_000_000).toFixed(1)}M`}
              />
              <Tooltip
                {...TOOLTIP_STYLE}
                formatter={(value: number, name: string) => [fZAR(value), name]}
                labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName ?? label}
              />
              <Legend wrapperStyle={{ color: '#9CA3AF', fontSize: 12, paddingTop: 8 }} />
              <Bar dataKey="Revenue" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={32} />
              <Bar dataKey="COS" fill="#f97316" radius={[3, 3, 0, 0]} maxBarSize={32} />
              <Bar dataKey="Gross Profit" fill="#22c55e" radius={[3, 3, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Chart 2 — Margin % ranked */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-4">Gross Margin % by Project</h3>
        <div style={{ height: Math.max(200, marginData.length * 48) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={marginData}
              layout="vertical"
              margin={{ top: 4, right: 64, bottom: 4, left: 16 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 'auto']}
                tickFormatter={(v) => `${v}%`}
                tick={{ fill: '#9CA3AF', fontSize: 11 }}
                axisLine={{ stroke: '#4B5563' }}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fill: '#9CA3AF', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={130}
              />
              <Tooltip
                {...TOOLTIP_STYLE}
                formatter={(value: number) => [`${value}%`, 'Margin']}
                labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName ?? label}
              />
              <Bar dataKey="marginPct" radius={[0, 4, 4, 0]} maxBarSize={28} label={{ position: 'right', fill: '#9CA3AF', fontSize: 11, formatter: (v: number) => `${v}%` }}>
                {marginData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={marginColor(entry.margin)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex gap-6 mt-3 text-xs text-gray-400">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#22c55e' }} />≥ 20%</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#eab308' }} />10–19%</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#ef4444' }} />&lt; 10%</span>
        </div>
      </div>

    </div>
  );
}

export default function ProjectRevenue() {
  const { data, isLoading, error } = useProjectRevenueData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading project profitability&hellip;
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
  // Flatten all children across T1 groups for the charts
  const allProjects: ProjectProfitabilityRow[] = rows.flatMap((t1) => t1.children ?? []);

  return (
    <ReportTabLayout
      tableContent={<CostCentreRevenueTable rows={rows} />}
      chartsContent={<ProfitabilityCharts rows={allProjects} />}
    />
  );
}
