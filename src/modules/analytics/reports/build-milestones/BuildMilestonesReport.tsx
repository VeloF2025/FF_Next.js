/**
 * Build Milestone Overview — Report 1 (Scope vs Actual) + Report 2 (Timeline)
 * Source: sp_pon_tracker synced from SharePoint PON Tracker(N) tab
 * RFO = ready_for_optical_date | ATP = optical_activated_date
 * 🟢 WORKING
 */
'use client';

import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, LabelList,
} from 'recharts';
import { ReportTabLayout } from '../ReportTabLayout';
import { useBuildMilestonesData } from './useBuildMilestonesData';
import type { BuildMilestoneRow, BuildMilestoneMonth, BuildMilestonesData } from '@/app/api/analytics/reports/build-milestones/route';

// ─── helpers ───────────────────────────────────────────────────────────────

const pctColor = (pct: number) =>
  pct >= 80 ? '#22c55e' : pct >= 50 ? '#eab308' : pct > 0 ? '#ef4444' : '#6b7280';

const ProgressCell = ({ pct }: { pct: number }) => (
  <div className="flex items-center gap-2">
    <div className="w-16 h-3 bg-gray-700 rounded overflow-hidden flex-shrink-0">
      <div style={{ width: `${pct}%`, backgroundColor: pctColor(pct) }} className="h-full" />
    </div>
    <span style={{ color: pctColor(pct) }} className="font-semibold text-sm w-12 text-right">
      {pct.toFixed(1)}%
    </span>
  </div>
);

// ─── Report 1: Scope vs Actual table ───────────────────────────────────────

const ScopeTable = ({ rows, totals }: { rows: BuildMilestoneRow[]; totals: BuildMilestonesData['totals'] }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr style={{ backgroundColor: '#1a3a4a' }} className="text-white">
          <th className="px-3 py-2 text-left font-semibold">Project</th>
          <th className="px-3 py-2 text-right font-semibold">PON Scope</th>
          <th className="px-3 py-2 text-right font-semibold">RFO Done</th>
          <th className="px-3 py-2 text-center font-semibold min-w-[140px]">RFO %</th>
          <th className="px-3 py-2 text-right font-semibold">ATP Done</th>
          <th className="px-3 py-2 text-center font-semibold min-w-[140px]">ATP %</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={row.projectId} className={idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-750'}>
            <td className="px-3 py-2 text-white font-medium">{row.projectName}</td>
            <td className="px-3 py-2 text-right text-gray-300">{row.ponScope.toLocaleString()}</td>
            <td className="px-3 py-2 text-right text-gray-300">{row.rfoDone.toLocaleString()}</td>
            <td className="px-3 py-2"><ProgressCell pct={row.rfoPct} /></td>
            <td className="px-3 py-2 text-right text-gray-300">{row.atpDone.toLocaleString()}</td>
            <td className="px-3 py-2"><ProgressCell pct={row.atpPct} /></td>
          </tr>
        ))}
        <tr className="bg-gray-900 text-white font-semibold border-t-2 border-gray-600">
          <td className="px-3 py-2">Total</td>
          <td className="px-3 py-2 text-right">{totals.ponScope.toLocaleString()}</td>
          <td className="px-3 py-2 text-right">{totals.rfoDone.toLocaleString()}</td>
          <td className="px-3 py-2"><ProgressCell pct={totals.rfoPct} /></td>
          <td className="px-3 py-2 text-right">{totals.atpDone.toLocaleString()}</td>
          <td className="px-3 py-2"><ProgressCell pct={totals.atpPct} /></td>
        </tr>
      </tbody>
    </table>
  </div>
);

// ─── Report 1: Scope vs Actual chart ───────────────────────────────────────

interface ScChartEntry { name: string; 'PON Scope': number; 'RFO Done': number; 'ATP Done': number }

