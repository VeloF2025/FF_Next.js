import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  parseOperationFilters,
  serializeOperationFilters,
  type OperationFilters,
} from './operationFilters';
import { isCurrentOperationDate } from './useOperationalOverview';

const FILTER_KEYS: Array<keyof OperationFilters> = [
  'projectId', 'staffId', 'siteId', 'workDate', 'asOf', 'status', 'group', 'evidence', 'visibility',
];

function sastDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function datedFilters(filters: OperationFilters, workDate: string, now: Date): OperationFilters {
  const asOf = isCurrentOperationDate(workDate, now)
    ? now.toISOString() : new Date(`${workDate}T23:59:59.999+02:00`).toISOString();
  return { ...filters, workDate, asOf, visibility: filters.visibility ?? 'all' };
}

function filtersFromPath(path: string, now = new Date()): OperationFilters {
  const query = path.includes('?') ? path.slice(path.indexOf('?') + 1).split('#')[0] : '';
  const source = new URLSearchParams(query);
  const known = new URLSearchParams();
  for (const key of FILTER_KEYS) for (const value of source.getAll(key)) known.append(key, value);
  try {
    const parsed = parseOperationFilters(known);
    return datedFilters(parsed, parsed.workDate ?? sastDate(now), now);
  } catch {
    return datedFilters({}, sastDate(now), now);
  }
}

function initialFilters(now = new Date()): OperationFilters {
  return datedFilters({}, sastDate(now), now);
}

function replaceLocation(filters: OperationFilters, replace: boolean): void {
  const query = serializeOperationFilters(filters);
  const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history[replace ? 'replaceState' : 'pushState']({}, '', next);
}

export function useMapOperationFilters() {
  const router = useRouter();
  const [filters, setFilters] = useState<OperationFilters>(initialFilters);
  const [initialized, setInitialized] = useState(false);
  const currentFilters = useRef(filters);
  const change = useCallback((next: OperationFilters, replace = false) => {
    currentFilters.current = next;
    replaceLocation(next, replace);
    setFilters(next);
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    const navigate = (path: string) => {
      const next = filtersFromPath(path);
      currentFilters.current = next;
      replaceLocation(next, true);
      setFilters(next);
      setInitialized(true);
    };
    navigate(router.asPath);
    const popstate = () => navigate(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    window.addEventListener('popstate', popstate);
    return () => window.removeEventListener('popstate', popstate);
  }, [router.asPath, router.isReady]);

  return { change, currentFilters, filters, initialized };
}
