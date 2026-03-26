/**
 * Build Milestone Overview — Scope vs Actual + Monthly Timeline per project
 * Source: sp_pon_tracker synced from SharePoint PON Tracker(N) tab
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
import type {
  BuildMilestoneRow,
  BuildMilestoneMonth,
  BuildMilestonesData,
} from '@/app/api/analytics/reports/build-milestones/route';

// ─── Palette ────────────────────────────────────────────────────────────────
const PALETTE = ['#3b82f6','#f97316','#22c55e','#a855f7','#eab308','#06b6d4','#ec4899','#84cc16'];
const pctColor = (p: number) => p >= 80 ? '#22c55e' : p >= 50 ? '#eab308' : p > 0 ? '#ef4444' : '#6b7280';

const ProgressCell = ({ pct }: { pct: number }) => (
  <div className="flex items-center gap-2">
    <div className="w-14 h-3 bg-gray-700 rounded overflow-hidden flex-shrink-0">
      <div style={{ width: `${pct}%`, backgroundColor: pctColor(pct) }} className="h-full" />
    </div>
    <span style={{ color: pctColor(pct) }} className="font-semibold text-sm w-12 text-right">
      {pct.toFixed(1)}%
    </span>
  </div>
);

// ─── Report 1: Scope vs Actual ───────────────────────────────────────────────

const ScopeTable = ({ rows, totals }: { rows: BuildMilestoneRow[]; totals: BuildMilestonesData['totals'] }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr style={{ backgroundColor: '#1a3a4a' }} className="text-white">
          <th className="px-3 py-2 text-left font-semibold">Project</th>
          <th className="px-3 py-2 text-right font-semibold">PON Scope</th>
          <th className="px-3 py-2 text-right font-semibold">RFO Done</th>
          <th className="px-3 py-2 text-center font-semibold" style={{ minWidth: 150 }}>RFO %</th>
          <th className="px-3 py-2 text-right font-semibold">ATP Done</th>
          <th className="px-3 py-2 text-center font-semibold" style={{ minWidth: 150 }}>ATP %</th>
          <th className="px-3 py-2 text-right font-semibold text-orange-400" title="RFO Done minus ATP Done — PONs awaiting ATP">Lag (RFO−ATP)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          const lag = row.rfoDone - row.atpDone;
          return (
            <tr key={row.projectId} className={idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-750'}>
              <td className="px-3 py-2 text-white font-medium">{row.projectName}</td>
              <td className="px-3 py-2 text-right text-gray-300">{row.ponScope.toLocaleString()}</td>
              <td className="px-3 py-2 text-right text-gray-300">{row.rfoDone.toLocaleString()}</td>
              <td className="px-3 py-2"><ProgressCell pct={row.rfoPct} /></td>
              <td className="px-3 py-2 text-right text-gray-300">{row.atpDone.toLocaleString()}</td>
              <td className="px-3 py-2"><ProgressCell pct={row.atpPct} /></td>
              <td className="px-3 py-2 text-right font-semibold" style={{ color: lag > 0 ? '#f97316' : '#6b7280' }}>{lag}</td>
            </tr>
          );
        })}
        <tr className="bg-gray-900 text-white font-semibold border-t-2 border-gray-600">
          <td className="px-3 py-2">Total</td>
          <td className="px-3 py-2 text-right">{totals.ponScope.toLocaleString()}</td>
          <td className="px-3 py-2 text-right">{totals.rfoDone.toLocaleString()}</td>
          <td className="px-3 py-2"><ProgressCell pct={totals.rfoPct} /></td>
          <td className="px-3 py-2 text-right">{totals.atpDone.toLocaleString()}</td>
          <td className="px-3 py-2"><ProgressCell pct={totals.atpPct} /></td>
          <td className="px-3 py-2 text-right font-semibold text-orange-400">{totals.rfoDone - totals.atpDone}</td>
        </tr>
      </tbody>
    </table>
  </div>
);

const ScopeChart = ({ rows }: { rows: BuildMilestoneRow[] }) => {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setHidden(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const data = rows.map(r => ({
    name: r.projectName.length > 12 ? r.projectName.substring(0, 12) : r.projectName,
    'PON Scope': hidden.has('PON Scope') ? 0 : r.ponScope,
    'RFO Done': hidden.has('RFO Done') ? 0 : r.rfoDone,
    'ATP Done': hidden.has('ATP Done') ? 0 : r.atpDone,
    'Lag (RFO−ATP)': hidden.has('Lag (RFO−ATP)') ? 0 : r.rfoDone - r.atpDone,
  }));
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis dataKey="name" tick={{ fill: '#d1d5db', fontSize: 11 }} />
        <YAxis tick={{ fill: '#d1d5db', fontSize: 11 }} />
        <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', color: '#fff' }} />
        <Legend onClick={e => toggle(e.dataKey as string)} wrapperStyle={{ cursor: 'pointer' }} />
        <Bar dataKey="PON Scope" fill="#6b7280" isAnimationActive={false}>
          <LabelList dataKey="PON Scope" position="top" fill="#9ca3af" fontSize={11} />
        </Bar>
        <Bar dataKey="RFO Done" fill="#3b82f6" isAnimationActive={false}>
          <LabelList dataKey="RFO Done" position="top" fill="#3b82f6" fontSize={11} />
        </Bar>
        <Bar dataKey="ATP Done" fill="#22c55e" isAnimationActive={false}>
          <LabelList dataKey="ATP Done" position="top" fill="#22c55e" fontSize={11} />
        </Bar>
        <Bar dataKey="Lag (RFO−ATP)" fill="#f97316" isAnimationActive={false}>
          <LabelList dataKey="Lag (RFO−ATP)" position="top" fill="#f97316" fontSize={11} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

// ─── Report 2: Timeline — per project columns ────────────────────────────────

const TimelineTable = ({ timeline, projectNames }: { timeline: BuildMilestoneMonth[]; projectNames: string[] }) => {
  const getCount = (month: BuildMilestoneMonth, project: string, type: 'rfo' | 'atp') => {
    const p = month.byProject.find(b => b.projectName === project);
    return type === 'rfo' ? (p?.rfoCount ?? 0) : (p?.atpCount ?? 0);
  };

  // Totals per project
  const projectRfoTotals = Object.fromEntries(projectNames.map(n => [n, timeline.reduce((s, m) => s + getCount(m, n, 'rfo'), 0)]));
  const projectAtpTotals = Object.fromEntries(projectNames.map(n => [n, timeline.reduce((s, m) => s + getCount(m, n, 'atp'), 0)]));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: projectNames.length * 180 + 200 }}>
        <thead>
          <tr style={{ backgroundColor: '#1a3a4a' }} className="text-white">
            <th className="px-3 py-2 text-left font-semibold sticky left-0 bg-gray-900" style={{ minWidth: 90 }}>Month</th>
            {projectNames.map(name => (
              <th key={name} className="px-2 py-2 text-center font-semibold" colSpan={2} style={{ minWidth: 140 }}>
                {name}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-semibold" colSpan={2} style={{ minWidth: 120 }}>Total</th>
          </tr>
          <tr style={{ backgroundColor: '#0f2a38' }} className="text-xs text-gray-400">
            <th className="px-3 py-1 sticky left-0 bg-gray-900" />
            {projectNames.map(name => (
              <>
                <th key={`${name}-rfo`} className="px-2 py-1 text-blue-400 text-right">RFO</th>
                <th key={`${name}-atp`} className="px-2 py-1 text-green-400 text-right">ATP</th>
              </>
            ))}
            <th className="px-2 py-1 text-blue-400 text-right">RFO</th>
            <th className="px-2 py-1 text-green-400 text-right">ATP</th>
          </tr>
        </thead>
        <tbody>
          {timeline.map((row, idx) => (
            <tr key={row.monthKey} className={idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-750'}>
              <td className="px-3 py-2 text-white font-medium sticky left-0 bg-inherit">{row.monthLabel}</td>
              {projectNames.map(name => (
                <>
                  <td key={`${name}-rfo`} className="px-2 py-2 text-right text-blue-300">
                    {getCount(row, name, 'rfo') || '—'}
                  </td>
                  <td key={`${name}-atp`} className="px-2 py-2 text-right text-green-400">
                    {getCount(row, name, 'atp') || '—'}
                  </td>
                </>
              ))}
              <td className="px-2 py-2 text-right text-blue-300 font-semibold">{row.rfoTotal}</td>
              <td className="px-2 py-2 text-right text-green-400 font-semibold">{row.atpTotal}</td>
            </tr>
          ))}
          <tr className="bg-gray-900 text-white font-semibold border-t-2 border-gray-600">
            <td className="px-3 py-2 sticky left-0 bg-gray-900">Total</td>
            {projectNames.map(name => (
              <>
                <td key={`${name}-rfo-tot`} className="px-2 py-2 text-right text-blue-300">{projectRfoTotals[name] || '—'}</td>
                <td key={`${name}-atp-tot`} className="px-2 py-2 text-right text-green-400">{projectAtpTotals[name] || '—'}</td>
              </>
            ))}
            <td className="px-2 py-2 text-right text-blue-300">{timeline.reduce((s, m) => s + m.rfoTotal, 0)}</td>
            <td className="px-2 py-2 text-right text-green-400">{timeline.reduce((s, m) => s + m.atpTotal, 0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

const TimelineChart = ({ timeline, projectNames }: { timeline: BuildMilestoneMonth[]; projectNames: string[] }) => {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setHidden(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // Build chart data: one entry per month, one key per project-type combo
  const data = timeline.map(m => {
    const entry: Record<string, string | number> = { name: m.monthLabel };
    projectNames.forEach(proj => {
      const p = m.byProject.find(b => b.projectName === proj);
      entry[`${proj} RFO`] = hidden.has(`${proj} RFO`) ? 0 : (p?.rfoCount ?? 0);
      entry[`${proj} ATP`] = hidden.has(`${proj} ATP`) ? 0 : (p?.atpCount ?? 0);
    });
    return entry;
  });

  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis dataKey="name" tick={{ fill: '#d1d5db', fontSize: 11 }} />
        <YAxis tick={{ fill: '#d1d5db', fontSize: 11 }} />
        <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', color: '#fff' }} />
        <Legend onClick={e => toggle(e.dataKey as string)} wrapperStyle={{ cursor: 'pointer', fontSize: 11 }} />
        {projectNames.map((proj, i) => (
          <>
            <Bar key={`${proj}-rfo`} dataKey={`${proj} RFO`} fill={PALETTE[i % PALETTE.length]} isAnimationActive={false} opacity={0.9} />
            <Bar key={`${proj}-atp`} dataKey={`${proj} ATP`} fill={PALETTE[i % PALETTE.length]} isAnimationActive={false} opacity={0.5} />
          </>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
};

// ─── Main ────────────────────────────────────────────────────────────────────

type SubReport = 'scope' | 'timeline';

export default function BuildMilestonesReport() {
  const { data, isLoading, error } = useBuildMilestonesData();
  const [subReport, setSubReport] = useState<SubReport>('scope');

  if (isLoading) return <div className="flex items-center justify-center h-48 text-gray-400">Loading…</div>;
  if (error || !data) return <div className="flex items-center justify-center h-48 text-red-400">Error loading report</div>;

  const subTabs = (
    <div className="flex gap-2 mb-4">
      {(['scope', 'timeline'] as SubReport[]).map(t => (
        <button key={t} onClick={() => setSubReport(t)}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${subReport === t ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
          {t === 'scope' ? 'Scope vs Actual' : 'Monthly Timeline'}
        </button>
      ))}
    </div>
  );

  return (
    <ReportTabLayout
      tableContent={
        <div>
          {subTabs}
          {subReport === 'scope'
            ? <ScopeTable rows={data.rows} totals={data.totals} />
            : <TimelineTable timeline={data.timeline} projectNames={data.projectNames} />}
        </div>
      }
      chartsContent={
        <div>
          {subTabs}
          {subReport === 'scope'
            ? <ScopeChart rows={data.rows} />
            : <TimelineChart timeline={data.timeline} projectNames={data.projectNames} />}
        </div>
      }
    />
  );
}
