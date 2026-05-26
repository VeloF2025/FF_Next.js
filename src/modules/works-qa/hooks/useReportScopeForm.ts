/**
 * useReportScopeForm — pure React state hook for SnagReportScopeDialog.
 * Seeds scope/zones/pons/poles from URL context. Exposes validate() and
 * toSubmitBody() for POST /api/snags/reports-scope.
 * Dates: last 30 days, ISO YYYY-MM-DD. Severity: all three. Categories: all four.
 */

import { useMemo, useState } from 'react';

export type ScopeKind = 'pole' | 'pon' | 'zone';
/** Works QA report split: civil-only, optical-only, or every discipline. */
export type ReportDiscipline = 'civil' | 'optical' | 'all';

export interface UrlContext {
  zone_no?: number;
  pon_no?: number;
  pole_id?: string;
}

/** Shape sent to POST /api/snags/reports-scope. */
export interface ScopeSubmitBody {
  project_id: string;
  scope: ScopeKind;
  zones: number[];
  pons: number[];
  poles: string[];
  from_date: string;
  to_date: string;
  severities: string[];
  categories: string[];
  discipline: ReportDiscipline;
}

function defaultScope(ctx: UrlContext): ScopeKind {
  if (ctx.pole_id !== undefined) return 'pole';
  if (ctx.pon_no !== undefined) return 'pon';
  return 'zone';
}

function isoMinusDays(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

export function useReportScopeForm(ctx: UrlContext) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [scope, setScope]         = useState<ScopeKind>(() => defaultScope(ctx));
  const [zones, setZones]         = useState<number[]>(ctx.zone_no !== undefined ? [ctx.zone_no] : []);
  const [pons, setPons]           = useState<number[]>(ctx.pon_no  !== undefined ? [ctx.pon_no]  : []);
  const [poles, setPoles]         = useState<string[]>(ctx.pole_id !== undefined ? [ctx.pole_id] : []);
  const [fromDate, setFromDate]   = useState<string>(isoMinusDays(30));
  const [toDate, setToDate]       = useState<string>(isoMinusDays(0));
  const [severities, setSeverities] = useState<string[]>(['minor', 'major', 'critical']);
  // Works QA report split. 'all' preserves the original (every-discipline) report.
  const [discipline, setDiscipline] = useState<ReportDiscipline>('all');
  // Empty = "all categories" (the API coerces [] → no category filter). Chip
  // options are loaded dynamically from the project's real snag categories, so
  // we cannot seed a meaningful default here — and seeding the old hardcoded
  // list (photo_quality/…) matched no rows and broke every report.
  const [categories, setCategories] = useState<string[]>([]);

  const validate = (): string | null => {
    if (!projectId)                            return 'projectId is required';
    if (scope === 'pole' && poles.length === 0) return 'poles[] required when scope=pole';
    if (scope === 'pon'  && pons.length  === 0) return 'pons[] required when scope=pon';
    if (scope === 'zone' && zones.length === 0) return 'zones[] required when scope=zone';
    if (fromDate > toDate)                     return 'fromDate must be <= toDate';
    return null;
  };

  // Only the dimension matching the active scope is sent as a filter. In PON or
  // pole scope the Zones picker is merely a client-side aid to narrow the PON
  // list — sending those zones too would AND them in and silently drop every
  // snag whose zone differs (e.g. PON 267 lives in zone 24, so picking zone 34
  // + PON 267 matched nothing). Non-scope dimensions go out as [] → the API
  // coerces them to "no filter".
  const toSubmitBody = (): ScopeSubmitBody => ({
    project_id: projectId!,
    scope,
    zones: scope === 'zone' ? zones : [],
    pons:  scope === 'pon'  ? pons  : [],
    poles: scope === 'pole' ? poles : [],
    from_date: fromDate,
    to_date: toDate,
    severities,
    categories,
    discipline,
  });

  return useMemo(
    () => ({
      projectId, setProjectId,
      scope, setScope,
      zones, setZones,
      pons, setPons,
      poles, setPoles,
      fromDate, setFromDate,
      toDate, setToDate,
      severities, setSeverities,
      categories, setCategories,
      discipline, setDiscipline,
      validate,
      toSubmitBody,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, scope, zones, pons, poles, fromDate, toDate, severities, categories, discipline],
  );
}
