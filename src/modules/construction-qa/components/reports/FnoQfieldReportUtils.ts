import type { ScopeActualHierarchyRow, ScopeActualResponse } from '../../services/fnoReportTypes';

export interface ProjectRollup {
  projectName: string;
  rows: ScopeActualHierarchyRow[];
  poleActual: number;
  cableActualMeters: number;
  issues: number;
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

export function buildProjectRollups(data: ScopeActualResponse | null): ProjectRollup[] {
  const rollups = new Map<string, ProjectRollup>();
  for (const row of data?.hierarchy ?? []) {
    const current = rollups.get(row.projectName) ?? {
      projectName: row.projectName,
      rows: [],
      poleActual: 0,
      cableActualMeters: 0,
      issues: 0,
    };
    current.rows.push(row);
    current.poleActual += row.poleActual;
    current.cableActualMeters += row.cableActualMeters;
    current.issues += row.issues.length > 0 ? 1 : 0;
    rollups.set(row.projectName, current);
  }
  return Array.from(rollups.values());
}
