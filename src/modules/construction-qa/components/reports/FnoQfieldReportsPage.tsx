'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { log } from '@/lib/logger';
import type { FnoKey, ScopeActualResponse } from '../../services/fnoReportTypes';
import { buildClientFallbackReport } from './fnoQfieldClientFallback';
import {
  DataQualityPanel,
  ExportActions,
  MetricCard,
  ProjectCards,
  SourceBanner,
} from './FnoQfieldReportSections';
import { buildProjectRollups, buildTrustedSummary, formatKm, formatNumber, isUnmappedAggregateRow, statusLabel } from './FnoQfieldReportUtils';

const FNO_OPTIONS: { key: FnoKey; label: string }[] = [
  { key: 'herotel', label: 'Herotel' },
  { key: 'fibertime', label: 'Fibertime' },
];

type SourceMode = 'live' | 'snapshot';

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function FnoQfieldReportsPage() {
  const [fno, setFno] = useState<FnoKey>('herotel');
  const [projectId, setProjectId] = useState('');
  const [data, setData] = useState<ScopeActualResponse | null>(() => buildClientFallbackReport());
  const [loading, setLoading] = useState(false);
  const [sourceMode, setSourceMode] = useState<SourceMode>('snapshot');
  const [loadError, setLoadError] = useState<string | null>('Live API not checked yet');
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

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
      setSourceMode('live');
      setLoadError(null);
    } catch (error) {
      setData(fno === 'herotel' ? buildClientFallbackReport(projectId) : null);
      setSourceMode('snapshot');
      setLoadError((error as Error).message);
      log.error('Failed to load FNO QField report', { error: (error as Error).message }, 'FnoQfieldReportsPage');
    } finally {
      setLoading(false);
    }
  }, [fno, projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const rollups = useMemo(() => buildProjectRollups(data), [data]);
  const trustedSummary = useMemo(() => buildTrustedSummary(rollups), [rollups]);
  const summary = data?.summary;

  const toggleProject = useCallback((projectName: string) => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectName)) next.delete(projectName);
      else next.add(projectName);
      return next;
    });
  }, []);

  const exportRows = useCallback(() => {
    if (!data) return;
    downloadCsv('fno-qfield-report.csv', [
      ['Project', 'Zone', 'PON', 'QField poles', 'QField cable meters', 'Rollup status', 'CWC', 'ATP', 'Issues'],
      ...data.hierarchy.map((row) => [
        row.projectName,
        row.zoneNo?.toString() ?? 'Unknown',
        row.ponNo?.toString() ?? 'Unknown',
        row.poleActual.toString(),
        row.cableActualMeters.toFixed(2),
        isUnmappedAggregateRow(row) ? 'Excluded from totals: unmapped aggregate row' : 'Included in trusted totals',
        statusLabel(row.cwcStatus),
        statusLabel(row.atpStatus),
        row.issues.join('; '),
      ]),
    ]);
  }, [data]);

  const exportIssues = useCallback(() => {
    if (!data) return;
    downloadCsv('fno-qfield-data-issues.csv', [
      ['Project', 'Zone', 'PON', 'Issues'],
      ...data.hierarchy.filter((row) => row.issues.length > 0).map((row) => [
        row.projectName,
        row.zoneNo?.toString() ?? 'Unknown',
        row.ponNo?.toString() ?? 'Unknown',
        row.issues.join('; '),
      ]),
    ]);
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">FNO QField Report</h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ff-text-secondary)]">
            QField-first Herotel reporting with alias coalescing. The current snapshot proves extracted QField volume; final scope-vs-actual and CWC/ATP mapping still need planner-confirmed fields.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data && <ExportActions onExportRows={exportRows} onExportIssues={exportIssues} />}
          <button type="button" aria-label="Refresh FNO QField report" onClick={fetchData} className="inline-flex items-center gap-2 rounded-md border border-[var(--ff-border)] bg-[var(--ff-surface)] px-3 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-surface-alt)]">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      <SourceBanner mode={sourceMode} error={loadError} />

      <div className="rounded-lg border border-[var(--ff-border)] bg-[var(--ff-surface)] p-4">
        <div className="flex flex-wrap gap-3">
          {FNO_OPTIONS.map((option) => (
            <button key={option.key} type="button" aria-pressed={fno === option.key} onClick={() => { setFno(option.key); setProjectId(''); }} className={`rounded-md border px-4 py-2 text-sm ${fno === option.key ? 'border-[var(--ff-primary)] bg-[var(--ff-primary)] text-[var(--ff-surface)]' : 'border-[var(--ff-border)] bg-[var(--ff-surface-alt)] text-[var(--ff-text-secondary)]'}`}>
              {option.label}
            </button>
          ))}
          <select aria-label="Filter by project" value={projectId} onChange={(event) => setProjectId(event.target.value)} className="min-h-11 rounded-md border border-[var(--ff-border)] bg-[var(--ff-surface-alt)] px-3 py-2 text-sm text-[var(--ff-text-primary)]">
            <option value="">All projects</option>
            {(data?.projects ?? []).map((project) => <option key={project.projectId} value={project.projectId}>{project.projectName}</option>)}
          </select>
        </div>
      </div>

      {loading && <div className="py-10 text-center text-[var(--ff-text-secondary)]">Loading QField report...</div>}

      {!loading && summary && data && (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Trusted QField poles" value={formatNumber(trustedSummary.poleActual)} sub={`${formatNumber(trustedSummary.excludedPoleActual)} unmapped poles excluded pending planner mapping`} />
            <MetricCard label="Trusted QField cable" value={formatKm(trustedSummary.cableActualMeters)} sub={`${formatKm(trustedSummary.excludedCableActualMeters)} unmapped cable excluded pending planner mapping`} />
            <MetricCard label="CWC mapping" value="Not configured" sub="Planner must confirm status field/value mapping" />
            <MetricCard label="ATP mapping" value="Not configured" sub="Generic Status/LSTATUS/WSTATUS seen only" />
          </div>

          <DataQualityPanel data={data} />
          <ProjectCards rollups={rollups} expandedProjects={expandedProjects} onToggleProject={toggleProject} />
          <DetailSections rollups={rollups} expandedProjects={expandedProjects} />
        </>
      )}
    </div>
  );
}

