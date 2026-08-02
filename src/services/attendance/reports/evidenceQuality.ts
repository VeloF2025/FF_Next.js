import { sql } from '@/lib/db-pool';
import { employmentEffectivePredicate } from '@/services/attendance/employmentUniverse';

import { ReportTooLargeError, REPORT_ROW_CAP } from './runner';
import { makeParamBuilder } from './sqlHelpers';
import type { ReportColumn, ReportInput, ReportRunResult } from './types';

const COLUMNS: ReadonlyArray<ReportColumn> = [
  { key: 'worker', label: 'Worker' }, { key: 'department', label: 'Department' },
  { key: 'entry_count', label: 'Entries', align: 'right', format: 'integer' },
  { key: 'gps_available', label: 'GPS available', align: 'right', format: 'integer' },
  { key: 'gps_unavailable', label: 'GPS unavailable', align: 'right', format: 'integer' },
  { key: 'gps_unreliable', label: 'GPS unreliable', align: 'right', format: 'integer' },
  { key: 'selfie_available', label: 'Selfie available', align: 'right', format: 'integer' },
  { key: 'selfie_unavailable', label: 'Selfie unavailable', align: 'right', format: 'integer' },
  { key: 'selfie_unreliable', label: 'Selfie unreliable', align: 'right', format: 'integer' },
  { key: 'geofence_available', label: 'Geofence available', align: 'right', format: 'integer' },
  { key: 'geofence_unavailable', label: 'Geofence unavailable', align: 'right', format: 'integer' },
  { key: 'geofence_unreliable', label: 'Geofence unreliable', align: 'right', format: 'integer' },
  { key: 'cartrack_available', label: 'Cartrack available', align: 'right', format: 'integer' },
  { key: 'cartrack_unavailable', label: 'Cartrack unavailable', align: 'right', format: 'integer' },
  { key: 'cartrack_unreliable', label: 'Cartrack unreliable', align: 'right', format: 'integer' },
  { key: 'timestamp_unreliable_entries', label: 'Timestamp unreliable', align: 'right', format: 'integer' },
  { key: 'coverage_status', label: 'Coverage' },
];

interface EvidencePoint extends Record<string, unknown> {
  entry_id: string; check_type: 'in' | 'out'; has_gps: boolean;
  accuracy_m: string | number | null; has_selfie: boolean;
  site_geofence_id: string | null; cartrack_verdict: string | null;
  timestamp_unreliable: boolean; geofence_mismatch: boolean;
}

interface WorkerFacts extends Record<string, unknown> {
  staff_id: string; full_name: string; department: string | null; points: EvidencePoint[];
}

