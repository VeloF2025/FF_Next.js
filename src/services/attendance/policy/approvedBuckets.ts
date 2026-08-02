import type { AttendanceClassification } from './types';

export interface ApprovedAttendanceBuckets {
  regular: number;
  overtime: number;
  sunday: number;
  holiday: number;
  leave: number;
  unpaid: number;
}

export class ApprovedBucketInvariantError extends Error {
  constructor(message = 'Approved attendance buckets contradict the attendance classification') {
    super(message);
    this.name = 'ApprovedBucketInvariantError';
  }
}

/**
 * SQL equivalent of assertApprovedBucketInvariant. The alias is a trusted,
 * hard-coded identifier supplied by the caller, never request data.
 */
export function approvedBucketInvariantSql(alias: string): string {
  const regular = `${alias}.approved_regular_hrs`;
  const overtime = `${alias}.approved_overtime_hrs`;
  const sunday = `${alias}.approved_sunday_hrs`;
  const holiday = `${alias}.approved_holiday_hrs`;
  const leave = `${alias}.leave_hrs`;
  const unpaid = `${alias}.unpaid_hrs`;
  const values = [regular, overtime, sunday, holiday, leave, unpaid];
  const zero = (items: string[]): string => items.map((item) => `${item} = 0`).join(' AND ');
  return `
    ${values.map((value) => `${value} IS NOT NULL AND ${value} >= 0`).join(' AND ')}
    AND ${overtime} <= 15
    AND (${values.join(' + ')}) <= 24
    AND CASE ${alias}.attendance_classification
      WHEN 'approved_leave' THEN ${leave} > 0 AND ${zero([regular, overtime, sunday, holiday, unpaid])}
      WHEN 'sick_leave' THEN ${leave} > 0 AND ${zero([regular, overtime, sunday, holiday, unpaid])}
      WHEN 'site_shutdown_weather' THEN ${regular} > 0 AND ${zero([overtime, sunday, holiday, leave, unpaid])}
      WHEN 'public_holiday' THEN ${holiday} > 0 AND ${zero([regular, overtime, sunday, leave, unpaid])}
      WHEN 'unauthorised_absence' THEN ${unpaid} > 0 AND ${zero([regular, overtime, sunday, holiday, leave])}
      ELSE ${alias}.attendance_classification IS NULL AND
        ${leave} = 0 AND ${unpaid} = 0 AND
        ((CASE WHEN ${regular} > 0 OR ${overtime} > 0 THEN 1 ELSE 0 END) +
         (CASE WHEN ${sunday} > 0 THEN 1 ELSE 0 END) +
         (CASE WHEN ${holiday} > 0 THEN 1 ELSE 0 END)) <= 1
    END`;
}

export function assertApprovedBucketInvariant(
  classification: AttendanceClassification | null,
  buckets: ApprovedAttendanceBuckets,
): void {
  const values = Object.values(buckets);
  if (values.some((value) => !Number.isFinite(value) || value < 0) ||
      buckets.overtime > 15 || values.some((value) => value > 24) ||
      values.reduce((sum, value) => sum + value, 0) > 24) {
    throw new ApprovedBucketInvariantError('Approved attendance buckets must fit one physical day');
  }

  const none = (...valuesToCheck: number[]): boolean => valuesToCheck.every((value) => value === 0);
  const ordinary = buckets.regular > 0 || buckets.overtime > 0;
  const workedFamilies = Number(ordinary) + Number(buckets.sunday > 0) + Number(buckets.holiday > 0);
  let valid = false;

  if (classification === null) {
    valid = workedFamilies <= 1 && none(buckets.leave, buckets.unpaid);
  } else if (classification === 'approved_leave' || classification === 'sick_leave') {
    valid = buckets.leave > 0 && none(
      buckets.regular, buckets.overtime, buckets.sunday, buckets.holiday, buckets.unpaid,
    );
  } else if (classification === 'site_shutdown_weather') {
    valid = buckets.regular > 0 && none(
      buckets.overtime, buckets.sunday, buckets.holiday, buckets.leave, buckets.unpaid,
    );
  } else if (classification === 'public_holiday') {
    valid = buckets.holiday > 0 && none(
      buckets.regular, buckets.overtime, buckets.sunday, buckets.leave, buckets.unpaid,
    );
  } else if (classification === 'unauthorised_absence') {
    valid = buckets.unpaid > 0 && none(
      buckets.regular, buckets.overtime, buckets.sunday, buckets.holiday, buckets.leave,
    );
  }

  if (!valid) throw new ApprovedBucketInvariantError();
}
