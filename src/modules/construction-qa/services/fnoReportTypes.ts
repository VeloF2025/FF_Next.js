export type FnoKey = 'fibertime' | 'herotel';

export interface ProjectOption {
  projectId: string;
  projectName: string;
}

export interface FnoSummaryRow {
  fnoKey: FnoKey;
  fnoName: string;
  projectCount: number;
  poleScope: number;
  poleActual: number;
  cableScopeMeters: number;
  cableActualMeters: number;
  cwcComplete: number;
  cwcPending: number;
  atpComplete: number;
  atpPending: number;
  dataIssues: number;
}

export type ProgressStatus = 'complete' | 'pending' | 'partial' | 'not_started' | 'unknown';

export interface ScopeActualHierarchyRow {
  projectId: string;
  projectName: string;
  zoneNo: number | null;
  ponNo: number | null;
  poleScope: number;
  poleActual: number;
  cableScopeMeters: number;
  cableActualMeters: number;
  cwcStatus: ProgressStatus;
  atpStatus: ProgressStatus;
  cwcCompletedAt: string | null;
  atpCompletedAt: string | null;
  qaPhotos: number;
  issues: string[];
}

export interface ScopeActualSummary {
  poleScope: number;
  poleActual: number;
  cableScopeMeters: number;
  cableActualMeters: number;
  cwcComplete: number;
  cwcPending: number;
  atpComplete: number;
  atpPending: number;
  qaPhotos: number;
  dataIssues: number;
}

export interface ScopeActualResponse {
  fnoKey: FnoKey;
  fnoName: string;
  projects: ProjectOption[];
  summary: ScopeActualSummary;
  hierarchy: ScopeActualHierarchyRow[];
}
