import type { ProjectOption, ScopeActualHierarchyRow, ScopeActualSummary } from './fnoReportTypes';
import snapshotData from './data/herotelQfieldSnapshot.json';

interface HerotelSnapshotData {
  projects: ProjectOption[];
  rows: ScopeActualHierarchyRow[];
}

const snapshot = snapshotData as HerotelSnapshotData;

function emptySummary(): ScopeActualSummary {
  return {
    poleScope: 0,
    poleActual: 0,
    cableScopeMeters: 0,
    cableActualMeters: 0,
    cwcComplete: 0,
    cwcPending: 0,
    atpComplete: 0,
    atpPending: 0,
    qaPhotos: 0,
    dataIssues: 0,
  };
}

export function getHerotelQfieldSnapshot(projectId?: string): {
  projects: ProjectOption[];
  rows: ScopeActualHierarchyRow[];
  summary: ScopeActualSummary;
} {
  const rows = projectId
    ? snapshot.rows.filter((row) => row.projectId === projectId)
    : snapshot.rows;

  const summary = rows.reduce((acc, row) => {
    acc.poleScope += row.poleScope;
    acc.poleActual += row.poleActual;
    acc.cableScopeMeters += row.cableScopeMeters;
    acc.cableActualMeters += row.cableActualMeters;
    acc.qaPhotos += row.qaPhotos;
    acc.dataIssues += row.issues.length;
    return acc;
  }, emptySummary());

  return {
    projects: snapshot.projects,
    rows,
    summary,
  };
}
