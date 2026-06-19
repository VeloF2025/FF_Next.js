/**
 * Pulse · Search — public query facades.
 *
 * `runSearch` and `runSearchForExport` are the two public entry points.
 * They build scope parts, short-circuit on empty scope, and delegate
 * to the individual query runners in `queryRunners.ts`.
 *
 * Filter, scope, and sort are pre-validated by the parse* helpers — this
 * module does no further validation and trusts its inputs.
 */

import { effectiveStaffIds } from './scope';
import { runCountQuery, runTotalsQuery, runRowsQuery } from './queryRunners';
import { MAX_TOTAL_ROWS } from './types';
import type {
  SearchFilters,
  SearchPagination,
  SearchSort,
  SearchRow,
  SearchTotals,
  ScopeNote,
  ResolvedScope,
} from './types';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface ScopeParts {
  hasAnyStaff: boolean;
  scopedStaffIds: string[] | null;
}

function buildScopeParts(filters: SearchFilters, scope: ResolvedScope): ScopeParts {
  const ids = effectiveStaffIds(filters, scope);
  if (ids === null) return { hasAnyStaff: true, scopedStaffIds: null };
  return { hasAnyStaff: ids.length > 0, scopedStaffIds: ids };
}

const EMPTY_TOTALS: SearchTotals = {
  rowCount: 0,
  distinctStaffCount: 0,
  totalRegularHrs: 0,
  totalOvertimeHrs: 0,
  totalSundayHrs: 0,
  totalHolidayHrs: 0,
  totalNightHrs: 0,
  totalWageCents: 0,
  totalExceptionsCount: 0,
};

// ---------------------------------------------------------------------------
// Public facades
// ---------------------------------------------------------------------------

/**
 * Run the paginated search. Returns rows + totals strip + scope note.
 */
export async function runSearch(opts: {
  filters: SearchFilters;
  scope: ResolvedScope;
  pagination: SearchPagination;
  sort: SearchSort;
}): Promise<{
  rows: SearchRow[];
  totals: SearchTotals;
  scopeNote: ScopeNote;
  pagination: { page: number; pageSize: number; totalRows: number; hasMore: boolean };
}> {
  const { filters, scope, pagination, sort } = opts;
  const { hasAnyStaff, scopedStaffIds } = buildScopeParts(filters, scope);

  if (!hasAnyStaff) {
    return {
      rows: [],
      totals: EMPTY_TOTALS,
      scopeNote: scope.note,
      pagination: { ...pagination, totalRows: 0, hasMore: false },
    };
  }

  const offset = (pagination.page - 1) * pagination.pageSize;
  const limit = Math.min(pagination.pageSize, MAX_TOTAL_ROWS);
  const totalRows = await runCountQuery(filters, scopedStaffIds);

  if (totalRows === 0) {
    return {
      rows: [],
      totals: EMPTY_TOTALS,
      scopeNote: scope.note,
      pagination: { ...pagination, totalRows: 0, hasMore: false },
    };
  }

  const [rows, totals] = await Promise.all([
    runRowsQuery(filters, scopedStaffIds, sort, offset, limit),
    runTotalsQuery(filters, scopedStaffIds),
  ]);

  return {
    rows,
    totals,
    scopeNote: scope.note,
    pagination: {
      ...pagination,
      totalRows,
      hasMore: offset + rows.length < totalRows,
    },
  };
}

/**
 * Variant of runSearch for export — no pagination, returns up to
 * MAX_TOTAL_ROWS rows. The export endpoint streams to XLSX/CSV; capping
 * at 5000 keeps memory bounded (FR-REPORT-COM-03).
 */
export async function runSearchForExport(opts: {
  filters: SearchFilters;
  scope: ResolvedScope;
  sort: SearchSort;
}): Promise<{
  rows: SearchRow[];
  totals: SearchTotals;
  scopeNote: ScopeNote;
  rowsTruncated: boolean;
}> {
  const { filters, scope, sort } = opts;
  const { hasAnyStaff, scopedStaffIds } = buildScopeParts(filters, scope);

  if (!hasAnyStaff) {
    return { rows: [], totals: EMPTY_TOTALS, scopeNote: scope.note, rowsTruncated: false };
  }

  const totalRows = await runCountQuery(filters, scopedStaffIds);
  const [rows, totals] = await Promise.all([
    runRowsQuery(filters, scopedStaffIds, sort, 0, MAX_TOTAL_ROWS),
    runTotalsQuery(filters, scopedStaffIds),
  ]);
  return { rows, totals, scopeNote: scope.note, rowsTruncated: totalRows > MAX_TOTAL_ROWS };
}
