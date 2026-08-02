import { sql } from '@/lib/db-pool';
import { employmentEffectivePredicate } from '@/services/attendance/employmentUniverse';

import { ReportTooLargeError, REPORT_ROW_CAP } from './runner';
import { makeParamBuilder } from './sqlHelpers';
import type { ReportColumn, ReportInput, ReportRunResult } from './types';

const COLUMNS: ReadonlyArray<ReportColumn> = [
  { key: 'worker', label: 'Worker' },
  { key: 'work_date', label: 'Work date' },
  { key: 'kind', label: 'Exception' },
  { key: 'owner', label: 'Owner' },
  { key: 'status', label: 'Status' },
  { key: 'age_days', label: 'Age (days)', align: 'right', format: 'integer' },
  { key: 'action_url', label: 'Action' },
];

interface ExceptionFact extends Record<string, unknown> {
  exception_id: string; staff_id: string; full_name: string; department: string | null;
  work_date: string; entry_id: string | null; kind: string; status: string;
  owner_user_id: string | null; created_at: string;
}

export async function runExceptionAgeing(input: ReportInput): Promise<ReportRunResult> {
  if (input.scopedStaffIds?.length === 0) return empty();
  if (!input.dateFrom || !input.dateTo) return { ...empty(), notes: ['Date range is required.'] };
  const pb = makeParamBuilder();
  const where = [
    `de.work_date >= ${pb.next(input.dateFrom)}::date`,
    `de.work_date <= ${pb.next(input.dateTo)}::date`,
    `de.status IN ('open', 'awaiting_worker', 'awaiting_supervisor')`,
    employmentEffectivePredicate('s', 'de.work_date'),
  ];
  if (input.scopedStaffIds !== null) where.push(`de.staff_id = ANY(${pb.next(input.scopedStaffIds)}::uuid[])`);
  if (input.departments.length > 0) where.push(`s.department = ANY(${pb.next(input.departments)}::text[])`);
  const rows = await sql.query<ExceptionFact>(`
    SELECT de.id::text AS exception_id, de.staff_id::text AS staff_id,
      TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS full_name,
      s.department, TO_CHAR(de.work_date, 'YYYY-MM-DD') AS work_date,
      de.entry_id::text AS entry_id, de.kind, de.status, de.owner_user_id::text,
      de.created_at::text AS created_at
    FROM attendance_day_exceptions de JOIN staff s ON s.id = de.staff_id
    WHERE ${where.join(' AND ')}
    ORDER BY de.created_at ASC, de.work_date ASC, de.id ASC
    LIMIT ${pb.next(REPORT_ROW_CAP + 1)}`, pb.params);
  if (rows.length > REPORT_ROW_CAP) throw new ReportTooLargeError(rows.length);
  const now = new Date();
  return {
    rows: rows.map((row) => mapFact(row, now)), columns: COLUMNS,
    notes: ['Age is calculated by SAST calendar day from the persisted exception timestamp.'],
  };
}

function mapFact(row: ExceptionFact, now: Date): Record<string, unknown> {
  return {
    worker: row.full_name, work_date: row.work_date, kind: row.kind,
    owner: row.status === 'awaiting_worker' ? 'worker' : 'supervisor',
    status: row.status, age_days: calendarAgeInSast(row.created_at, now),
    action_url: row.status === 'awaiting_worker' && row.entry_id
      ? `/my/attendance/corrections/new?entry_id=${row.entry_id}&exception_id=${row.exception_id}`
      : `/staff/attendance/corrections?exception_id=${row.exception_id}`,
  };
}

function calendarAgeInSast(createdAt: string, now: Date): number {
  const createdDate = sastDate(new Date(createdAt));
  const today = sastDate(now);
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${createdDate}T00:00:00Z`)) / 86_400_000;
  return Math.max(0, Math.floor(age));
}

function sastDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function empty(): ReportRunResult { return { rows: [], columns: COLUMNS, notes: [] }; }
