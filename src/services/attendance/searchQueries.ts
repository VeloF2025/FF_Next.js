/**
 * Pulse · Search — barrel re-export (PRD-061 Phase A).
 *
 * This file is the public surface that existing callers import from:
 *   - `pages/api/staff/attendance-search.ts`
 *   - `pages/api/staff/attendance-search-export.ts`
 *   - `src/lib/staff/__tests__/hrVisibility.audit.test.ts`
 *
 * All implementation has been split into focused modules under
 * `./search/` to keep each file under 300 lines (audit issue #2011).
 * Behaviour is identical — this barrel is a transparent re-export.
 */

// Rule P surface: approvedAccountPredicate is applied in ./search/buildWhere.ts
// (this barrel is the surface the hrVisibility audit test scans — see
// src/lib/staff/__tests__/hrVisibility.audit.test.ts RULE_P_SURFACES).

// Types and constants
export type {
  RawQuery,
  SearchFilters,
  SearchPagination,
  SearchSort,
  DatePreset,
  ScopeNote,
  ResolvedScope,
  SearchRow,
  SearchTotals,
} from './search/types';
export {
  MAX_TOTAL_ROWS,
  MAX_DATE_RANGE_DAYS,
  DEFAULT_PAGE_SIZE,
  ValidationError,
} from './search/types';

// Parse functions
export {
  parseFilters,
  parseSort,
  parsePagination,
  resolveDatePreset,
} from './search/parse';

// Scope resolution
export { resolveScope } from './search/scope';

// Query runners
export {
  runSearch,
  runSearchForExport,
} from './search/runQueries';
