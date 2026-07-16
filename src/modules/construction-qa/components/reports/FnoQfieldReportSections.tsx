'use client';

import { AlertTriangle, BarChart3, ChevronDown, ChevronRight, Database, Download, GitBranch, ShieldAlert } from 'lucide-react';
import type { ScopeActualResponse } from '../../services/fnoReportTypes';
import type { ProjectRollup } from './FnoQfieldReportUtils';
import { formatKm, formatNumber } from './FnoQfieldReportUtils';

export function SourceBanner({ mode, error }: { mode: 'live' | 'snapshot'; error: string | null }) {
  const isSnapshot = mode === 'snapshot';
  return (
    <div className="rounded-lg border border-[var(--ff-warning)] bg-[var(--ff-surface)] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex gap-3">
          {isSnapshot ? (
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ff-warning)]" />
          ) : (
            <Database className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ff-success)]" />
          )}
          <div>
            <div className="font-medium text-[var(--ff-text-primary)]">
              {isSnapshot ? 'Showing bundled Herotel QField snapshot' : 'Showing live QField report data'}
            </div>
            <p className="mt-1 text-sm text-[var(--ff-text-secondary)]">
              {isSnapshot
                ? 'Live API data is unavailable in this browser session, so the page is using the verified QField snapshot bundled with this dev build.'
                : 'Live API returned a valid report payload for this session.'}
            </p>
            {error && <p className="mt-1 text-xs text-[var(--ff-warning)]">Live API status: {error}</p>}
          </div>
        </div>
        <div className="rounded-md border border-[var(--ff-border)] bg-[var(--ff-surface-alt)] px-3 py-2 text-xs text-[var(--ff-text-secondary)]">
          Scope/actual split still needs planner source mapping. Do not treat 100% as completion proof yet.
        </div>
      </div>
    </div>
  );
}

export function ExportActions({ onExportRows, onExportIssues }: { onExportRows: () => void; onExportIssues: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={onExportRows} className="inline-flex items-center gap-2 rounded-md border border-[var(--ff-border)] bg-[var(--ff-surface)] px-3 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-surface-alt)]">
        <Download className="h-4 w-4" /> Export report CSV
      </button>
      <button type="button" onClick={onExportIssues} className="inline-flex items-center gap-2 rounded-md border border-[var(--ff-border)] bg-[var(--ff-surface)] px-3 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-surface-alt)]">
        <Download className="h-4 w-4" /> Export data issues
      </button>
    </div>
  );
}

export function MetricCard({ label, value, sub }: { label: string; value: string; sub: string }) {
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

export function DataQualityPanel({ data }: { data: ScopeActualResponse }) {
  return (
    <div className="rounded-lg border border-[var(--ff-warning)] bg-[var(--ff-surface)] p-4">
      <div className="flex gap-2 text-sm text-[var(--ff-text-primary)]">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ff-warning)]" />
        <div>
          <div className="font-medium">{data.summary.dataIssues} rows need alias cleanup or planner standardisation.</div>
          <p className="mt-1 text-[var(--ff-text-secondary)]">
            CWC/ATP fields are not mapped yet. Sampled QField files expose generic fields like Status, LSTATUS and WSTATUS, so the report deliberately avoids inventing CWC/ATP completion.
          </p>
          <p className="mt-2 text-[var(--ff-warning)]">
            Rows with both Zone and PON unknown are treated as unmapped aggregate rows and excluded from headline/project quantity totals until planner mapping confirms what those counts represent.
          </p>
        </div>
      </div>
    </div>
  );
}

export function ProjectCards({
  rollups,
  expandedProjects,
  onToggleProject,
}: {
  rollups: ProjectRollup[];
  expandedProjects: Set<string>;
  onToggleProject: (projectName: string) => void;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
      {rollups.map((project) => {
        const isExpanded = expandedProjects.has(project.projectName);
        return (
        <button
          key={project.projectName}
          type="button"
          aria-expanded={isExpanded}
          aria-controls={`project-${project.projectName}`}
          onClick={() => onToggleProject(project.projectName)}
          className="rounded-lg border border-[var(--ff-border)] bg-[var(--ff-surface)] p-4 text-left hover:bg-[var(--ff-surface-alt)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
        >
          <div className="flex items-center justify-between gap-2 font-medium text-[var(--ff-text-primary)]">
            <span className="flex min-w-0 items-center gap-2">
              <GitBranch className="h-4 w-4 shrink-0 text-[var(--ff-primary)]" />
              <span className="truncate">{project.projectName}</span>
            </span>
            {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <Stat label="Rows" value={formatNumber(project.rows.length)} />
            <Stat label="Poles" value={formatNumber(project.poleActual)} />
            <Stat label="Cable" value={formatKm(project.cableActualMeters)} />
          </div>
          <div className="mt-3 text-xs text-[var(--ff-text-secondary)]">
            {project.issues > 0 ? `${project.issues} rows with data-quality issues` : 'No row-level issues flagged'}
          </div>
          {project.excludedRows.length > 0 && (
            <div className="mt-2 rounded-md border border-[var(--ff-warning)] bg-[var(--ff-surface-alt)] px-2 py-1 text-xs text-[var(--ff-warning)]">
              Excluded unmapped: {formatNumber(project.excludedPoleActual)} poles · {formatKm(project.excludedCableActualMeters)} cable
            </div>
          )}
          <div className="mt-3 text-xs font-medium text-[var(--ff-primary)]">
            {isExpanded ? 'Hide project detail' : 'Show project detail'}
          </div>
        </button>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-[var(--ff-text-secondary)]">{label}</div>
      <div className="font-semibold text-[var(--ff-text-primary)]">{value}</div>
    </div>
  );
}
