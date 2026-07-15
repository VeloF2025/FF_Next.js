import { query } from '@/lib/db-pool';
import type {
  FnoKey,
  FnoSummaryRow,
  ProjectOption,
  ScopeActualHierarchyRow,
  ScopeActualResponse,
  ScopeActualSummary,
  ProgressStatus,
} from './fnoReportTypes';
import { buildFnoHierarchySql, buildProjectWhere, FNO_NAMES } from './fnoQfieldSql';
import { getHerotelQfieldSnapshot } from './herotelQfieldSnapshot';

interface RawHierarchyRow extends Record<string, unknown> {
  project_id: string;
  project_name: string;
  zone_no: number | null;
  pon_no: number | null;
  pole_scope: number | string | null;
  pole_actual: number | string | null;
  cable_scope_meters: number | string | null;
  cable_actual_meters: number | string | null;
  cwc_total: number | string | null;
  cwc_complete: number | string | null;
  cwc_last_date: string | null;
  atp_total: number | string | null;
  atp_passed: number | string | null;
  atp_last_date: string | null;
  qa_photos: number | string | null;
}

interface RawProjectRow extends Record<string, unknown> {
  project_id: string;
  project_name: string;
}

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function statusFromCounts(totalValue: number | string | null, completeValue: number | string | null): ProgressStatus {
  const total = toNumber(totalValue);
  const complete = toNumber(completeValue);
  if (total <= 0 && complete <= 0) return 'unknown';
  if (complete <= 0) return 'not_started';
  if (complete >= total) return 'complete';
  return 'partial';
}

function statusCounters(status: ProgressStatus): { complete: number; pending: number } {
  if (status === 'complete') return { complete: 1, pending: 0 };
  if (status === 'unknown') return { complete: 0, pending: 0 };
  return { complete: 0, pending: 1 };
}

export function normalizeFnoKey(input: string | string[] | undefined): FnoKey {
  const key = Array.isArray(input) ? input[0] : input;
  return key === 'fibertime' ? 'fibertime' : 'herotel';
}

export async function getFnoProjects(fnoKey: FnoKey): Promise<ProjectOption[]> {
  const { where, params } = buildProjectWhere(fnoKey);
  const rows = await query<RawProjectRow>(`
    SELECT p.id::text AS project_id, p.project_name
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE ${where}
    ORDER BY p.project_name
  `, params);

  return rows.map((row) => ({ projectId: row.project_id, projectName: row.project_name }));
}

function isUuid(value: string | undefined): boolean {
  return !!value && /^[0-9a-f-]{36}$/i.test(value);
}

export async function getFnoScopeActualReport(
  fnoKey: FnoKey,
  projectId?: string,
): Promise<ScopeActualResponse> {
  const dbProjectId = isUuid(projectId) ? projectId : undefined;
  const { where, params } = buildProjectWhere(fnoKey, dbProjectId);
  const rows = await query<RawHierarchyRow>(buildFnoHierarchySql(where), params);
  const summary: ScopeActualSummary = {
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

  const hierarchy = rows.map((row) => mapHierarchyRow(row, summary));

  if (fnoKey === 'herotel' && hierarchy.length === 0) {
    const snapshot = getHerotelQfieldSnapshot(projectId);
    return {
      fnoKey,
      fnoName: FNO_NAMES[fnoKey],
      projects: snapshot.projects,
      summary: snapshot.summary,
      hierarchy: snapshot.rows,
    };
  }

  const projects = await getFnoProjects(fnoKey);

  return {
    fnoKey,
    fnoName: FNO_NAMES[fnoKey],
    projects,
    summary,
    hierarchy,
  };
}

function mapHierarchyRow(row: RawHierarchyRow, summary: ScopeActualSummary): ScopeActualHierarchyRow {
  const cwcStatus = statusFromCounts(row.cwc_total, row.cwc_complete);
  const atpStatus = statusFromCounts(row.atp_total, row.atp_passed);
  const cwc = statusCounters(cwcStatus);
  const atp = statusCounters(atpStatus);
  const issues: string[] = [];
  if (row.zone_no === null) issues.push('Missing Zone after QField alias coalesce');
  if (row.pon_no === null) issues.push('Missing PON after QField alias coalesce');

  const mapped: ScopeActualHierarchyRow = {
    projectId: row.project_id,
    projectName: row.project_name,
    zoneNo: row.zone_no,
    ponNo: row.pon_no,
    poleScope: toNumber(row.pole_scope),
    poleActual: toNumber(row.pole_actual),
    cableScopeMeters: toNumber(row.cable_scope_meters),
    cableActualMeters: toNumber(row.cable_actual_meters),
    cwcStatus,
    atpStatus,
    cwcCompletedAt: row.cwc_last_date,
    atpCompletedAt: row.atp_last_date,
    qaPhotos: toNumber(row.qa_photos),
    issues,
  };

  summary.poleScope += mapped.poleScope;
  summary.poleActual += mapped.poleActual;
  summary.cableScopeMeters += mapped.cableScopeMeters;
  summary.cableActualMeters += mapped.cableActualMeters;
  summary.cwcComplete += cwc.complete;
  summary.cwcPending += cwc.pending;
  summary.atpComplete += atp.complete;
  summary.atpPending += atp.pending;
  summary.qaPhotos += mapped.qaPhotos;
  summary.dataIssues += issues.length;

  return mapped;
}

export async function getFnoSummary(): Promise<FnoSummaryRow[]> {
  const keys: FnoKey[] = ['fibertime', 'herotel'];
  const reports = await Promise.all(keys.map((key) => getFnoScopeActualReport(key)));
  return reports.map((report) => ({
    fnoKey: report.fnoKey,
    fnoName: report.fnoName,
    projectCount: report.projects.length,
    poleScope: report.summary.poleScope,
    poleActual: report.summary.poleActual,
    cableScopeMeters: report.summary.cableScopeMeters,
    cableActualMeters: report.summary.cableActualMeters,
    cwcComplete: report.summary.cwcComplete,
    cwcPending: report.summary.cwcPending,
    atpComplete: report.summary.atpComplete,
    atpPending: report.summary.atpPending,
    dataIssues: report.summary.dataIssues,
  }));
}
