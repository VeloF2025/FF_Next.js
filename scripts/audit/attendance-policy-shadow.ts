import { pathToFileURL } from 'node:url';
import { employmentEffectivePredicate } from '../../src/services/attendance/employmentUniverse';

export type ShadowFormat = 'json' | 'csv';
export type ShadowQuery = (
  text: string,
  values: readonly unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

type Projection = {
  status: string | null;
  regularHours: number;
  overtimeHours: number;
  sundayHours: number;
  holidayHours: number;
  leaveHours: number;
  unpaidHours: number;
  classification: string | null;
  blockerCount: number;
};

export type ShadowRow = {
  staffId: string;
  workDate: string;
  reasonCodes: string[];
  legacy: Projection | null;
  policy: Projection | null;
};

type CategoryTotals = Pick<Projection, 'regularHours' | 'overtimeHours' | 'sundayHours' |
  'holidayHours' | 'leaveHours' | 'unpaidHours'>;
export type ShadowReport = {
  metrics: {
    expectedDays: number; legacyObservedDays: number; policyObservedDays: number;
    missingBothDays: number; staleReconciliation: boolean; deltaDays: number;
    legacyCategoryTotals: CategoryTotals; policyCategoryTotals: CategoryTotals;
  };
  gate: { passed: boolean; reasonCodes: string[] };
  rows: ShadowRow[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EXPECTED_SELECT = `WITH workdays AS (
  SELECT day::date AS work_date
  FROM GENERATE_SERIES($1::date, $2::date, INTERVAL '1 day') AS days(day)
  WHERE EXTRACT(ISODOW FROM day) BETWEEN 1 AND 6
)
SELECT /* expected_universe */ s.id AS staff_id, TO_CHAR(w.work_date, 'YYYY-MM-DD') AS work_date
FROM staff s CROSS JOIN workdays w
WHERE ${employmentEffectivePredicate('s', 'w.work_date')}
ORDER BY s.id, w.work_date`;
const LEGACY_SELECT = `SELECT /* legacy_projection */
  ds.staff_id, TO_CHAR(ds.work_date, 'YYYY-MM-DD') AS work_date, NULL::text AS status,
  ds.regular_hrs::float AS regular_hours,
  ds.overtime_hrs::float AS overtime_hours,
  ds.sunday_hrs::float AS sunday_hours,
  ds.holiday_hrs::float AS holiday_hours,
  ds.leave_hrs::float AS leave_hours,
  ds.unpaid_hrs::float AS unpaid_hours,
  NULL::text AS classification, 0::int AS blocker_count
FROM attendance_daily_summaries ds JOIN staff s_observed ON s_observed.id = ds.staff_id
WHERE ds.work_date BETWEEN $1::date AND $2::date
  AND ${employmentEffectivePredicate('s_observed', 'ds.work_date')}
ORDER BY ds.staff_id, ds.work_date`;

const POLICY_SELECT = `SELECT /* policy_projection */
  ds.staff_id, TO_CHAR(ds.work_date, 'YYYY-MM-DD') AS work_date, ds.result_status AS status,
  CASE WHEN ds.result_status IN ('approved', 'locked')
    THEN COALESCE(ds.approved_regular_hrs, 0) ELSE COALESCE(ds.proposed_regular_hrs, 0) END::float AS regular_hours,
  CASE WHEN ds.result_status IN ('approved', 'locked')
    THEN COALESCE(ds.approved_overtime_hrs, 0) ELSE COALESCE(ds.proposed_overtime_hrs, 0) END::float AS overtime_hours,
  CASE WHEN ds.result_status IN ('approved', 'locked')
    THEN COALESCE(ds.approved_sunday_hrs, 0) ELSE COALESCE(ds.proposed_sunday_hrs, 0) END::float AS sunday_hours,
  CASE WHEN ds.result_status IN ('approved', 'locked')
    THEN COALESCE(ds.approved_holiday_hrs, 0) ELSE COALESCE(ds.proposed_holiday_hrs, 0) END::float AS holiday_hours,
  COALESCE(ds.leave_hrs, 0)::float AS leave_hours,
  COALESCE(ds.unpaid_hrs, 0)::float AS unpaid_hours,
  ds.attendance_classification AS classification,
  jsonb_array_length(ds.blocking_reasons)::int AS blocker_count
FROM attendance_daily_summaries ds JOIN staff s_observed ON s_observed.id = ds.staff_id
WHERE ds.work_date BETWEEN $1::date AND $2::date
  AND ds.schedule_policy_id IS NOT NULL
  AND ${employmentEffectivePredicate('s_observed', 'ds.work_date')}
ORDER BY ds.staff_id, ds.work_date`;
const RECONCILIATION_SELECT = `WITH bounds AS (
  SELECT $1::date AS from_date, $2::date AS to_date
), latest_run AS (
  SELECT status, finished_at, failed_day_keys
  FROM attendance_reconciliation_runs, bounds
  WHERE scanned_from <= from_date AND scanned_to >= to_date
  ORDER BY started_at DESC LIMIT 1
), latest_change AS (
  SELECT GREATEST(
    COALESCE((SELECT MAX(ds.computed_at) FROM attendance_daily_summaries ds, bounds
      WHERE ds.work_date BETWEEN from_date AND to_date), '-infinity'::timestamptz),
    COALESCE((SELECT MAX(ae.updated_at) FROM attendance_entries ae, bounds
      WHERE ae.work_date BETWEEN from_date AND to_date), '-infinity'::timestamptz),
    COALESCE((SELECT MAX(aa.updated_at) FROM attendance_adjustments aa
      JOIN attendance_entries ae ON ae.id = aa.entry_id CROSS JOIN bounds
      WHERE ae.work_date BETWEEN from_date AND to_date), '-infinity'::timestamptz),
    COALESCE((SELECT MAX(de.updated_at) FROM attendance_day_exceptions de, bounds
      WHERE de.work_date BETWEEN from_date AND to_date), '-infinity'::timestamptz)
  ) AS changed_at
)
SELECT /* reconciliation_freshness */ NOT COALESCE(
  latest_run.status = 'succeeded'
    AND COALESCE(jsonb_array_length(latest_run.failed_day_keys), 0) = 0
    AND latest_run.finished_at >= latest_change.changed_at,
  false
) AS stale_reconciliation
FROM latest_change LEFT JOIN latest_run ON true`;

export function parseShadowArgs(argv: string[]): { from: string; to: string; format: ShadowFormat } {
  const args = Object.fromEntries(argv.map((arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`Unsupported argument: ${arg}`);
    return [match[1], match[2]];
  }));
  if (!DATE.test(args.from ?? '') || !DATE.test(args.to ?? '')) {
    throw new Error('--from and --to must be fixed YYYY-MM-DD dates');
  }
  if (args.from > args.to) throw new Error('--from must be on or before --to');
  if (args.format !== 'json' && args.format !== 'csv') {
    throw new Error('--format must be json or csv');
  }
  return { from: args.from, to: args.to, format: args.format };
}

function projection(row: Record<string, unknown>): Projection {
  return {
    status: row.status == null ? null : String(row.status),
    regularHours: Number(row.regular_hours),
    overtimeHours: Number(row.overtime_hours),
    sundayHours: Number(row.sunday_hours),
    holidayHours: Number(row.holiday_hours),
    leaveHours: Number(row.leave_hours),
    unpaidHours: Number(row.unpaid_hours),
    classification: row.classification == null ? null : String(row.classification),
    blockerCount: Number(row.blocker_count),
  };
}

function key(row: Record<string, unknown>): string {
  return `${String(row.staff_id)}\u0000${String(row.work_date)}`;
}

function reasons(legacy: Projection | null, policy: Projection | null): string[] {
  if (!legacy && !policy) return ['MISSING_BOTH_PROJECTIONS'];
  if (!legacy) return ['MISSING_LEGACY_PROJECTION'];
  if (!policy) return ['MISSING_POLICY_PROJECTION'];
  const out: string[] = [];
  if (legacy.status != null && policy.status != null && legacy.status !== policy.status) {
    out.push('STATUS_DELTA');
  }
  if (legacy.regularHours !== policy.regularHours) out.push('REGULAR_HOURS_DELTA');
  if (legacy.overtimeHours !== policy.overtimeHours) out.push('OVERTIME_HOURS_DELTA');
  if (legacy.sundayHours !== policy.sundayHours) out.push('SUNDAY_HOURS_DELTA');
  if (legacy.holidayHours !== policy.holidayHours) out.push('HOLIDAY_HOURS_DELTA');
  if (legacy.leaveHours !== policy.leaveHours) out.push('LEAVE_HOURS_DELTA');
  if (legacy.unpaidHours !== policy.unpaidHours) out.push('UNPAID_HOURS_DELTA');
  if (legacy.classification !== policy.classification) out.push('CLASSIFICATION_DELTA');
  if (legacy.blockerCount !== policy.blockerCount) out.push('BLOCKER_COUNT_DELTA');
  return out;
}

export async function runAttendancePolicyShadow(
  query: ShadowQuery,
  from: string,
  to: string,
): Promise<ShadowReport> {
  const values = [from, to] as const;
  const expected = await query(EXPECTED_SELECT, values);
  const legacy = await query(LEGACY_SELECT, values);
  const policy = await query(POLICY_SELECT, values);
  const freshness = await query(RECONCILIATION_SELECT, values);
  const expectedKeys = expected.rows.map(key).sort();
  const legacyByKey = new Map(legacy.rows.map((row) => [key(row), row]));
  const policyByKey = new Map(policy.rows.map((row) => [key(row), row]));
  const comparisonKeys = [...new Set([
    ...expectedKeys, ...legacyByKey.keys(), ...policyByKey.keys(),
  ])].sort();
  const rows = comparisonKeys.flatMap((rowKey) => {
    const legacyRow = legacyByKey.get(rowKey);
    const policyRow = policyByKey.get(rowKey);
    const left = legacyRow ? projection(legacyRow) : null;
    const right = policyRow ? projection(policyRow) : null;
    const reasonCodes = reasons(left, right);
    if (reasonCodes.length === 0) return [];
    const [staffId, workDate] = rowKey.split('\u0000');
    return [{ staffId, workDate, reasonCodes, legacy: left, policy: right }];
  });
  const legacyObserved = legacy.rows.map(projection);
  const policyObserved = policy.rows.map(projection);
  const staleReconciliation = freshness.rows[0]?.stale_reconciliation !== false;
  const missingBothDays = rows.filter((row) => row.reasonCodes.includes('MISSING_BOTH_PROJECTIONS')).length;
  const missingLegacy = expectedKeys.some((rowKey) => !legacyByKey.has(rowKey)) ||
    rows.some((row) => row.reasonCodes.includes('MISSING_LEGACY_PROJECTION'));
  const missingPolicy = expectedKeys.some((rowKey) => !policyByKey.has(rowKey)) ||
    rows.some((row) => row.reasonCodes.includes('MISSING_POLICY_PROJECTION'));
  const gateReasons = [
    staleReconciliation && 'STALE_RECONCILIATION',
    missingBothDays > 0 && 'MISSING_BOTH_PROJECTIONS',
    missingLegacy && 'MISSING_LEGACY_PROJECTION',
    missingPolicy && 'MISSING_POLICY_PROJECTION',
    rows.some((row) => row.reasonCodes.some((reason) => reason.endsWith('_DELTA'))) && 'PROJECTION_DELTAS',
  ].filter((reason): reason is string => Boolean(reason));
  return {
    metrics: {
      expectedDays: expectedKeys.length,
      legacyObservedDays: legacyObserved.length,
      policyObservedDays: policyObserved.length,
      missingBothDays, staleReconciliation,
      deltaDays: rows.filter((row) =>
        row.reasonCodes.some((reason) => reason.endsWith('_DELTA'))).length,
      legacyCategoryTotals: categoryTotals(legacyObserved),
      policyCategoryTotals: categoryTotals(policyObserved),
    },
    gate: { passed: gateReasons.length === 0, reasonCodes: gateReasons },
    rows,
  };
}

function categoryTotals(rows: Projection[]): CategoryTotals {
  return rows.reduce((total, row) => ({
    regularHours: total.regularHours + row.regularHours,
    overtimeHours: total.overtimeHours + row.overtimeHours,
    sundayHours: total.sundayHours + row.sundayHours,
    holidayHours: total.holidayHours + row.holidayHours,
    leaveHours: total.leaveHours + row.leaveHours,
    unpaidHours: total.unpaidHours + row.unpaidHours,
  }), { regularHours: 0, overtimeHours: 0, sundayHours: 0,
    holidayHours: 0, leaveHours: 0, unpaidHours: 0 });
}

const csvCell = (value: unknown) => {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function serializeShadowRows(report: ShadowReport, format: ShadowFormat): string {
  if (format === 'json') return `${JSON.stringify(report, null, 2)}\n`;
  const header = ['staff_id', 'work_date', 'reason_codes', 'legacy_status', 'policy_status',
    'legacy_regular_hours', 'policy_regular_hours', 'legacy_overtime_hours', 'policy_overtime_hours',
    'legacy_sunday_hours', 'policy_sunday_hours', 'legacy_classification', 'policy_classification',
    'legacy_blocker_count', 'policy_blocker_count'];
  const data = report.rows.map((row) => [row.staffId, row.workDate, row.reasonCodes.join('|'), row.legacy?.status,
    row.policy?.status, row.legacy?.regularHours, row.policy?.regularHours, row.legacy?.overtimeHours,
    row.policy?.overtimeHours, row.legacy?.sundayHours, row.policy?.sundayHours,
    row.legacy?.classification, row.policy?.classification, row.legacy?.blockerCount,
    row.policy?.blockerCount].map(csvCell).join(','));
  const summary = [
    ['summary', 'expected_days', report.metrics.expectedDays],
    ['summary', 'legacy_observed_days', report.metrics.legacyObservedDays],
    ['summary', 'policy_observed_days', report.metrics.policyObservedDays],
    ['summary', 'missing_both_days', report.metrics.missingBothDays],
    ['summary', 'stale_reconciliation', report.metrics.staleReconciliation],
    ['summary', 'delta_days', report.metrics.deltaDays],
    ['summary', 'gate_passed', report.gate.passed],
    ['summary', 'gate_reason_codes', report.gate.reasonCodes.join('|')],
    ...Object.entries(report.metrics.legacyCategoryTotals)
      .map(([category, value]) => ['summary', `legacy_${category}`, value]),
    ...Object.entries(report.metrics.policyCategoryTotals)
      .map(([category, value]) => ['summary', `policy_${category}`, value]),
  ].map((row) => row.map(csvCell).join(','));
  return [...summary, ['detail', ...header].join(','), ...data.map((row) => `detail,${row}`)].join('\n') + '\n';
}

async function main() {
  const args = parseShadowArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const report = await runAttendancePolicyShadow((text, values) => pool.query(text, [...values]), args.from, args.to);
    process.stdout.write(serializeShadowRows(report, args.format));
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
