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
} from '@/components/ui/DynamicChart';
import { ReportTabLayout } from '../ReportTabLayout';
import { useBuildMilestonesData } from './useBuildMilestonesData';
import type {
  BuildMilestoneRow,
  BuildMilestoneMonth,
  BuildMilestonesData,
} from '@/app/api/analytics/reports/build-milestones/route';

// ─── Palette ─────────────────────────────────────────────────────────────────
// Hex values required for Recharts SVG elements (cannot read CSS vars at paint time).
// Each hex is annotated with its semantic --ff-* token equivalent.
const PALETTE = [
  '#3b82f6', // --ff-primary / blue
  '#f97316', // --ff-warning / orange
  '#22c55e', // --ff-success / green
  '#a855f7', // --ff-accent / purple
  '#eab308', // --ff-warning-alt / yellow
  '#06b6d4', // --ff-info / cyan
  '#ec4899', // --ff-accent-alt / pink
  '#84cc16', // --ff-success-alt / lime
];

// Semantic progress colours (hex for SVG inline styles)
const PCT_HIGH   = '#22c55e'; // --ff-success
const PCT_MED    = '#eab308'; // --ff-warning
const PCT_LOW    = '#ef4444'; // --ff-danger
const PCT_NONE   = '#6b7280'; // --ff-text-tertiary

const pctColor = (p: number) => p >= 80 ? PCT_HIGH : p >= 50 ? PCT_MED : p > 0 ? PCT_LOW : PCT_NONE;

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