export async function runEvidenceQuality(input: ReportInput): Promise<ReportRunResult> {
  if (input.scopedStaffIds?.length === 0) return empty();
  if (!input.dateFrom || !input.dateTo) return { ...empty(), notes: ['Date range is required.'] };
  const pb = makeParamBuilder();
  const where = [
    `e.work_date >= ${pb.next(input.dateFrom)}::date`, `e.work_date <= ${pb.next(input.dateTo)}::date`,
    employmentEffectivePredicate('s', 'e.work_date'),
  ];
  if (input.scopedStaffIds !== null) where.push(`e.staff_id = ANY(${pb.next(input.scopedStaffIds)}::uuid[])`);
  if (input.departments.length > 0) where.push(`s.department = ANY(${pb.next(input.departments)}::text[])`);
  const rows = await sql.query<WorkerFacts>(`
    WITH evidence AS (
      SELECT e.id, e.staff_id, s.first_name, s.last_name, s.department, e.site_geofence_id,
        EXISTS (SELECT 1 FROM attendance_exceptions ax
          WHERE ax.entry_id = e.id AND ax.exception_kind = 'geofence_mismatch') AS geofence_mismatch,
        EXISTS (SELECT 1 FROM attendance_day_exceptions de
          WHERE de.staff_id = e.staff_id AND de.work_date = e.work_date
            AND de.kind = 'evidence_unreliable'
            AND de.status IN ('open', 'awaiting_worker', 'awaiting_supervisor')) AS timestamp_unreliable,
        e.clock_in_at, e.clock_out_at,
        e.clock_in_lat, e.clock_in_lon, e.clock_in_accuracy_m,
        e.clock_out_lat, e.clock_out_lon, e.clock_out_accuracy_m,
        NULLIF(BTRIM(e.selfie_in_url), '') IS NOT NULL AS selfie_in_available,
        NULLIF(BTRIM(e.selfie_out_url), '') IS NOT NULL AS selfie_out_available
      FROM attendance_entries e JOIN staff s ON s.id = e.staff_id WHERE ${where.join(' AND ')}
    ), points AS (
      SELECT evidence.*, point.check_type, point.has_gps, point.accuracy_m, point.has_selfie,
        verification.verdict AS cartrack_verdict
      FROM evidence CROSS JOIN LATERAL (VALUES
        ('in'::text, clock_in_lat IS NOT NULL AND clock_in_lon IS NOT NULL, clock_in_accuracy_m, selfie_in_available),
        ('out'::text, clock_out_lat IS NOT NULL AND clock_out_lon IS NOT NULL, clock_out_accuracy_m, selfie_out_available)
      ) point(check_type, has_gps, accuracy_m, has_selfie)
      LEFT JOIN attendance_gps_verifications verification
        ON verification.entry_id = evidence.id AND verification.check_type = point.check_type
      WHERE point.check_type = 'in' OR evidence.clock_out_at IS NOT NULL
    )
    SELECT staff_id::text, TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS full_name,
      department, JSONB_AGG(JSONB_BUILD_OBJECT(
        'entry_id', id::text, 'check_type', check_type, 'has_gps', has_gps,
        'accuracy_m', accuracy_m, 'has_selfie', has_selfie, 'site_geofence_id', site_geofence_id,
        'cartrack_verdict', cartrack_verdict, 'timestamp_unreliable', timestamp_unreliable,
        'geofence_mismatch', geofence_mismatch
      ) ORDER BY id, check_type) AS points
    FROM points GROUP BY staff_id, first_name, last_name, department
    ORDER BY full_name, staff_id LIMIT ${pb.next(REPORT_ROW_CAP + 1)}`, pb.params);
  if (rows.length > REPORT_ROW_CAP) throw new ReportTooLargeError(rows.length);
  return { rows: rows.map(aggregateWorker), columns: COLUMNS, notes: [
    'Channel coverage uses each channel’s own persisted facts; timestamp integrity is reported separately.',
    'Coverage is evidence availability and reliability only, not a payroll or conduct verdict.',
  ] };
}

function aggregateWorker(row: WorkerFacts): Record<string, unknown> {
  const counts = {
    gps_available: 0, gps_unavailable: 0, gps_unreliable: 0,
    selfie_available: 0, selfie_unavailable: 0, selfie_unreliable: 0,
    geofence_available: 0, geofence_unavailable: 0, geofence_unreliable: 0,
    cartrack_available: 0, cartrack_unavailable: 0, cartrack_unreliable: 0,
  };
  const entries = new Set<string>();
  const timestampUnreliable = new Set<string>();
  for (const point of row.points) {
    entries.add(point.entry_id);
    if (point.timestamp_unreliable) timestampUnreliable.add(point.entry_id);
    if (!point.has_gps) counts.gps_unavailable += 1;
    else if (point.accuracy_m === null || Number(point.accuracy_m) > 100) counts.gps_unreliable += 1;
    else counts.gps_available += 1;
    if (point.has_selfie) counts.selfie_available += 1;
    else counts.selfie_unavailable += 1;
    if (point.check_type === 'in') {
      if (point.geofence_mismatch) counts.geofence_unreliable += 1;
      else if (point.site_geofence_id) counts.geofence_available += 1;
      else counts.geofence_unavailable += 1;
    }
    if (point.cartrack_verdict === null) counts.cartrack_unavailable += 1;
    else if (point.cartrack_verdict === 'match' || point.cartrack_verdict === 'mismatch') counts.cartrack_available += 1;
    else counts.cartrack_unreliable += 1;
  }
  const unreliable = counts.gps_unreliable + counts.selfie_unreliable +
    counts.geofence_unreliable + counts.cartrack_unreliable;
  const unavailable = counts.gps_unavailable + counts.selfie_unavailable +
    counts.geofence_unavailable + counts.cartrack_unavailable;
  const available = counts.gps_available + counts.selfie_available +
    counts.geofence_available + counts.cartrack_available;
  return {
    worker: row.full_name, department: row.department ?? '', entry_count: entries.size, ...counts,
    timestamp_unreliable_entries: timestampUnreliable.size,
    coverage_status: unreliable > 0 ? 'unreliable' : available === 0 ? 'unavailable' : unavailable > 0 ? 'partial' : 'complete',
  };
}

function empty(): ReportRunResult { return { rows: [], columns: COLUMNS, notes: [] }; }