const ScopeChart = ({ rows }: { rows: BuildMilestoneRow[] }) => {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setHidden(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const data: ScChartEntry[] = rows.map(r => ({
    name: r.projectName.length > 14 ? r.projectName.substring(0, 14) : r.projectName,
    'PON Scope': hidden.has('PON Scope') ? 0 : r.ponScope,
    'RFO Done': hidden.has('RFO Done') ? 0 : r.rfoDone,
    'ATP Done': hidden.has('ATP Done') ? 0 : r.atpDone,
  }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis dataKey="name" tick={{ fill: '#d1d5db', fontSize: 11 }} />
        <YAxis tick={{ fill: '#d1d5db', fontSize: 11 }} />
        <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', color: '#fff' }} />
        <Legend onClick={(e) => toggle(e.dataKey as string)} wrapperStyle={{ cursor: 'pointer' }} />
        <Bar dataKey="PON Scope" fill="#6b7280" isAnimationActive={false}>
          <LabelList dataKey="PON Scope" position="top" fill="#9ca3af" fontSize={11} />
        </Bar>
        <Bar dataKey="RFO Done" fill="#3b82f6" isAnimationActive={false}>
          <LabelList dataKey="RFO Done" position="top" fill="#3b82f6" fontSize={11} />
        </Bar>
        <Bar dataKey="ATP Done" fill="#22c55e" isAnimationActive={false}>
          <LabelList dataKey="ATP Done" position="top" fill="#22c55e" fontSize={11} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

// ─── Report 2: Timeline table ───────────────────────────────────────────────

const TimelineTable = ({ timeline }: { timeline: BuildMilestoneMonth[] }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr style={{ backgroundColor: '#1a3a4a' }} className="text-white">
          <th className="px-3 py-2 text-left font-semibold">Month</th>
          <th className="px-3 py-2 text-right font-semibold">RFO Count</th>
          <th className="px-3 py-2 text-right font-semibold">ATP Count</th>
        </tr>
      </thead>
      <tbody>
        {timeline.map((row, idx) => (
          <tr key={row.monthKey} className={idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-750'}>
            <td className="px-3 py-2 text-white font-medium">{row.monthLabel}</td>
            <td className="px-3 py-2 text-right text-blue-300">{row.rfoCount}</td>
            <td className="px-3 py-2 text-right text-green-400">{row.atpCount}</td>
          </tr>
        ))}
        <tr className="bg-gray-900 text-white font-semibold border-t-2 border-gray-600">
          <td className="px-3 py-2">Total</td>
          <td className="px-3 py-2 text-right text-blue-300">
            {timeline.reduce((s, r) => s + r.rfoCount, 0)}
          </td>
          <td className="px-3 py-2 text-right text-green-400">
            {timeline.reduce((s, r) => s + r.atpCount, 0)}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
);

// ─── Report 2: Timeline chart ───────────────────────────────────────────────

const TimelineChart = ({ timeline }: { timeline: BuildMilestoneMonth[] }) => {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setHidden(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const data = timeline.map(r => ({
    name: r.monthLabel,
    'RFO': hidden.has('RFO') ? 0 : r.rfoCount,
    'ATP': hidden.has('ATP') ? 0 : r.atpCount,
  }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis dataKey="name" tick={{ fill: '#d1d5db', fontSize: 11 }} />
        <YAxis tick={{ fill: '#d1d5db', fontSize: 11 }} />
        <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', color: '#fff' }} />
        <Legend onClick={(e) => toggle(e.dataKey as string)} wrapperStyle={{ cursor: 'pointer' }} />
        <Bar dataKey="RFO" fill="#3b82f6" isAnimationActive={false}>
          <LabelList dataKey="RFO" position="top" fill="#3b82f6" fontSize={11} />
        </Bar>
        <Bar dataKey="ATP" fill="#22c55e" isAnimationActive={false}>
          <LabelList dataKey="ATP" position="top" fill="#22c55e" fontSize={11} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

// ─── Sub-report tabs ────────────────────────────────────────────────────────
type SubReport = 'scope' | 'timeline';

// ─── Main component ─────────────────────────────────────────────────────────

export default function BuildMilestonesReport() {
  const { data, isLoading, error } = useBuildMilestonesData();
  const [subReport, setSubReport] = useState<SubReport>('scope');

  if (isLoading) return <div className="flex items-center justify-center h-48 text-gray-400">Loading…</div>;
  if (error || !data) return <div className="flex items-center justify-center h-48 text-red-400">Error loading report</div>;

  const subTabs = (
    <div className="flex gap-2 mb-4">
      {(['scope', 'timeline'] as SubReport[]).map(t => (
        <button
          key={t}
          onClick={() => setSubReport(t)}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${subReport === t ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
        >
          {t === 'scope' ? 'Scope vs Actual' : 'Monthly Timeline'}
        </button>
      ))}
    </div>
  );

  const tableContent = (
    <div>
      {subTabs}
      {subReport === 'scope'
        ? <ScopeTable rows={data.rows} totals={data.totals} />
        : <TimelineTable timeline={data.timeline} />}
    </div>
  );

  const chartsContent = (
    <div>
      {subTabs}
      {subReport === 'scope'
        ? <ScopeChart rows={data.rows} />
        : <TimelineChart timeline={data.timeline} />}
    </div>
  );

  return <ReportTabLayout tableContent={tableContent} chartsContent={chartsContent} />;
}
