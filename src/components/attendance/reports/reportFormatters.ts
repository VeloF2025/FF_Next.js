/**
 * Pulse · Reports — shared cell formatters and form helpers used by the
 * `[slug].tsx` page and its subcomponents. Keeping these here means the
 * page stays under the 300-line CLAUDE.md ceiling and the formatters can
 * be unit-tested without dragging the whole page in.
 */

import type { ReportColumn, ReportDef, ReportSlug } from '@/services/attendance/reports/types';

export interface ReportFormState {
  month: string;
  dateRange: 'last_30d' | 'last_12_weeks' | 'this_month' | 'last_month' | 'custom';
  dateFrom: string;
  dateTo: string;
  departments: string;
  siteIds: string;
  staffIds: string;
  groupBy: string;
}

export function todaySast(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function lastCompletedMonthSast(): string {
  const today = todaySast();
  const [y, m] = today.slice(0, 7).split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Build the API querystring for a given report slug + form state. */
export function buildQuery(slug: ReportSlug, def: ReportDef, form: ReportFormState): URLSearchParams {
  const q = new URLSearchParams({ slug });
  for (const inp of def.inputs) {
    switch (inp.kind) {
      case 'month':
        if (form.month) q.set('month', form.month);
        break;
      case 'date_range':
        if (form.dateRange !== 'custom') {
          q.set('dateRange', form.dateRange);
        } else {
          if (form.dateFrom) q.set('dateFrom', form.dateFrom);
          if (form.dateTo) q.set('dateTo', form.dateTo);
        }
        break;
      case 'departments_text':
        if (form.departments.trim()) q.set('departments', form.departments.trim());
        break;
      case 'sites_text':
        if (form.siteIds.trim()) q.set('siteIds', form.siteIds.trim());
        break;
      case 'staff_ids_text':
        if (form.staffIds.trim()) q.set('staffIds', form.staffIds.trim());
        break;
      case 'group_by':
        if (form.groupBy) q.set('groupBy', form.groupBy);
        break;
    }
  }
  return q;
}

/** Render a cell value for the on-screen table (XLSX shaping is server-side). */
export function fmtCell(v: unknown, col: ReportColumn): string {
  if (v === undefined || v === null) return '—';
  if (col.format === 'currency_rand' && typeof v === 'number') {
    return v.toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' });
  }
  if (col.format === 'integer' && typeof v === 'number') {
    return v.toLocaleString('en-ZA');
  }
  if (col.format === 'number' && typeof v === 'number') {
    return v.toFixed(2);
  }
  if (typeof v === 'number') return String(v);
  return String(v);
}
