import type { ScopeActualResponse } from '../../services/fnoReportTypes';
import { getHerotelQfieldSnapshot } from '../../services/herotelQfieldSnapshot';

export function buildClientFallbackReport(projectId?: string): ScopeActualResponse {
  const snapshot = getHerotelQfieldSnapshot(projectId);
  return {
    fnoKey: 'herotel',
    fnoName: 'Herotel',
    projects: snapshot.projects,
    summary: snapshot.summary,
    hierarchy: snapshot.rows,
  };
}
