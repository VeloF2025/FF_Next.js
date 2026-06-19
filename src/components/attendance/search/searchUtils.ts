/**
 * URL ↔ FormState serialisation and preset JSON helpers for Pulse · Search.
 *
 * These pure functions have no side-effects and no React imports, making them
 * testable in isolation. They are shared between the shell page and any future
 * deep-link utilities.
 */

import {
  DEFAULT_FORM,
  DATE_PRESETS,
  PRESET_FILTER_VERSION,
  type FormState,
  type PresetFilterV1,
} from './types';

// ---------------------------------------------------------------------------
// URL → FormState
// ---------------------------------------------------------------------------

export function parseFormFromQuery(
  query: Record<string, string | string[] | undefined>
): FormState {
  const get = (k: string) => {
    const v = query[k];
    if (Array.isArray(v)) return v.join(',');
    return typeof v === 'string' ? v : '';
  };
  const getArr = (k: string): string[] => {
    const v = get(k);
    return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
  };
  const getNumArr = (k: string): number[] =>
    getArr(k).map((s) => Number.parseInt(s, 10)).filter((n) => Number.isFinite(n));
  const getBool = (k: string): boolean => {
    const v = get(k);
    return v === '1' || v.toLowerCase() === 'true';
  };
  const dr = get('dateRange');
  const dateRange = (DATE_PRESETS.find((p) => p.value === dr)?.value ?? 'this_week') as FormState['dateRange'];
  return {
    dateRange,
    dateFrom: get('dateFrom'),
    dateTo: get('dateTo'),
    departments: get('departments'),
    exceptionKinds: getArr('exceptionKinds'),
    daysOfWeek: getNumArr('daysOfWeek'),
    onlyWithOt: getBool('onlyWithOt'),
    onlySundayHoliday: getBool('onlySundayHoliday'),
    onlyActive: get('onlyActive') === '' ? true : getBool('onlyActive'),
    staffIds: get('staffIds'),
    siteIds: get('siteIds'),
  };
}

// ---------------------------------------------------------------------------
// FormState → URL query params (omits defaults for readable URLs)
// ---------------------------------------------------------------------------

export function formToQuery(form: FormState): Record<string, string> {
  const out: Record<string, string> = {};
  if (form.dateRange !== 'this_week') out.dateRange = form.dateRange;
  if (form.dateRange === 'custom') {
    if (form.dateFrom) out.dateFrom = form.dateFrom;
    if (form.dateTo) out.dateTo = form.dateTo;
  }
  if (form.departments.trim()) out.departments = form.departments.trim();
  if (form.exceptionKinds.length > 0) out.exceptionKinds = form.exceptionKinds.join(',');
  if (form.daysOfWeek.length > 0) out.daysOfWeek = form.daysOfWeek.join(',');
  if (form.onlyWithOt) out.onlyWithOt = '1';
  if (form.onlySundayHoliday) out.onlySundayHoliday = '1';
  if (!form.onlyActive) out.onlyActive = '0';
  if (form.staffIds.trim()) out.staffIds = form.staffIds.trim();
  if (form.siteIds.trim()) out.siteIds = form.siteIds.trim();
  return out;
}

// ---------------------------------------------------------------------------
// FormState ↔ Preset JSON
// ---------------------------------------------------------------------------

export function formToFilterJson(form: FormState): PresetFilterV1 {
  return { v: PRESET_FILTER_VERSION, ...form };
}

export function filterJsonToForm(filter: unknown): FormState {
  if (typeof filter !== 'object' || filter === null) return DEFAULT_FORM;
  const f = filter as Partial<FormState>;
  return {
    dateRange: (DATE_PRESETS.find((p) => p.value === f.dateRange)?.value ?? DEFAULT_FORM.dateRange) as FormState['dateRange'],
    dateFrom: typeof f.dateFrom === 'string' ? f.dateFrom : DEFAULT_FORM.dateFrom,
    dateTo: typeof f.dateTo === 'string' ? f.dateTo : DEFAULT_FORM.dateTo,
    departments: typeof f.departments === 'string' ? f.departments : DEFAULT_FORM.departments,
    exceptionKinds: Array.isArray(f.exceptionKinds)
      ? f.exceptionKinds.filter((x): x is string => typeof x === 'string')
      : DEFAULT_FORM.exceptionKinds,
    daysOfWeek: Array.isArray(f.daysOfWeek)
      ? f.daysOfWeek.filter((x): x is number => typeof x === 'number')
      : DEFAULT_FORM.daysOfWeek,
    onlyWithOt: typeof f.onlyWithOt === 'boolean' ? f.onlyWithOt : DEFAULT_FORM.onlyWithOt,
    onlySundayHoliday: typeof f.onlySundayHoliday === 'boolean' ? f.onlySundayHoliday : DEFAULT_FORM.onlySundayHoliday,
    onlyActive: typeof f.onlyActive === 'boolean' ? f.onlyActive : DEFAULT_FORM.onlyActive,
    staffIds: typeof f.staffIds === 'string' ? f.staffIds : DEFAULT_FORM.staffIds,
    siteIds: typeof f.siteIds === 'string' ? f.siteIds : DEFAULT_FORM.siteIds,
  };
}
