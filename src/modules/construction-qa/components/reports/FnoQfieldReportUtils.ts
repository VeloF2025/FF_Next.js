import type { ScopeActualHierarchyRow, ScopeActualResponse } from '../../services/fnoReportTypes';

export interface ProjectRollup {
  projectName: string;
  rows: ScopeActualHierarchyRow[];
  trustedRows: ScopeActualHierarchyRow[];
  excludedRows: ScopeActualHierarchyRow[];
  poleActual: number;
  cableActualMeters: number;
  excludedPoleActual: number;
  excludedCableActualMeters: number;
  issues: number;
}

export interface TrustedSummary {
  poleActual: number;
  cableActualMeters: number;
  excludedPoleActual: number;
  excludedCableActualMeters: number;
  excludedRows: number;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 }).format(value);
}

export function formatKm(meters: number): string {
  return `${new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 1 }).format(meters / 1000)} km`;
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export function isUnmappedAggregateRow(row: ScopeActualHierarchyRow): boolean {
  return row.zoneNo === null && row.ponNo === null && (row.poleActual > 0 || row.cableActualMeters > 0);
}

export function buildProjectRollups(data: ScopeActualResponse | null): ProjectRollup[] {
  const rollups = new Map<string, ProjectRollup>();
  for (const row of data?.hierarchy ?? []) {
    const current = rollups.get(row.projectName) ?? {
      projectName: row.projectName,
      rows: [],
      trustedRows: [],
      excludedRows: [],
      poleActual: 0,
      cableActualMeters: 0,
      excludedPoleActual: 0,
      excludedCableActualMeters: 0,
      issues: 0,
    };

    current.rows.push(row);
    current.issues += row.issues.length > 0 ? 1 : 0;

    if (isUnmappedAggregateRow(row)) {
      current.excludedRows.push(row);
      current.excludedPoleActual += row.poleActual;
      current.excludedCableActualMeters += row.cableActualMeters;
    } else {
      current.trustedRows.push(row);
      current.poleActual += row.poleActual;
      current.cableActualMeters += row.cableActualMeters;
    }

    rollups.set(row.projectName, current);
  }
  return Array.from(rollups.values());
}

export function buildTrustedSummary(rollups: ProjectRollup[]): TrustedSummary {
  return rollups.reduce<TrustedSummary>((summary, project) => {
    summary.poleActual += project.poleActual;
    summary.cableActualMeters += project.cableActualMeters;
    summary.excludedPoleActual += project.excludedPoleActual;
    summary.excludedCableActualMeters += project.excludedCableActualMeters;
    summary.excludedRows += project.excludedRows.length;
    return summary;
  }, {
    poleActual: 0,
    cableActualMeters: 0,
    excludedPoleActual: 0,
    excludedCableActualMeters: 0,
    excludedRows: 0,
  });
}
