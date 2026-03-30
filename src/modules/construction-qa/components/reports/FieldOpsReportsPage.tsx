/**
 * FieldOpsReportsPage — Poles Planted dashboard with date filtering,
 * summary cards, bar chart, and project/zone-PON tables.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3, Calendar, CheckCircle2, Clock, Camera, XCircle, Download, Filter,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from '@/components/ui/DynamicChart';
import { StandardSummaryCards, type SummaryCardData } from '@/components/ui/StandardSummaryCards';
import { log } from '@/lib/logger';

type Period = 'today' | 'yesterday' | '7d' | '30d' | 'all' | 'custom';

interface Summary {
  planted: number;
  approved: number;
  pending: number;
  rejected: number;
  rework: number;
  photos: number;
}

interface ProjectRow {
  project_id: string;
  project_name: string;
  planted: number;
  approved: number;
  pending: number;
  rejected: number;
  rework: number;
  photos: number;
}

interface ZonePonRow {
  project_id: string;
  project_name: string;
  zone_no: number | null;
  pon_no: number | null;
  planted: number;
  approved: number;
  pending: number;
  rejected: number;
}

const PERIOD_OPTIONS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: 'all', label: 'All Time' },
];

const BAR_COLORS = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#ec4899'];

export function FieldOpsReportsPage() {
  const [period, setPeriod] = useState<Period>('7d');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<{ project_id: string; project_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary>({ planted: 0, approved: 0, pending: 0, rejected: 0, rework: 0, photos: 0 });
  const [byProject, setByProject] = useState<ProjectRow[]>([]);
  const [byZonePon, setByZonePon] = useState<ZonePonRow[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (period === 'custom' && dateFrom) {
        params.set('dateFrom', dateFrom);
        if (dateTo) params.set('dateTo', dateTo);
      } else {
        params.set('period', period);
      }
      if (projectId) params.set('projectId', projectId);

      const resp = await fetch(`/api/construction-qa/reports?${params}`, { credentials: 'include' });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const json = await resp.json();
      const d = json.data;
      setSummary(d.summary);
      setByProject(d.byProject);
      setByZonePon(d.byZonePon);
      if (d.projects) setProjects(d.projects);
    } catch (err) {
      log.error('Failed to load reports', { error: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [period, dateFrom, dateTo, projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleExport = () => {
    const params = new URLSearchParams();
    if (period === 'custom' && dateFrom) {
      params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
    }
    window.open(`/api/construction-qa/export?${params}`, '_blank');
  };

  const summaryCards: SummaryCardData[] = [
    { label: 'Poles Planted', value: summary.planted, icon: BarChart3, iconColor: 'text-blue-400', iconBgColor: 'bg-blue-500/20' },
    { label: 'Approved', value: summary.approved, icon: CheckCircle2, iconColor: 'text-green-400', iconBgColor: 'bg-green-500/20' },
    { label: 'Pending', value: summary.pending, icon: Clock, iconColor: 'text-yellow-400', iconBgColor: 'bg-yellow-500/20' },
    { label: 'Rejected', value: summary.rejected, icon: XCircle, iconColor: 'text-red-400', iconBgColor: 'bg-red-500/20' },
    { label: 'Photos', value: summary.photos, icon: Camera, iconColor: 'text-purple-400', iconBgColor: 'bg-purple-500/20' },
  ];

  // Group zone/pon rows by project
  const zonePonByProject = byZonePon.reduce<Record<string, { name: string; rows: ZonePonRow[] }>>((acc, row) => {
    if (!acc[row.project_id]) acc[row.project_id] = { name: row.project_name, rows: [] };
    acc[row.project_id].rows.push(row);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Poles Planted Report</h2>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-3 py-1.5 text-sm rounded border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] hover:border-[var(--ff-accent)] transition-colors"
        >
          <Download className="w-4 h-4" />
          Export
        </button>
      </div>

      {/* Period filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-[var(--ff-text-secondary)] mr-1">
          <Calendar className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
          Period:
        </span>
        {PERIOD_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setPeriod(key); setDateFrom(''); setDateTo(''); }}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              period === key
                ? 'bg-[var(--ff-accent)] text-white border-[var(--ff-accent)]'
                : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:border-[var(--ff-accent)]'
            }`}
          >
            {label}
          </button>
        ))}
        <div className="flex items-center gap-1 ml-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); if (e.target.value) setPeriod('custom'); }}
            className="px-2 py-1 text-xs rounded border bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border-[var(--ff-border-light)] focus:border-[var(--ff-accent)] outline-none"
            title="From date"
          />
          <span className="text-xs text-[var(--ff-text-tertiary)]">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); if (dateFrom) setPeriod('custom'); }}
            className="px-2 py-1 text-xs rounded border bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border-[var(--ff-border-light)] focus:border-[var(--ff-accent)] outline-none"
            title="To date"
          />
        </div>

        {/* Project filter */}
        {projects.length > 1 && (
          <div className="flex items-center gap-2 ml-4">
            <Filter className="w-3.5 h-3.5 text-[var(--ff-text-secondary)]" />
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="px-2 py-1 text-xs rounded border bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border-[var(--ff-border-light)] focus:border-[var(--ff-accent)] outline-none"
            >
              <option value="">All Projects</option>
              {projects.map((p) => (
                <option key={p.project_id} value={p.project_id}>{p.project_name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Summary cards */}
      {loading ? (
        <div className="text-center py-8 text-[var(--ff-text-secondary)]">Loading...</div>
      ) : (
        <>
          <StandardSummaryCards cards={summaryCards} columns={5} />

          {/* Bar chart — planted per project */}
          {byProject.length > 0 && (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
              <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3">Poles Planted by Project</h3>
              <ResponsiveContainer width="100%" height={Math.max(200, byProject.length * 44)}>
                <BarChart data={byProject} layout="vertical" margin={{ left: 10, right: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis type="number" tick={{ fill: 'var(--ff-text-secondary)', fontSize: 11 }} />
                  <YAxis
                    dataKey="project_name"
                    type="category"
                    width={120}
                    tick={{ fill: 'var(--ff-text-secondary)', fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#f1f5f9' }}
                  />
                  <Bar dataKey="planted" name="Planted" radius={[0, 4, 4, 0]}>
                    {byProject.map((_, i) => (
                      <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Project table */}
          {byProject.length > 0 && (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--ff-border-light)]">
                    <th className="text-left px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Project</th>
                    <th className="text-right px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Planted</th>
                    <th className="text-right px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Approved</th>
                    <th className="text-right px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Pending</th>
                    <th className="text-right px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Rejected</th>
                    <th className="text-right px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Rework</th>
                    <th className="text-right px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Photos</th>
                  </tr>
                </thead>
                <tbody>
                  {byProject.map((row) => (
                    <tr key={row.project_id} className="border-b border-[var(--ff-border-light)] last:border-b-0 hover:bg-[var(--ff-bg-hover)]">
                      <td className="px-4 py-2.5 text-[var(--ff-text-primary)]">{row.project_name}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-blue-400">{row.planted}</td>
                      <td className="px-4 py-2.5 text-right text-green-400">{row.approved}</td>
                      <td className="px-4 py-2.5 text-right text-yellow-400">{row.pending}</td>
                      <td className="px-4 py-2.5 text-right text-red-400">{row.rejected}</td>
                      <td className="px-4 py-2.5 text-right text-orange-400">{row.rework}</td>
                      <td className="px-4 py-2.5 text-right text-purple-400">{row.photos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Zone/PON table */}
          {Object.keys(zonePonByProject).length > 0 && (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-x-auto">
              <h3 className="text-sm font-medium text-[var(--ff-text-primary)] px-4 py-3 border-b border-[var(--ff-border-light)]">
                Zone / PON Breakdown
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--ff-border-light)]">
                    <th className="text-left px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Project</th>
                    <th className="text-right px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Zone</th>
                    <th className="text-right px-4 py-3 text-[var(--ff-text-secondary)] font-medium">PON</th>
                    <th className="text-right px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Planted</th>
                    <th className="text-right px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Approved</th>
                    <th className="text-right px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Pending</th>
                    <th className="text-right px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(zonePonByProject).map(([pid, { name, rows }]) =>
                    rows.map((row, i) => (
                      <tr key={`${pid}-${row.zone_no}-${row.pon_no}`} className="border-b border-[var(--ff-border-light)] last:border-b-0 hover:bg-[var(--ff-bg-hover)]">
                        <td className="px-4 py-2.5 text-[var(--ff-text-primary)]">
                          {i === 0 ? name : ''}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--ff-text-secondary)]">{row.zone_no ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right text-[var(--ff-text-secondary)]">{row.pon_no ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-blue-400">{row.planted}</td>
                        <td className="px-4 py-2.5 text-right text-green-400">{row.approved}</td>
                        <td className="px-4 py-2.5 text-right text-yellow-400">{row.pending}</td>
                        <td className="px-4 py-2.5 text-right text-red-400">{row.rejected}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Empty state */}
          {byProject.length === 0 && !loading && (
            <div className="text-center py-12 text-[var(--ff-text-secondary)]">
              <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>No poles planted data for this period.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
