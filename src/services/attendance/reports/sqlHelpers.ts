/**
 * Shared $N-bound WHERE-builder helpers for report SQL.
 *
 * Reports each build their own WHERE / GROUP BY clauses, but they all
 * need the same scope-by-staff and date-range building blocks. Keeping
 * them in one place avoids drift when a future report forgets the
 * scope clause.
 */

export interface ParamBuilder {
  params: unknown[];
  /** Push a value onto `params` and return its `$N` placeholder. */
  next: (v: unknown) => string;
}

export function makeParamBuilder(): ParamBuilder {
  const params: unknown[] = [];
  return {
    params,
    next(v: unknown) {
      params.push(v);
      return `$${params.length}`;
    },
  };
}

export interface BaseFilterArgs {
  pb: ParamBuilder;
  scopedStaffIds: string[] | null;
  /** Postgres column reference for the staff_id column in the from/join. */
  staffIdRef: string;
  /** Postgres column reference for the work_date column. */
  workDateRef?: string;
  dateFrom?: string;
  dateTo?: string;
  departments?: string[];
  /** Reference for the staff department text — only set if the FROM table joins staff. */
  deptRef?: string;
  siteIds?: string[];
  /** Reference for site_geofence_id on attendance_entries. */
  siteRef?: string;
  /** Reference for the staff active flag — when set, only-active is enforced. */
  activeStaffRefs?: { isActive: string; endDate: string };
}

/**
 * Build a base WHERE clause covering scope, date range, departments, and
 * "only active staff". Returns the SQL fragment (no leading WHERE) plus
 * the populated param array. Always returns at least one predicate so
 * callers can safely inline `WHERE ${text}`.
 */
export function buildBaseWhere(args: BaseFilterArgs): string {
  const { pb } = args;
  const parts: string[] = ['TRUE'];
  if (args.scopedStaffIds !== null) {
    parts.push(`${args.staffIdRef} = ANY(${pb.next(args.scopedStaffIds)}::uuid[])`);
  }
  if (args.workDateRef && args.dateFrom) {
    parts.push(`${args.workDateRef} >= ${pb.next(args.dateFrom)}::date`);
  }
  if (args.workDateRef && args.dateTo) {
    parts.push(`${args.workDateRef} <= ${pb.next(args.dateTo)}::date`);
  }
  if (args.deptRef && args.departments && args.departments.length > 0) {
    parts.push(`${args.deptRef} = ANY(${pb.next(args.departments)}::text[])`);
  }
  if (args.activeStaffRefs) {
    const { isActive, endDate } = args.activeStaffRefs;
    parts.push(`(${isActive} = true OR ${isActive} IS NULL) AND ${endDate} IS NULL`);
  }
  return parts.join(' AND ');
}
