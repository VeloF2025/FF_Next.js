/**
 * ProjectRevenue — Forecast vs Actual Profitability per project.
 * Table: Forecast Rev | Forecast COS | Forecast GP | Forecast Margin | Actual Rev | Actual COS | Actual GP | Actual Margin
 * Charts: Grouped bar (Forecast Rev vs Actual Rev) + Margin % comparison
 * 🟢 WORKING
 */
'use client';

import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend, LabelList,
} from '@/components/ui/DynamicChart';
import { useProjectRevenueData } from './useProjectRevenueData';
import { AlertCircle } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { ReportTabLayout } from '../ReportTabLayout';
import type { ProjectProfitabilityRow } from './useProjectRevenueData';

// ─── helpers ───────────────────────────────────────────────────────────────

function fZAR(v: number): string {
  if (v === 0) return '—';
  const abs = Math.abs(Math.round(v));
  if (abs >= 1_000_000) return `R ${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `R ${Math.round(v / 1_000)}K`;
  return `R ${abs}`;
}

function fPct(v: number | null): string {
  if (v === null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function marginColor(v: number | null): string {
  if (v === null) return '#6b7280';
  if (v >= 0.2) return '#22c55e';
  if (v >= 0.1) return '#eab308';
  return '#ef4444';
}

function shortName(name: string): string {
  return name.length > 16 ? name.slice(0, 14) + '…' : name;
}

const TOOLTIP_STYLE = {
  contentStyle: { backgroundColor: '#1f2937', border: '1px solid #374151', color: '#fff', fontSize: 12 },
};

// ─── Table ─────────────────────────────────────────────────────────────────

const ProfitabilityTable = ({ rows, totals }: { rows: ProjectProfitabilityRow[]; totals: any }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr style={{ backgroundColor: '#1a3a4a' }} className="text-white">
          <th className="px-3 py-2 text-left font-semibold sticky left-0" style={{ minWidth: 160, backgroundColor: '#1a3a4a' }}>Project</th>
          {/* Forecast */}
          <th className="px-3 py-2 text-right font-semibold text-blue-300">Fcst Revenue</th>
          <th className="px-3 py-2 text-right font-semibold text-orange-300">Fcst COS</th>
          <th className="px-3 py-2 text-right font-semibold text-green-300">Fcst GP</th>
          <th className="px-3 py-2 text-right font-semibold text-green-300">Fcst Margin</th>
          {/* Actual */}
          <th className="px-3 py-2 text-right font-semibold text-blue-200 border-l border-gray-600">Actual Revenue</th>
          <th className="px-3 py-2 text-right font-semibold text-orange-200">Actual COS</th>
          <th className="px-3 py-2 text-right font-semibold text-green-200">Actual GP</th>
          <th className="px-3 py-2 text-right font-semibold text-green-200">Actual Margin</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={row.project} className={idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-750'}>
            <td className="px-3 py-2 text-white font-medium sticky left-0 bg-inherit">{row.project}</td>
            <td className="px-3 py-2 text-right text-gray-300">{fZAR(row.forecastRevenue)}</td>
            <td className="px-3 py-2 text-right text-gray-300">{fZAR(row.forecastCos)}</td>
            <td className="px-3 py-2 text-right text-gray-300">{fZAR(row.forecastGP)}</td>
            <td className="px-3 py-2 text-right font-semibold" style={{ color: marginColor(row.forecastMargin) }}>{fPct(row.forecastMargin)}</td>
            <td className="px-3 py-2 text-right text-gray-300 border-l border-gray-700">{fZAR(row.actualRevenue)}</td>
            <td className="px-3 py-2 text-right text-gray-300">{fZAR(row.actualCos)}</td>
            <td className="px-3 py-2 text-right text-gray-300">{fZAR(row.actualGP)}</td>
            <td className="px-3 py-2 text-right font-semibold" style={{ color: marginColor(row.actualMargin) }}>{fPct(row.actualMargin)}</td>
          </tr>
        ))}
        <tr className="bg-gray-900 text-white font-semibold border-t-2 border-gray-600">
          <td className="px-3 py-2 sticky left-0 bg-gray-900">Total</td>
          <td className="px-3 py-2 text-right">{fZAR(totals.forecastRevenue)}</td>
          <td className="px-3 py-2 text-right">{fZAR(totals.forecastCos)}</td>
          <td className="px-3 py-2 text-right">{fZAR(totals.forecastGP)}</td>
          <td className="px-3 py-2 text-right" style={{ color: marginColor(totals.forecastMargin) }}>{fPct(totals.forecastMargin)}</td>
          <td className="px-3 py-2 text-right border-l border-gray-700">{fZAR(totals.actualRevenue)}</td>
          <td className="px-3 py-2 text-right">{fZAR(totals.actualCos)}</td>
          <td className="px-3 py-2 text-right">{fZAR(totals.actualGP)}</td>
          <td className="px-3 py-2 text-right" style={{ color: marginColor(totals.actualMargin) }}>{fPct(totals.actualMargin)}</td>
        </tr>
      </tbody>
    </table>
  </div>
);

// ─── Charts ────────────────────────────────────────────────────────────────

const ProfitabilityCharts = ({ rows }: { rows: ProjectProfitabilityRow[] }) => {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setHidden(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const barData = rows.map(r => ({
    name: shortName(r.project),
    fullName: r.project,
    'Fcst Revenue': hidden.has('Fcst Revenue') ? 0 : r.forecastRevenue,
    'Actual Revenue': hidden.has('Actual Revenue') ? 0 : r.actualRevenue,
    'Actual COS': hidden.has('Actual COS') ? 0 : r.actualCos,
    'Actual GP': hidden.has('Actual GP') ? 0 : r.actualGP,
  }));

  const marginData = [...rows]
    .filter(r => r.actualRevenue > 0)
    .sort((a, b) => (b.actualMargin ?? 0) - (a.actualMargin ?? 0))
    .map(r => ({
      name: shortName(r.project),
      fullName: r.project,
      'Actual Margin': parseFloat(((r.actualMargin ?? 0) * 100).toFixed(1)),
      'Fcst Margin': parseFloat(((r.forecastMargin ?? 0) * 100).toFixed(1)),
      _actualMargin: r.actualMargin,
    }));

  return (
    <div className="space-y-10">
      {/* Revenue comparison */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">Forecast vs Actual Revenue, COS & GP</h3>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={barData} margin={{ top: 16, right: 16, bottom: 60, left: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} angle={-35} textAnchor="end" interval={0} />
            <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={(v: number) => `R ${(v/1_000_000).toFixed(1)}M`} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v: number, name: string) => [fZAR(v), name]} labelFormatter={(l: string, p: Array<{ payload?: { fullName?: string } }>) => p?.[0]?.payload?.fullName ?? l} />
            <Legend onClick={(e: { dataKey?: string }) => toggle(e.dataKey as string)} wrapperStyle={{ cursor: 'pointer', paddingTop: 8, fontSize: 12 }} />
            <Bar dataKey="Fcst Revenue" fill="#6b7280" maxBarSize={28} />
            <Bar dataKey="Actual Revenue" fill="#3b82f6" maxBarSize={28} />
            <Bar dataKey="Actual COS" fill="#f97316" maxBarSize={28} />
            <Bar dataKey="Actual GP" fill="#22c55e" maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Margin comparison */}
      {marginData.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-white mb-3">Actual Margin % vs Forecast Margin % (projects with actuals)</h3>
          <div style={{ height: Math.max(160, marginData.length * 52) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={marginData} layout="vertical" margin={{ top: 4, right: 80, bottom: 4, left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
                <XAxis type="number" tickFormatter={(v: number) => `${v}%`} tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} width={130} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number, name: string) => [`${v}%`, name]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Fcst Margin" fill="#6b7280" maxBarSize={16} radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="Fcst Margin" position="right" fill="#9ca3af" fontSize={11} formatter={(v: number) => `${v}%`} />
                </Bar>
                <Bar dataKey="Actual Margin" maxBarSize={16} radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="Actual Margin" position="right" fill="#9ca3af" fontSize={11} formatter={(v: number) => `${v}%`} />
                  {marginData.map((entry, i) => (
                    <Cell key={i} fill={marginColor(entry._actualMargin)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-6 mt-2 text-xs text-gray-400">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block bg-green-500" />≥ 20%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block bg-yellow-500" />10–19%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block bg-red-500" />&lt; 10%</span>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Main ──────────────────────────────────────────────────────────────────

export default function ProjectRevenue() {
  const { data, isLoading, error } = useProjectRevenueData();

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      <InlineSpinner size="md" className="mr-2" />Loading…
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 text-red-400 p-4">
      <AlertCircle className="w-5 h-5" /><span>{error.message}</span>
    </div>
  );

  if (!data) return null;

  return (
    <ReportTabLayout
      tableContent={<ProfitabilityTable rows={data.rows} totals={data.totals} />}
      chartsContent={<ProfitabilityCharts rows={data.rows} />}
    />
  );
}
