/**
 * Shared filter state + query-string builder for the snag Reports tab.
 * Extracted so fast-refresh is preserved in the component files.
 */

export type DateField = 'opened' | 'resolved';
export type HasPhotos = '' | 'yes' | 'no';

export interface ReportFilterState {
  dateFrom: string;
  dateTo: string;
  dateField: DateField;
  projectId: string;
  status: string[];
  category: string[];
  severity: string[];
  assignedTo: string[];
  zoneNo: number[];
  ponNo: number[];
  hasPhotos: HasPhotos;
  minAgeDays: string;
}

export function emptyFilters(): ReportFilterState {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    dateFrom: monthAgo, dateTo: today, dateField: 'opened',
    projectId: '', status: [], category: [], severity: [],
    assignedTo: [], zoneNo: [], ponNo: [],
    hasPhotos: '', minAgeDays: '',
  };
}

export function buildReportQuery(f: ReportFilterState): string {
  const qs = new URLSearchParams();
  qs.set('date_from', f.dateFrom);
  qs.set('date_to', f.dateTo);
  qs.set('date_field', f.dateField);
  if (f.projectId)                   qs.set('project_id', f.projectId);
  if (f.status.length > 0)           qs.set('status', f.status.join(','));
  if (f.category.length > 0)         qs.set('category', f.category.join(','));
  if (f.severity.length > 0)         qs.set('severity', f.severity.join(','));
  if (f.assignedTo.length > 0)       qs.set('assigned_to', f.assignedTo.join(','));
  if (f.zoneNo.length > 0)           qs.set('zone_no', f.zoneNo.join(','));
  if (f.ponNo.length > 0)            qs.set('pon_no', f.ponNo.join(','));
  if (f.hasPhotos)                   qs.set('has_photos', f.hasPhotos);
  if (f.minAgeDays && Number(f.minAgeDays) >= 0) qs.set('min_age_days', f.minAgeDays);
  return qs.toString();
}