function DetailSections({ rollups, expandedProjects }: { rollups: ReturnType<typeof buildProjectRollups>; expandedProjects: Set<string> }) {
  const expandedRollups = rollups.filter((project) => expandedProjects.has(project.projectName));

  if (expandedRollups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--ff-border)] bg-[var(--ff-surface)] p-4 text-sm text-[var(--ff-text-secondary)]">
        Select a project card above to expand its Zone/PON detail. Select it again to collapse.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {expandedRollups.map((project) => (
        <div id={`project-${project.projectName}`} key={project.projectName} className="overflow-hidden rounded-lg border border-[var(--ff-border)] bg-[var(--ff-surface)]">
          <div className="border-b border-[var(--ff-border)] px-4 py-3 font-medium text-[var(--ff-text-primary)]">{project.projectName} detail</div>
          <div className="space-y-3 p-3 md:hidden">
            {project.rows.map((row) => <MobileRow key={`${row.projectId}-${row.zoneNo ?? 'z'}-${row.ponNo ?? 'p'}`} row={row} />)}
          </div>
          <div className="hidden overflow-x-auto md:block"><DetailTable rows={project.rows} /></div>
        </div>
      ))}
    </div>
  );
}

function MobileRow({ row }: { row: ScopeActualResponse['hierarchy'][number] }) {
  return (
    <div className="rounded-md border border-[var(--ff-border)] bg-[var(--ff-surface-alt)] p-3 text-sm">
      <div className="font-medium text-[var(--ff-text-primary)]">Zone {row.zoneNo ?? 'Unknown'} · PON {row.ponNo ?? 'Unknown'}</div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[var(--ff-text-secondary)]">
        <span>Poles: {formatNumber(row.poleActual)}</span><span>Cable: {formatKm(row.cableActualMeters)}</span>
        <span>CWC: {statusLabel(row.cwcStatus)}</span><span>ATP: {statusLabel(row.atpStatus)}</span>
      </div>
      {row.issues.length > 0 && <div className="mt-2 text-xs text-[var(--ff-warning)]">{row.issues.join('; ')}</div>}
    </div>
  );
}

function DetailTable({ rows }: { rows: ScopeActualResponse['hierarchy'] }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-[var(--ff-surface-alt)] text-[var(--ff-text-secondary)]"><tr><th className="px-3 py-2 text-left">Zone</th><th className="px-3 py-2 text-left">PON</th><th className="px-3 py-2 text-right">QField Poles</th><th className="px-3 py-2 text-right">QField Cable</th><th className="px-3 py-2 text-left">CWC</th><th className="px-3 py-2 text-left">ATP</th><th className="px-3 py-2 text-left">Issues</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={`${row.projectId}-${row.zoneNo ?? 'z'}-${row.ponNo ?? 'p'}`} className="border-t border-[var(--ff-border)] text-[var(--ff-text-primary)]"><td className="px-3 py-2">{row.zoneNo ?? 'Unknown'}</td><td className="px-3 py-2">{row.ponNo ?? 'Unknown'}</td><td className="px-3 py-2 text-right">{formatNumber(row.poleActual)}</td><td className="px-3 py-2 text-right">{formatKm(row.cableActualMeters)}</td><td className="px-3 py-2 capitalize">{statusLabel(row.cwcStatus)}</td><td className="px-3 py-2 capitalize">{statusLabel(row.atpStatus)}</td><td className="px-3 py-2 text-[var(--ff-text-secondary)]">{row.issues.join('; ') || '—'}</td></tr>)}</tbody>
    </table>
  );
}