const ScopeTable = ({ rows, totals, syncedAt }: { rows: BuildMilestoneRow[]; totals: BuildMilestonesData['totals']; syncedAt?: string }) => {
  const syncTime = syncedAt ? new Date(syncedAt).toLocaleString('en-ZA', { 
    dateStyle: 'short', 
    timeStyle: 'short', 
    timeZone: 'Africa/Johannesburg' 
  }) : 'Unknown';

  return (
    <div>
      <div className="mb-3 text-xs text-[var(--ff-text-tertiary)]">
        Last synced: <span className="font-medium text-[var(--ff-text-secondary)]">{syncTime} SAST</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" role="table" aria-label="Build milestones scope vs actual">
          <thead>
            <tr className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] text-[var(--ff-text-primary)]">
              <th scope="col" className="px-4 py-3 text-left font-semibold border-r border-[#e5e7eb]">Project</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold border-r border-[#e5e7eb]">PON Scope</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold border-r border-[#e5e7eb]">RFO Done</th>
              <th scope="col" className="px-4 py-3 text-center font-semibold border-r border-[#e5e7eb]" style={{ minWidth: 150 }}>RFO %</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold border-r border-[#e5e7eb]">ATP Done</th>
              <th scope="col" className="px-4 py-3 text-center font-semibold border-r border-[#e5e7eb]" style={{ minWidth: 150 }}>ATP %</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold text-[var(--ff-warning)]" title="RFO Done minus ATP Done — PONs awaiting ATP">Lag (RFO−ATP)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const lag = row.rfoDone - row.atpDone;
              return (
                <tr key={row.projectId} className={idx % 2 === 0 ? 'bg-[var(--ff-bg-primary)]' : 'bg-[var(--ff-bg-secondary)]'}>
                  <td className="px-4 py-3 text-[var(--ff-text-primary)] font-medium border-r border-[#e5e7eb]">{row.projectName}</td>
                  <td className="px-4 py-3 text-right text-[var(--ff-text-secondary)] border-r border-[#e5e7eb]">{row.ponScope.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-[var(--ff-text-secondary)] border-r border-[#e5e7eb]">{row.rfoDone.toLocaleString()}</td>
                  <td className="px-4 py-3 border-r border-[#e5e7eb]"><ProgressCell pct={row.rfoPct} /></td>
                  <td className="px-4 py-3 text-right text-[var(--ff-text-secondary)] border-r border-[#e5e7eb]">{row.atpDone.toLocaleString()}</td>
                  <td className="px-4 py-3 border-r border-[#e5e7eb]"><ProgressCell pct={row.atpPct} /></td>
                  <td className="px-4 py-3 text-right font-semibold" style={{ color: lag > 0 ? PCT_MED : PCT_NONE }}>{lag}</td>
                </tr>
              );
            })}
            <tr className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] font-semibold border-t-2 border-[var(--ff-border-light)]">
              <td className="px-4 py-3 border-r border-[#e5e7eb]">Total</td>
              <td className="px-4 py-3 text-right border-r border-[#e5e7eb]">{totals.ponScope.toLocaleString()}</td>
              <td className="px-4 py-3 text-right border-r border-[#e5e7eb]">{totals.rfoDone.toLocaleString()}</td>
              <td className="px-4 py-3 border-r border-[#e5e7eb]"><ProgressCell pct={totals.rfoPct} /></td>
              <td className="px-4 py-3 text-right border-r border-[#e5e7eb]">{totals.atpDone.toLocaleString()}</td>
              <td className="px-4 py-3 border-r border-[#e5e7eb]"><ProgressCell pct={totals.atpPct} /></td>
              <td className="px-4 py-3 text-right font-semibold text-[var(--ff-warning)]">{totals.rfoDone - totals.atpDone}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Recharts chart tokens (hex required for SVG — annotated with semantic equivalents)
const CHART_GRID   = '#374151'; // --ff-border-light
const CHART_TICK   = '#d1d5db'; // --ff-text-secondary
const CHART_TOOLTIP_BG     = '#1f2937'; // --ff-bg-secondary
const CHART_TOOLTIP_BORDER = '#374151'; // --ff-border-light
const CHART_SCOPE  = '#6b7280'; // --ff-text-tertiary
const CHART_SCOPE_LABEL = '#9ca3af'; // --ff-text-tertiary light
const CHART_RFO    = '#3b82f6'; // --ff-primary
const CHART_ATP    = '#22c55e'; // --ff-success
const CHART_LAG    = '#f97316'; // --ff-warning

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
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
        <XAxis dataKey="name" tick={{ fill: CHART_TICK, fontSize: 11 }} />
        <YAxis tick={{ fill: CHART_TICK, fontSize: 11 }} />
        <Tooltip contentStyle={{ backgroundColor: CHART_TOOLTIP_BG, border: `1px solid ${CHART_TOOLTIP_BORDER}`, color: '#fff' }} />
        <Legend onClick={e => toggle(e.dataKey as string)} wrapperStyle={{ cursor: 'pointer' }} />
        <Bar dataKey="PON Scope" fill={CHART_SCOPE} isAnimationActive={false}>
          <LabelList dataKey="PON Scope" position="top" fill={CHART_SCOPE_LABEL} fontSize={11} />
        </Bar>
        <Bar dataKey="RFO Done" fill={CHART_RFO} isAnimationActive={false}>
          <LabelList dataKey="RFO Done" position="top" fill={CHART_RFO} fontSize={11} />
        </Bar>
        <Bar dataKey="ATP Done" fill={CHART_ATP} isAnimationActive={false}>
          <LabelList dataKey="ATP Done" position="top" fill={CHART_ATP} fontSize={11} />
        </Bar>
        <Bar dataKey="Lag (RFO−ATP)" fill={CHART_LAG} isAnimationActive={false}>
          <LabelList dataKey="Lag (RFO−ATP)" position="top" fill={CHART_LAG} fontSize={11} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

// ─── Report 2: Timeline — per project columns ────────────────────────────────

const TimelineTable = ({ timeline, projectNames }: { timeline: BuildMilestoneMonth[]; projectNames: string[] }) => {
  const getCount = (month: BuildMilestoneMonth, project: string, type: 'rfo' | 'atp') => {
    const p = month.byProject.find((b: typeof month.byProject[0]) => b.projectName === project);
    return type === 'rfo' ? (p?.rfoCount ?? 0) : (p?.atpCount ?? 0);
  };

  const projectRfoTotals = Object.fromEntries(projectNames.map(n => [n, timeline.reduce((s, m) => s + getCount(m, n, 'rfo'), 0)]));
  const projectAtpTotals = Object.fromEntries(projectNames.map(n => [n, timeline.reduce((s, m) => s + getCount(m, n, 'atp'), 0)]));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: projectNames.length * 180 + 200 }} role="table" aria-label="Build milestones monthly timeline">
        <thead>
          <tr className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] text-[var(--ff-text-primary)]">
            <th scope="col" className="px-3 py-2 text-left font-semibold sticky left-0 bg-[var(--ff-bg-secondary)]" style={{ minWidth: 90 }}>Month</th>
            {projectNames.map(name => (
              <th key={name} scope="col" className="px-2 py-2 text-center font-semibold" colSpan={2} style={{ minWidth: 140 }}>
                {name}
              </th>
            ))}
            <th scope="col" className="px-3 py-2 text-right font-semibold" colSpan={2} style={{ minWidth: 120 }}>Total</th>
          </tr>
          <tr className="bg-[var(--ff-bg-tertiary)] text-xs text-[var(--ff-text-tertiary)]">
            <th className="px-3 py-1 sticky left-0 bg-[var(--ff-bg-tertiary)]" />
            {projectNames.map(name => (
              <>
                <th key={`${name}-rfo`} className="px-2 py-1 text-[var(--ff-primary)] text-right">RFO</th>
                <th key={`${name}-atp`} className="px-2 py-1 text-[var(--ff-success)] text-right">ATP</th>
              </>
            ))}
            <th className="px-2 py-1 text-[var(--ff-primary)] text-right">RFO</th>
            <th className="px-2 py-1 text-[var(--ff-success)] text-right">ATP</th>
          </tr>
        </thead>
        <tbody>
          {timeline.map((row, idx) => (
            <tr key={row.monthKey} className={idx % 2 === 0 ? 'bg-[var(--ff-bg-primary)]' : 'bg-[var(--ff-bg-secondary)]'}>
              <td className="px-3 py-2 text-[var(--ff-text-primary)] font-medium sticky left-0 bg-inherit">{row.monthLabel}</td>
              {projectNames.map(name => (
                <>
                  <td key={`${name}-rfo`} className="px-2 py-2 text-right text-[var(--ff-primary)]">
                    {getCount(row, name, 'rfo') || '—'}
                  </td>
                  <td key={`${name}-atp`} className="px-2 py-2 text-right text-[var(--ff-success)]">
                    {getCount(row, name, 'atp') || '—'}
                  </td>
                </>
              ))}
              <td className="px-2 py-2 text-right text-[var(--ff-primary)] font-semibold">{row.rfoTotal}</td>
              <td className="px-2 py-2 text-right text-[var(--ff-success)] font-semibold">{row.atpTotal}</td>
            </tr>
          ))}
          <tr className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] font-semibold border-t-2 border-[var(--ff-border-light)]">
            <td className="px-3 py-2 sticky left-0 bg-[var(--ff-bg-tertiary)]">Total</td>
            {projectNames.map(name => (
              <>
                <td key={`${name}-rfo-tot`} className="px-2 py-2 text-right text-[var(--ff-primary)]">{projectRfoTotals[name] || '—'}</td>
                <td key={`${name}-atp-tot`} className="px-2 py-2 text-right text-[var(--ff-success)]">{projectAtpTotals[name] || '—'}</td>
              </>
            ))}
            <td className="px-2 py-2 text-right text-[var(--ff-primary)]">{timeline.reduce((s, m) => s + m.rfoTotal, 0)}</td>
            <td className="px-2 py-2 text-right text-[var(--ff-success)]">{timeline.reduce((s, m) => s + m.atpTotal, 0)}</td>
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
      const p = m.byProject.find((b: typeof m.byProject[0]) => b.projectName === proj);
      entry[`${proj} RFO`] = hidden.has(`${proj} RFO`) ? 0 : (p?.rfoCount ?? 0);
      entry[`${proj} ATP`] = hidden.has(`${proj} ATP`) ? 0 : (p?.atpCount ?? 0);
    });
    return entry;
  });

  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
        <XAxis dataKey="name" tick={{ fill: CHART_TICK, fontSize: 11 }} />
        <YAxis tick={{ fill: CHART_TICK, fontSize: 11 }} />
        <Tooltip contentStyle={{ backgroundColor: CHART_TOOLTIP_BG, border: `1px solid ${CHART_TOOLTIP_BORDER}`, color: '#fff' }} />
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

  if (isLoading) return <div className="flex items-center justify-center h-48 text-[var(--ff-text-tertiary)]" role="status" aria-label="Loading report">Loading…</div>;
  if (error || !data) return <div className="flex items-center justify-center h-48 text-[var(--ff-danger)]" role="alert">Error loading report</div>;

  const subTabs = (
    <div className="flex gap-2 mb-4" role="tablist" aria-label="Build milestones sub-reports">
      {(['scope', 'timeline'] as SubReport[]).map(t => (
        <button
          key={t}
          role="tab"
          aria-selected={subReport === t}
          onClick={() => setSubReport(t)}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)] focus:ring-offset-1 ${
            subReport === t
              ? 'bg-[var(--ff-primary)] text-white'
              : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
          }`}
        >
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
            ? <ScopeTable rows={data.rows} totals={data.totals} syncedAt={data.syncedAt} />
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
