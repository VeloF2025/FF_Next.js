'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, GitBranch, RefreshCw } from 'lucide-react';
import { log } from '@/lib/logger';
import type { FnoKey, ScopeActualResponse } from '../../services/fnoReportTypes';
import { buildClientFallbackReport } from './fnoQfieldClientFallback';

const FNO_OPTIONS: { key: FnoKey; label: string }[] = [
  { key: 'herotel', label: 'Herotel' },
  { key: 'fibertime', label: 'Fibertime' },
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 }).format(value);
}

function formatKm(meters: number): string {
  return `${new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 1 }).format(meters / 1000)} km`;
}

function percent(actual: number, scope: number): string {
  if (scope <= 0) return '0%';
  return `${Math.round((actual / scope) * 100)}%`;
}

function statusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

export function FnoQfieldReportsPage() {
  const [fno, setFno] = useState<FnoKey>('herotel');
  const [projectId, setProjectId] = useState('');
  const [data, setData] = useState<ScopeActualResponse | null>(() => buildClientFallbackReport());
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ fno });
      if (projectId) params.set('projectId', projectId);
      const response = await fetch(`/api/construction-qa/fno-reports?${params}`, { credentials: 'include' });
      if (!response.ok) throw new Error(`API ${response.status}`);
      const json = await response.json();
      if (!json?.data?.summary || !Array.isArray(json.data.hierarchy)) throw new Error('Invalid report payload');
      setData(json.data);
    } catch (error) {
      setData(fno === 'herotel' ? buildClientFallbackReport(projectId) : null);
      log.error('Failed to load FNO QField report', { error: (error as Error).message }, 'FnoQfieldReportsPage');
    } finally {
      setLoading(false);
    }
  }, [fno, projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const groupedRows = useMemo(() => {
    const groups: Record<string, NonNullable<ScopeActualResponse['hierarchy']>> = {};
    for (const row of data?.hierarchy ?? []) {
      groups[row.projectName] = groups[row.projectName] ?? [];
      groups[row.projectName]!.push(row);
    }
    return groups;
  }, [data]);

  const summary = data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">FNO QField Scope vs Actual</h2>
          <p className="mt-1 text-sm text-[var(--ff-text-secondary)]">
            QField-first reporting with coalesced aliases while planners standardise layer and attribute naming.
          </p>
        </div>
        <button
          type="button"
          aria-label="Refresh FNO QField report"
          onClick={fetchData}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--ff-border)] bg-[var(--ff-surface)] px-3 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-surface-alt)]"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="rounded-lg border border-[var(--ff-border)] bg-[var(--ff-surface)] p-4">
        <div className="flex flex-wrap gap-3">
          {FNO_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={fno === option.key}
              onClick={() => { setFno(option.key); setProjectId(''); }}
              className={`rounded-md border px-4 py-2 text-sm ${
                fno === option.key
                  ? 'border-[var(--ff-primary)] bg-[var(--ff-primary)] text-white'
                  : 'border-[var(--ff-border)] bg-[var(--ff-surface-alt)] text-[var(--ff-text-secondary)]'
              }`}
            >
              {option.label}
            </button>
          ))}
          <select
            aria-label="Filter by project"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="rounded-md border border-[var(--ff-border)] bg-[var(--ff-surface-alt)] px-3 py-2 text-sm text-[var(--ff-text-primary)]"
          >
            <option value="">All projects</option>
            {(data?.projects ?? []).map((project) => (
              <option key={project.projectId} value={project.projectId}>{project.projectName}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <div className="py-10 text-center text-[var(--ff-text-secondary)]">Loading QField report...</div>}

      {!loading && summary && (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Pole Actual / Scope" value={`${formatNumber(summary.poleActual)} / ${formatNumber(summary.poleScope)}`} sub={percent(summary.poleActual, summary.poleScope)} />
            <MetricCard label="Cable Actual / Scope" value={`${formatKm(summary.cableActualMeters)} / ${formatKm(summary.cableScopeMeters)}`} sub={percent(summary.cableActualMeters, summary.cableScopeMeters)} />
            <MetricCard label="CWC Complete / Pending" value={`${formatNumber(summary.cwcComplete)} / ${formatNumber(summary.cwcPending)}`} sub="QField PON status" />
            <MetricCard label="ATP Complete / Pending" value={`${formatNumber(summary.atpComplete)} / ${formatNumber(summary.atpPending)}`} sub="QField PON status" />
          </div>

          {summary.dataIssues > 0 && (
            <div className="flex gap-2 rounded-lg border border-[var(--ff-warning)] bg-[var(--ff-surface)] p-3 text-sm text-[var(--ff-text-primary)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ff-warning)]" />
              <span>{summary.dataIssues} rows still need Zone/PON alias cleanup or planner standardisation.</span>
            </div>
          )}

          <div className="space-y-5">
            {Object.entries(groupedRows).map(([projectName, rows]) => (
              <div key={projectName} className="overflow-hidden rounded-lg border border-[var(--ff-border)] bg-[var(--ff-surface)]">
                <div className="flex items-center gap-2 border-b border-[var(--ff-border)] px-4 py-3">
                  <GitBranch className="h-4 w-4 text-[var(--ff-primary)]" />
                  <h3 className="font-medium text-[var(--ff-text-primary)]">{projectName}</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--ff-surface-alt)] text-[var(--ff-text-secondary)]">
                      <tr>
                        <th className="px-3 py-2 text-left">Zone</th>
                        <th className="px-3 py-2 text-left">PON</th>
                        <th className="px-3 py-2 text-right">Pole Scope</th>
                        <th className="px-3 py-2 text-right">Pole Actual</th>
                        <th className="px-3 py-2 text-right">Cable Scope</th>
                        <th className="px-3 py-2 text-right">Cable Actual</th>
                        <th className="px-3 py-2 text-left">CWC</th>
                        <th className="px-3 py-2 text-left">ATP</th>
                        <th className="px-3 py-2 text-left">Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={`${row.projectId}-${row.zoneNo ?? 'z'}-${row.ponNo ?? 'p'}`} className="border-t border-[var(--ff-border)] text-[var(--ff-text-primary)]">
                          <td className="px-3 py-2">{row.zoneNo ?? 'Unknown'}</td>
                          <td className="px-3 py-2">{row.ponNo ?? 'Unknown'}</td>
                          <td className="px-3 py-2 text-right">{formatNumber(row.poleScope)}</td>
                          <td className="px-3 py-2 text-right">{formatNumber(row.poleActual)}</td>
                          <td className="px-3 py-2 text-right">{formatKm(row.cableScopeMeters)}</td>
                          <td className="px-3 py-2 text-right">{formatKm(row.cableActualMeters)}</td>
                          <td className="px-3 py-2 capitalize">{statusLabel(row.cwcStatus)}</td>
                          <td className="px-3 py-2 capitalize">{statusLabel(row.atpStatus)}</td>
                          <td className="px-3 py-2 text-[var(--ff-text-secondary)]">{row.issues.join('; ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-[var(--ff-border)] bg-[var(--ff-surface)] p-4">
      <div className="mb-2 flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
        <BarChart3 className="h-4 w-4 text-[var(--ff-primary)]" />
        {label}
      </div>
      <div className="text-2xl font-semibold text-[var(--ff-text-primary)]">{value}</div>
      <div className="mt-1 text-xs text-[var(--ff-text-secondary)]">{sub}</div>
    </div>
  );
}
