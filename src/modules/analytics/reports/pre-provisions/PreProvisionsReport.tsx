/**
 * Pre-Provisions Report
 * Same layout as Activations — year/month expandable table + bar chart
 * Source: oes_pp_data — logged vs fixed vs open
 * 🟢 WORKING
 */
'use client';

import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, LabelList,
} from 'recharts';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { ReportTabLayout } from '../ReportTabLayout';
import { usePreProvisionsData } from './usePreProvisionsData';
import type { PreProvisionYear, PreProvisionMonth } from './usePreProvisionsData';

// ─── Palette ────────────────────────────────────────────────────────────────
const PALETTE = ['#3b82f6','#f97316','#22c55e','#a855f7','#eab308','#06b6d4','#ec4899','#84cc16'];

const HEADER_BG = '#1a3a4a';

function getProjectCount(projects: { projectName: string; logged: number; fixed: number; open: number }[], name: string, key: 'logged' | 'fixed' | 'open') {
  return projects.find(p => p.projectName === name)?.[key] ?? 0;
}

// ─── Table ──────────────────────────────────────────────────────────────────

const PreProvisionsTable = ({
  years,
  allProjects,
  totals,
}: {
  years: PreProvisionYear[];
  allProjects: string[];
  totals: { logged: number; fixed: number; open: number };
}) => {
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());
  const toggleYear = (y: number) => setExpandedYears(p => { const n = new Set(p); n.has(y) ? n.delete(y) : n.add(y); return n; });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
            <th className="px-3 py-2 text-left font-semibold" style={{ minWidth: 160 }}>Period</th>
            {allProjects.map(p => (
              <th key={p} className="px-2 py-2 text-right font-semibold" style={{ minWidth: 90 }}>{p}</th>
            ))}
            <th className="px-3 py-2 text-right font-semibold" style={{ minWidth: 80 }}>Logged</th>
            <th className="px-3 py-2 text-right font-semibold text-green-400" style={{ minWidth: 80 }}>Fixed</th>
            <th className="px-3 py-2 text-right font-semibold text-orange-400" style={{ minWidth: 80 }}>Open</th>
          </tr>
        </thead>
        <tbody>
          {years.map((year, yi) => {
            const expanded = expandedYears.has(year.year);
            return <>
              {/* Year row */}
              <tr key={year.year} className={yi % 2 === 0 ? 'bg-gray-800' : 'bg-gray-750'}>
                <td className="px-3 py-2">
                  <button onClick={() => toggleYear(year.year)} className="flex items-center gap-1 text-white font-semibold hover:text-blue-400">
                    {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    {year.year}
                  </button>
                </td>
                {allProjects.map(p => (
                  <td key={p} className="px-2 py-2 text-right text-gray-300">
                    {getProjectCount(year.byProject, p, 'logged') || '—'}
                  </td>
                ))}
                <td className="px-3 py-2 text-right text-white font-semibold">{year.logged}</td>
                <td className="px-3 py-2 text-right text-green-400 font-semibold">{year.fixed}</td>
                <td className="px-3 py-2 text-right text-orange-400 font-semibold">{year.open}</td>
              </tr>
              {/* Month rows */}
              {expanded && year.months.map((month, mi) => (
                <tr key={month.monthKey} className="bg-gray-900">
                  <td className="px-3 py-1.5 pl-9 text-gray-400 text-xs">{month.monthLabel}</td>
                  {allProjects.map(p => (
                    <td key={p} className="px-2 py-1.5 text-right text-gray-400 text-xs">
                      {getProjectCount(month.byProject, p, 'logged') || '—'}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right text-gray-300 text-xs">{month.logged}</td>
                  <td className="px-3 py-1.5 text-right text-green-400 text-xs">{month.fixed}</td>
                  <td className="px-3 py-1.5 text-right text-orange-400 text-xs">{month.open || '—'}</td>
                </tr>
              ))}
            </>;
          })}
          {/* Totals */}
          <tr className="bg-gray-900 text-white font-semibold border-t-2 border-gray-600">
            <td className="px-3 py-2">Total</td>
            {allProjects.map(p => (
              <td key={p} className="px-2 py-2 text-right">
                {years.reduce((s, y) => s + getProjectCount(y.byProject, p, 'logged'), 0) || '—'}
              </td>
            ))}
            <td className="px-3 py-2 text-right">{totals.logged}</td>
            <td className="px-3 py-2 text-right text-green-400">{totals.fixed}</td>
            <td className="px-3 py-2 text-right text-orange-400">{totals.open || '—'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

// ─── Chart ──────────────────────────────────────────────────────────────────

const PreProvisionsChart = ({ years, allProjects }: { years: PreProvisionYear[]; allProjects: string[] }) => {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setHidden(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // Flatten to monthly data
  const allMonths = years.flatMap(y => y.months).sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  const chartData = allMonths.map(m => {
    const entry: Record<string, string | number> = { name: m.monthLabel, __total__: m.logged };
    allProjects.forEach(p => {
      entry[p] = hidden.has(p) ? 0 : getProjectCount(m.byProject, p, 'logged');
    });
    return entry;
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-gray-400 mb-3">Monthly pre-provisions logged by project</p>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="name" tick={{ fill: '#d1d5db', fontSize: 11 }} />
            <YAxis tick={{ fill: '#d1d5db', fontSize: 11 }} />
            <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', color: '#fff' }} />
            <Legend onClick={e => toggle(e.dataKey as string)} wrapperStyle={{ cursor: 'pointer' }} />
            {allProjects.map((p, i) => (
              <Bar key={p} dataKey={p} stackId="pp" fill={PALETTE[i % PALETTE.length]}
                isAnimationActive={false} opacity={hidden.has(p) ? 0.15 : 1}>
                {i === allProjects.length - 1 && (
                  <LabelList dataKey="__total__" position="top" fill="#9ca3af" fontSize={11} />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// ─── Main ────────────────────────────────────────────────────────────────────

export default function PreProvisionsReport() {
  const { data, isLoading, error } = usePreProvisionsData();

  if (isLoading) return <div className="flex items-center justify-center h-48 text-gray-400">Loading…</div>;
  if (error || !data) return <div className="flex items-center justify-center h-48 text-red-400">Error loading report</div>;

  return (
    <ReportTabLayout
      tableContent={<PreProvisionsTable years={data.years} allProjects={data.allProjects} totals={data.totals} />}
      chartsContent={<PreProvisionsChart years={data.years} allProjects={data.allProjects} />}
    />
  );
}
