/**
 * Pre-Provisions Report
 * Columns: Logged | Activated | Open (located) | Not Found
 * Source: oes_pp_data
 * 🟢 WORKING
 */
'use client';

import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, LabelList,
} from 'recharts';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { ReportTabLayout } from '../ReportTabLayout';
import { usePreProvisionsData } from './usePreProvisionsData';
import type { PreProvisionYear, PreProvisionMonth } from './usePreProvisionsData';

const HEADER_BG = '#1a3a4a';
const PALETTE = ['#3b82f6', '#f97316', '#22c55e', '#a855f7', '#eab308'];

function getPC(projects: { projectName: string; logged: number; activated: number; open: number; notFound: number }[], name: string, key: 'logged' | 'activated' | 'open' | 'notFound') {
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
  totals: { logged: number; activated: number; open: number; notFound: number };
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
              <th key={p} className="px-2 py-2 text-right font-semibold" style={{ minWidth: 80 }}>{p}</th>
            ))}
            <th className="px-3 py-2 text-right font-semibold" style={{ minWidth: 80 }}>Logged</th>
            <th className="px-3 py-2 text-right font-semibold text-green-400" style={{ minWidth: 90 }}>Activated</th>
            <th className="px-3 py-2 text-right font-semibold text-yellow-400" style={{ minWidth: 80 }}>Open</th>
            <th className="px-3 py-2 text-right font-semibold text-red-400" style={{ minWidth: 90 }}>Not Found</th>
          </tr>
        </thead>
        <tbody>
          {years.map((year, yi) => {
            const expanded = expandedYears.has(year.year);
            return (
              <>
                <tr key={year.year} className={yi % 2 === 0 ? 'bg-gray-800' : 'bg-gray-750'}>
                  <td className="px-3 py-2">
                    <button onClick={() => toggleYear(year.year)} className="flex items-center gap-1 text-white font-semibold hover:text-blue-400">
                      {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      {year.year}
                    </button>
                  </td>
                  {allProjects.map(p => (
                    <td key={p} className="px-2 py-2 text-right text-gray-300">{getPC(year.byProject, p, 'logged') || '—'}</td>
                  ))}
                  <td className="px-3 py-2 text-right text-white font-semibold">{year.logged}</td>
                  <td className="px-3 py-2 text-right text-green-400 font-semibold">{year.activated}</td>
                  <td className="px-3 py-2 text-right text-yellow-400 font-semibold">{year.open || '—'}</td>
                  <td className="px-3 py-2 text-right text-red-400 font-semibold">{year.notFound || '—'}</td>
                </tr>
                {expanded && year.months.map((month) => (
                  <tr key={month.monthKey} className="bg-gray-900">
                    <td className="px-3 py-1.5 pl-9 text-gray-400 text-xs">{month.monthLabel}</td>
                    {allProjects.map(p => (
                      <td key={p} className="px-2 py-1.5 text-right text-gray-400 text-xs">{getPC(month.byProject, p, 'logged') || '—'}</td>
                    ))}
                    <td className="px-3 py-1.5 text-right text-gray-300 text-xs">{month.logged}</td>
                    <td className="px-3 py-1.5 text-right text-green-400 text-xs">{month.activated || '—'}</td>
                    <td className="px-3 py-1.5 text-right text-yellow-400 text-xs">{month.open || '—'}</td>
                    <td className="px-3 py-1.5 text-right text-red-400 text-xs">{month.notFound || '—'}</td>
                  </tr>
                ))}
              </>
            );
          })}
          <tr className="bg-gray-900 text-white font-semibold border-t-2 border-gray-600">
            <td className="px-3 py-2">Total</td>
            {allProjects.map(p => (
              <td key={p} className="px-2 py-2 text-right">
                {years.reduce((s, y) => s + getPC(y.byProject, p, 'logged'), 0) || '—'}
              </td>
            ))}
            <td className="px-3 py-2 text-right">{totals.logged}</td>
            <td className="px-3 py-2 text-right text-green-400">{totals.activated}</td>
            <td className="px-3 py-2 text-right text-yellow-400">{totals.open || '—'}</td>
            <td className="px-3 py-2 text-right text-red-400">{totals.notFound || '—'}</td>
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

  const allMonths = years.flatMap(y => y.months).sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  const chartData = allMonths.map(m => ({
    name: m.monthLabel,
    'Activated': hidden.has('Activated') ? 0 : m.activated,
    'Open': hidden.has('Open') ? 0 : m.open,
    'Not Found': hidden.has('Not Found') ? 0 : m.notFound,
    __total__: m.logged,
  }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis dataKey="name" tick={{ fill: '#d1d5db', fontSize: 11 }} />
        <YAxis tick={{ fill: '#d1d5db', fontSize: 11 }} />
        <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', color: '#fff' }} />
        <Legend onClick={e => toggle(e.dataKey as string)} wrapperStyle={{ cursor: 'pointer' }} />
        <Bar dataKey="Activated" stackId="pp" fill="#22c55e" isAnimationActive={false} />
        <Bar dataKey="Open" stackId="pp" fill="#eab308" isAnimationActive={false} />
        <Bar dataKey="Not Found" stackId="pp" fill="#ef4444" isAnimationActive={false}>
          <LabelList dataKey="__total__" position="top" fill="#9ca3af" fontSize={11} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

// ─── By Project Table ────────────────────────────────────────────────────────

const ByProjectTable = ({
  years,
  allProjects,
  totals,
}: {
  years: PreProvisionYear[];
  allProjects: string[];
  totals: { logged: number; activated: number; open: number; notFound: number };
}) => {
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());
  const toggleYear = (y: number) => setExpandedYears(p => { const n = new Set(p); n.has(y) ? n.delete(y) : n.add(y); return n; });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: allProjects.length * 200 + 200 }}>
        <thead>
          {/* Project name header */}
          <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
            <th className="px-3 py-2 text-left font-semibold sticky left-0" style={{ minWidth: 120, backgroundColor: HEADER_BG }}>Period</th>
            {allProjects.map(p => (
              <th key={p} className="px-2 py-2 text-center font-semibold border-l border-gray-600" colSpan={3}>{p}</th>
            ))}
            <th className="px-3 py-2 text-right font-semibold border-l border-gray-600">Total Logged</th>
          </tr>
          {/* Sub-column headers */}
          <tr style={{ backgroundColor: '#0f2a38' }} className="text-xs">
            <th className="px-3 py-1 sticky left-0" style={{ backgroundColor: '#0f2a38' }} />
            {allProjects.map(p => (
              <>
                <th key={`${p}-a`} className="px-2 py-1 text-green-400 text-right border-l border-gray-700">Act</th>
                <th key={`${p}-o`} className="px-2 py-1 text-yellow-400 text-right">Open</th>
                <th key={`${p}-n`} className="px-2 py-1 text-red-400 text-right">NF</th>
              </>
            ))}
            <th className="px-3 py-1 text-gray-400 text-right border-l border-gray-700" />
          </tr>
        </thead>
        <tbody>
          {years.map((year, yi) => {
            const expanded = expandedYears.has(year.year);
            return (
              <>
                <tr key={year.year} className={yi % 2 === 0 ? 'bg-gray-800' : 'bg-gray-750'}>
                  <td className="px-3 py-2 sticky left-0 bg-inherit">
                    <button onClick={() => toggleYear(year.year)} className="flex items-center gap-1 text-white font-semibold hover:text-blue-400">
                      {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      {year.year}
                    </button>
                  </td>
                  {allProjects.map(p => (
                    <>
                      <td key={`${p}-a`} className="px-2 py-2 text-right text-green-400 border-l border-gray-700">{getPC(year.byProject, p, 'activated') || '—'}</td>
                      <td key={`${p}-o`} className="px-2 py-2 text-right text-yellow-400">{getPC(year.byProject, p, 'open') || '—'}</td>
                      <td key={`${p}-n`} className="px-2 py-2 text-right text-red-400">{getPC(year.byProject, p, 'notFound') || '—'}</td>
                    </>
                  ))}
                  <td className="px-3 py-2 text-right text-white font-semibold border-l border-gray-700">{year.logged}</td>
                </tr>
                {expanded && year.months.map(month => (
                  <tr key={month.monthKey} className="bg-gray-900">
                    <td className="px-3 py-1.5 pl-9 text-gray-400 text-xs sticky left-0 bg-gray-900">{month.monthLabel}</td>
                    {allProjects.map(p => (
                      <>
                        <td key={`${p}-a`} className="px-2 py-1.5 text-right text-green-400 text-xs border-l border-gray-700">{getPC(month.byProject, p, 'activated') || '—'}</td>
                        <td key={`${p}-o`} className="px-2 py-1.5 text-right text-yellow-400 text-xs">{getPC(month.byProject, p, 'open') || '—'}</td>
                        <td key={`${p}-n`} className="px-2 py-1.5 text-right text-red-400 text-xs">{getPC(month.byProject, p, 'notFound') || '—'}</td>
                      </>
                    ))}
                    <td className="px-3 py-1.5 text-right text-gray-300 text-xs border-l border-gray-700">{month.logged}</td>
                  </tr>
                ))}
              </>
            );
          })}
          <tr className="bg-gray-900 text-white font-semibold border-t-2 border-gray-600">
            <td className="px-3 py-2 sticky left-0 bg-gray-900">Total</td>
            {allProjects.map(p => (
              <>
                <td key={`${p}-a`} className="px-2 py-2 text-right text-green-400 border-l border-gray-700">
                  {years.reduce((s, y) => s + getPC(y.byProject, p, 'activated'), 0) || '—'}
                </td>
                <td key={`${p}-o`} className="px-2 py-2 text-right text-yellow-400">
                  {years.reduce((s, y) => s + getPC(y.byProject, p, 'open'), 0) || '—'}
                </td>
                <td key={`${p}-n`} className="px-2 py-2 text-right text-red-400">
                  {years.reduce((s, y) => s + getPC(y.byProject, p, 'notFound'), 0) || '—'}
                </td>
              </>
            ))}
            <td className="px-3 py-2 text-right border-l border-gray-700">{totals.logged}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

// ─── Main ────────────────────────────────────────────────────────────────────

type SubView = 'summary' | 'by-project';

export default function PreProvisionsReport() {
  const { data, isLoading, error } = usePreProvisionsData();
  const [subView, setSubView] = useState<SubView>('summary');

  if (isLoading) return <div className="flex items-center justify-center h-48 text-gray-400">Loading…</div>;
  if (error || !data) return <div className="flex items-center justify-center h-48 text-red-400">Error loading report</div>;

  const subTabs = (
    <div className="flex gap-2 mb-4">
      {(['summary', 'by-project'] as SubView[]).map(v => (
        <button key={v} onClick={() => setSubView(v)}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${subView === v ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
          {v === 'summary' ? 'Summary' : 'By Project'}
        </button>
      ))}
    </div>
  );

  return (
    <ReportTabLayout
      tableContent={
        <div>
          {subTabs}
          {subView === 'summary'
            ? <PreProvisionsTable years={data.years} allProjects={data.allProjects} totals={data.totals} />
            : <ByProjectTable years={data.years} allProjects={data.allProjects} totals={data.totals} />}
        </div>
      }
      chartsContent={<PreProvisionsChart years={data.years} allProjects={data.allProjects} />}
    />
  );
}
