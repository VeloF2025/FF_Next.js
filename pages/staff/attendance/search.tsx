/**
 * /staff/attendance/search — Pulse · Search (PRD-061 Phase A + B).
 *
 * Cross-staff, cross-period attendance search:
 *   - Date preset chips (today / yesterday / this_week / last_week /
 *     this_month / last_month / last_7d / last_30d / custom)
 *   - Department, exception kind, day-of-week, OT/Sunday/active toggles
 *   - Aggregate strip (rows / staff / hours / OT / wage / exceptions)
 *   - Paginated results table (50 per page) with sortable columns
 *   - XLSX + CSV export buttons
 *   - URL round-trip: every filter is a querystring param so a result is
 *     a shareable link (within scope; the recipient still gets data
 *     filtered to their own scope on the server).
 *   - Phase B: per-user saved-filter presets — load, save, set default,
 *     rename, delete. Default auto-loads on cold open (when no filters
 *     are present in the URL); a deep-link still wins over the default.
 *
 * Filters that the API accepts but the UI does not yet expose pickers
 * for (staff IDs, site IDs, project IDs, lateness threshold) round-trip
 * via the URL untouched — they are documented in the PRD as Phase C
 * polish that adds typeahead pickers; advanced users can paste UUIDs
 * into the URL and the server respects them.
 *
 * Backed by GET /api/staff/attendance-search,
 * GET /api/staff/attendance-search-export, and the CRUD endpoint
 * /api/staff/attendance-presets.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Download, FileText, RefreshCw } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';

// Keep these mirrors of the server-side enums small — the URL is the contract.
const DATE_PRESETS = [
  { value: 'today',       label: 'Today' },
  { value: 'yesterday',   label: 'Yesterday' },
  { value: 'this_week',   label: 'This week' },
  { value: 'last_week',   label: 'Last week' },
  { value: 'last_7d',     label: 'Last 7 days' },
  { value: 'this_month',  label: 'This month' },
  { value: 'last_month',  label: 'Last month' },
  { value: 'last_30d',    label: 'Last 30 days' },
  { value: 'custom',      label: 'Custom' },
] as const;

type DatePreset = (typeof DATE_PRESETS)[number]['value'];

const EXCEPTION_KINDS = [
  { value: 'missing_clock_out',   label: 'Missing clock-out' },
  { value: 'geofence_mismatch',   label: 'Geofence mismatch' },
  { value: 'clock_skew',          label: 'Clock skew' },
  { value: 'out_of_hours',        label: 'Out of hours' },
  { value: 'manual_override',     label: 'Manual override' },
  { value: 'duplicate_entry',     label: 'Duplicate entry' },
  { value: 'vehicle_gps_mismatch', label: 'Vehicle GPS mismatch' },
  { value: 'forgotten_clock_out_retro', label: 'Forgotten clock-out (retro)' },
] as const;

const DAYS_OF_WEEK = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

type SortField = 'work_date' | 'full_name' | 'hours' | 'overtime' | 'department';
type SortDir = 'asc' | 'desc';

interface SearchRow {
  staff_id: string;
  employee_id: string | null;
  full_name: string;
  department: string | null;
  work_date: string;
  regular_hrs: number;
  overtime_hrs: number;
  sunday_hrs: number;
  holiday_hrs: number;
  night_hrs: number;
  wage_amount_cents: number | null;
  exceptions_count: number;
  exception_kinds: string[];
  first_clock_in_at: string | null;
  last_clock_out_at: string | null;
  primary_site_name: string | null;
  primary_site_id: string | null;
}

interface SearchTotals {
  rowCount: number;
  distinctStaffCount: number;
  totalRegularHrs: number;
  totalOvertimeHrs: number;
  totalSundayHrs: number;
  totalHolidayHrs: number;
  totalNightHrs: number;
  totalWageCents: number;
  totalExceptionsCount: number;
}

type ScopeNote =
  | { kind: 'orgwide' }
  | { kind: 'scoped'; staffCount: number }
  | { kind: 'no_scope'; reason: string };

interface SearchResponse {
  rows: SearchRow[];
  totals: SearchTotals;
  scopeNote: ScopeNote;
  pagination: { page: number; pageSize: number; totalRows: number; hasMore: boolean };
}

interface FormState {
  dateRange: DatePreset;
  dateFrom: string;
  dateTo: string;
  departments: string;        // comma-separated, free-text
  exceptionKinds: string[];
  daysOfWeek: number[];
  onlyWithOt: boolean;
  onlySundayHoliday: boolean;
  onlyActive: boolean;
  staffIds: string;           // comma-separated UUIDs (advanced)
  siteIds: string;            // comma-separated UUIDs (advanced)
}

const DEFAULT_FORM: FormState = {
  dateRange: 'this_week',
  dateFrom: '',
  dateTo: '',
  departments: '',
  exceptionKinds: [],
  daysOfWeek: [],
  onlyWithOt: false,
  onlySundayHoliday: false,
  onlyActive: true,
  staffIds: '',
  siteIds: '',
};

function parseFormFromQuery(query: Record<string, string | string[] | undefined>): FormState {
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
  const dateRange: DatePreset = (DATE_PRESETS.find((p) => p.value === dr)?.value ?? 'this_week') as DatePreset;
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

/**
 * Persisted preset shape. The server stores `filter_json` opaquely; this
 * page is responsible for serialising/deserialising it. The `v` field
 * lets us migrate the shape forward without invalidating presets that
 * users have saved at v1.
 */
const PRESET_FILTER_VERSION = 1;
interface PresetFilterV1 extends FormState { v: 1 }

interface PresetDto {
  id: string;
  name: string;
  filter: PresetFilterV1 | Record<string, unknown>;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

function formToFilterJson(form: FormState): PresetFilterV1 {
  return { v: PRESET_FILTER_VERSION, ...form };
}

/**
 * Round a stored preset back into FormState. Unknown fields are dropped,
 * missing fields fall back to DEFAULT_FORM. A future v2 shape can branch
 * on `v` here.
 */
function filterJsonToForm(filter: unknown): FormState {
  if (typeof filter !== 'object' || filter === null) return DEFAULT_FORM;
  const f = filter as Partial<FormState>;
  return {
    dateRange: (DATE_PRESETS.find((p) => p.value === f.dateRange)?.value ?? DEFAULT_FORM.dateRange) as DatePreset,
    dateFrom: typeof f.dateFrom === 'string' ? f.dateFrom : DEFAULT_FORM.dateFrom,
    dateTo: typeof f.dateTo === 'string' ? f.dateTo : DEFAULT_FORM.dateTo,
    departments: typeof f.departments === 'string' ? f.departments : DEFAULT_FORM.departments,
    exceptionKinds: Array.isArray(f.exceptionKinds) ? f.exceptionKinds.filter((x): x is string => typeof x === 'string') : DEFAULT_FORM.exceptionKinds,
    daysOfWeek: Array.isArray(f.daysOfWeek) ? f.daysOfWeek.filter((x): x is number => typeof x === 'number') : DEFAULT_FORM.daysOfWeek,
    onlyWithOt: typeof f.onlyWithOt === 'boolean' ? f.onlyWithOt : DEFAULT_FORM.onlyWithOt,
    onlySundayHoliday: typeof f.onlySundayHoliday === 'boolean' ? f.onlySundayHoliday : DEFAULT_FORM.onlySundayHoliday,
    onlyActive: typeof f.onlyActive === 'boolean' ? f.onlyActive : DEFAULT_FORM.onlyActive,
    staffIds: typeof f.staffIds === 'string' ? f.staffIds : DEFAULT_FORM.staffIds,
    siteIds: typeof f.siteIds === 'string' ? f.siteIds : DEFAULT_FORM.siteIds,
  };
}

/**
 * Convert form state to a URL-safe querystring fragment. Empty defaults
 * are omitted so the URL stays readable when the user has barely
 * touched anything.
 */
function formToQuery(form: FormState): Record<string, string> {
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

function fmtHrs(n: number): string {
  return n.toFixed(2);
}
function fmtRand(cents: number): string {
  return (cents / 100).toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' });
}
function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  // Format in SAST so a supervisor sees the wall-clock time the staff
  // actually clocked, not whatever the browser locale is.
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Johannesburg',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}
function fmtWageCents(cents: number | null): string {
  return cents === null ? '—' : fmtRand(cents);
}

export default function PulseSearchPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  // `committedForm` is what the API actually queries on. Free-text inputs
  // only commit when the user clicks Search or hits Enter; chip/checkbox
  // toggles below commit synchronously. This avoids one fetch per keystroke
  // while typing in the dept / staff-IDs / site-IDs boxes.
  const [committedForm, setCommittedForm] = useState<FormState>(DEFAULT_FORM);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [sortField, setSortField] = useState<SortField>('work_date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLong, setConfirmLong] = useState(false);
  const [exportLoading, setExportLoading] = useState<'csv' | 'xlsx' | null>(null);
  const initialFromUrl = useRef(false);
  // Active fetch's AbortController — every new fetch aborts the previous one
  // so a slow "Civi" response can't overwrite the fast "Civil, Optical" one.
  const abortRef = useRef<AbortController | null>(null);

  // Phase B — saved filter presets (per-user).
  const [presets, setPresets] = useState<PresetDto[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [presetActionMsg, setPresetActionMsg] = useState<string | null>(null);
  const presetDidAutoLoad = useRef(false);

  // First mount: hydrate form state from the querystring so a deep-link is
  // the page's source of truth. Hydrates BOTH `form` and `committedForm` so
  // the first fetch uses the URL's filters without waiting for a manual click.
  useEffect(() => {
    if (!router.isReady || initialFromUrl.current) return;
    initialFromUrl.current = true;
    const hydrated = parseFormFromQuery(router.query as Record<string, string | string[] | undefined>);
    setForm(hydrated);
    setCommittedForm(hydrated);
    const p = Number.parseInt((router.query.page as string) ?? '1', 10);
    setPage(Number.isFinite(p) && p > 0 ? p : 1);
    const sf = (router.query.sortField as string) ?? 'work_date';
    const sd = (router.query.sortDir as string) ?? 'desc';
    setSortField((['work_date', 'full_name', 'hours', 'overtime', 'department'].includes(sf) ? sf : 'work_date') as SortField);
    setSortDir((['asc', 'desc'].includes(sd) ? sd : 'desc') as SortDir);
    setConfirmLong(router.query.confirmLongRange === '1');
  }, [router.isReady, router.query]);

  // ---------------------------------------------------------------------------
  // Phase B: presets — load on mount, auto-apply default on cold open.
  //
  // Cold open = the URL has zero filter params (`Object.keys(router.query)`
  // is empty after Next.js parses it). A deep-link MUST win over the
  // default — otherwise sharing a saved-search URL silently drops
  // whatever the recipient has starred. The `presetDidAutoLoad` ref
  // makes this a one-shot per session so a later Reset doesn't surprise
  // the user with the default jumping back in.
  // ---------------------------------------------------------------------------
  const loadPresets = useCallback(async (): Promise<PresetDto[]> => {
    setPresetsLoading(true);
    try {
      const res = await fetch('/api/staff/attendance-presets', { credentials: 'include' });
      const body = (await res.json()) as
        | { success: true; data: { presets: PresetDto[] } }
        | { success: false; error?: { message?: string } };
      if (!res.ok || !('success' in body) || !body.success) {
        log.warn('PulseSearch presets load failed', {
          status: res.status,
          message: 'success' in body && body.success === false ? body.error?.message : undefined,
        });
        return [];
      }
      setPresets(body.data.presets);
      return body.data.presets;
    } catch (err) {
      log.error('PulseSearch presets load network error', err instanceof Error ? { message: err.message } : { err });
      return [];
    } finally {
      setPresetsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!router.isReady || presetDidAutoLoad.current) return;
    presetDidAutoLoad.current = true;
    // Capture cold-open status SYNCHRONOUSLY before any await — the URL-sync
    // effect downstream pushes pageSize/sortField/sortDir into the URL on
    // first render, so by the time `loadPresets()` resolves `router.query`
    // is no longer empty. We commit to the verdict now.
    const urlIsCold = Object.keys(router.query).length === 0;
    void (async () => {
      const list = await loadPresets();
      if (!urlIsCold) return;
      const def = list.find((p) => p.is_default);
      if (!def) return;
      const fromPreset = filterJsonToForm(def.filter);
      setForm(fromPreset);
      setCommittedForm(fromPreset);
    })();
    // Intentionally NOT depending on router.query: the one-shot ref makes
    // this fire exactly once and we don't want a later URL change to
    // re-evaluate the (stale) urlIsCold above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, loadPresets]);

  const buildSearchUrl = useCallback(
    (overrides: Partial<{ page: number; sortField: SortField; sortDir: SortDir; confirmLongRange: boolean }> = {}) => {
      const q = new URLSearchParams(formToQuery(committedForm));
      const effPage = overrides.page ?? page;
      if (effPage !== 1) q.set('page', String(effPage));
      q.set('pageSize', String(pageSize));
      q.set('sortField', overrides.sortField ?? sortField);
      q.set('sortDir', overrides.sortDir ?? sortDir);
      if (overrides.confirmLongRange ?? confirmLong) q.set('confirmLongRange', '1');
      return q.toString();
    },
    [committedForm, page, pageSize, sortField, sortDir, confirmLong]
  );

  // Push the current filter state to the URL whenever the user changes the
  // form, page, or sort. This keeps the URL the source of truth so back/
  // forward navigation works and links are shareable (FR-SEARCH-10).
  //
  // Depend only on `router.asPath` (for the equality guard) and the
  // memoised builder — depending on `router` itself fires the effect twice
  // per filter change because Next mutates the object on every `replace`.
  useEffect(() => {
    if (!router.isReady || !initialFromUrl.current) return;
    const target = `/staff/attendance/search?${buildSearchUrl()}`;
    if (target !== router.asPath) {
      router.replace(target, undefined, { shallow: true }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.asPath, buildSearchUrl]);

  const runFetch = useCallback(async () => {
    if (!router.isReady) return;
    // Cancel any in-flight request so out-of-order responses can't overwrite
    // the latest result with a stale earlier one.
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/staff/attendance-search?${buildSearchUrl()}`, {
        credentials: 'include',
        signal: ctrl.signal,
      });
      const body = (await res.json()) as
        | { success: true; data: SearchResponse }
        | { success: false; error?: { message?: string } };
      if (!res.ok || !('success' in body) || !body.success) {
        const msg = (!body || 'success' in body && body.success === false ? body.error?.message : null) ?? 'Search failed.';
        setError(msg);
        setData(null);
        return;
      }
      setData(body.data);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      log.error('PulseSearch fetch failed', err instanceof Error ? { message: err.message } : { err });
      setError('Network error running the search.');
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
  }, [router.isReady, buildSearchUrl]);

  // Auto-fetch when the COMMITTED filter, page, or sort changes. Free-text
  // inputs are intentionally absent from this dep list — typing in the dept
  // / staffIds / siteIds boxes mutates `form` but not `committedForm`, so
  // the keystrokes don't fire fetches. Chip/checkbox toggles call
  // `setCommittedForm` synchronously and do trigger a fetch.
  useEffect(() => {
    runFetch();
  }, [runFetch]);

  const commitForm = useCallback(() => setCommittedForm(form), [form]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    commitForm();
  };

  const onReset = () => {
    setForm(DEFAULT_FORM);
    setCommittedForm(DEFAULT_FORM);
    setPage(1);
    setSortField('work_date');
    setSortDir('desc');
    setConfirmLong(false);
  };

  const onSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  // ---------------------------------------------------------------------------
  // Preset CRUD handlers — every action surfaces a one-line confirmation in
  // `presetActionMsg`. We don't toast: the message sits next to the dropdown
  // so it doesn't compete with the search-error region above the table.
  // ---------------------------------------------------------------------------
  const onSavePreset = async (name: string, setAsDefault: boolean) => {
    setPresetActionMsg(null);
    try {
      const res = await fetch('/api/staff/attendance-presets', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          filter: formToFilterJson(committedForm),
          is_default: setAsDefault,
        }),
      });
      const body = (await res.json()) as
        | { success: true; data: { preset: PresetDto } }
        | { success: false; error?: { message?: string } };
      if (!res.ok || !('success' in body) || !body.success) {
        const msg = 'success' in body && body.success === false ? body.error?.message : null;
        setPresetActionMsg(msg ?? 'Could not save preset.');
        return;
      }
      setPresetActionMsg(`Saved "${body.data.preset.name}".`);
      await loadPresets();
    } catch (err) {
      log.error('PulseSearch save preset failed', err instanceof Error ? { message: err.message } : { err });
      setPresetActionMsg('Network error saving preset.');
    }
  };

  const onApplyPreset = (preset: PresetDto) => {
    const next = filterJsonToForm(preset.filter);
    setForm(next);
    setCommittedForm(next);
    setPage(1);
    setPresetActionMsg(`Loaded "${preset.name}".`);
  };

  const onUpdatePreset = async (id: string, patch: Partial<{ name: string; is_default: boolean }>) => {
    setPresetActionMsg(null);
    try {
      const res = await fetch('/api/staff/attendance-presets', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setPresetActionMsg(body?.error?.message ?? 'Could not update preset.');
        return;
      }
      await loadPresets();
      setPresetActionMsg('Preset updated.');
    } catch (err) {
      log.error('PulseSearch update preset failed', err instanceof Error ? { message: err.message } : { err });
      setPresetActionMsg('Network error updating preset.');
    }
  };

  const onDeletePreset = async (preset: PresetDto) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete preset "${preset.name}"?`)) return;
    setPresetActionMsg(null);
    try {
      const res = await fetch(`/api/staff/attendance-presets?id=${encodeURIComponent(preset.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setPresetActionMsg(body?.error?.message ?? 'Could not delete preset.');
        return;
      }
      await loadPresets();
      setPresetActionMsg(`Deleted "${preset.name}".`);
    } catch (err) {
      log.error('PulseSearch delete preset failed', err instanceof Error ? { message: err.message } : { err });
      setPresetActionMsg('Network error deleting preset.');
    }
  };

  const onExport = async (format: 'csv' | 'xlsx') => {
    setExportLoading(format);
    try {
      const url = `/api/staff/attendance-search-export?format=${format}&${buildSearchUrl()}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        const body = await res.text();
        let message = 'Export failed.';
        try {
          const parsed = JSON.parse(body) as { error?: { message?: string } };
          if (parsed.error?.message) message = parsed.error.message;
        } catch {
          // body wasn't JSON; keep the generic message
        }
        setError(message);
        return;
      }
      const blob = await res.blob();
      const dispo = res.headers.get('Content-Disposition') ?? '';
      const m = dispo.match(/filename="?([^"]+)"?/);
      const filename = m?.[1] ?? `pulse-search.${format}`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      log.error('PulseSearch export failed', err instanceof Error ? { message: err.message } : { err });
      setError('Network error during export.');
    } finally {
      setExportLoading(null);
    }
  };

  const totals = data?.totals;
  const rows = data?.rows ?? [];
  const totalRows = data?.pagination.totalRows ?? 0;
  const lastPage = Math.max(1, Math.ceil(totalRows / pageSize));
  const scopeNote = data?.scopeNote;

  // Empty-state copy needs to distinguish "your scope returned no staff at
  // all" from "your filters matched nothing" (FR-SEARCH-12).
  const emptyMessage = useMemo(() => {
    if (!data) return null;
    if (rows.length > 0) return null;
    if (scopeNote?.kind === 'no_scope') {
      return scopeNote.reason;
    }
    if (scopeNote?.kind === 'scoped' && scopeNote.staffCount === 0) {
      return 'You have no staff in scope. Ask your administrator if this is unexpected.';
    }
    return 'No attendance rows match your filters. Try widening the date range or removing exception filters.';
  }, [data, rows.length, scopeNote]);

  return (
    <AppLayout>
      <AttendanceNav />
      <div className="px-6 py-6 max-w-7xl mx-auto">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Pulse · Search</h1>
            <p className="text-sm text-gray-500">
              Cross-staff, cross-period attendance search. Filters honour your supervisor scope.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runFetch}
              disabled={loading}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => onExport('xlsx')}
              disabled={exportLoading !== null || rows.length === 0}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {exportLoading === 'xlsx' ? 'Exporting…' : 'XLSX'}
            </button>
            <button
              type="button"
              onClick={() => onExport('csv')}
              disabled={exportLoading !== null || rows.length === 0}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-emerald-600 text-emerald-700 text-sm hover:bg-emerald-50 disabled:opacity-50"
            >
              <FileText className="h-4 w-4" />
              {exportLoading === 'csv' ? 'Exporting…' : 'CSV'}
            </button>
          </div>
        </header>

        <PresetsBar
          presets={presets}
          loading={presetsLoading}
          actionMsg={presetActionMsg}
          onSave={onSavePreset}
          onApply={onApplyPreset}
          onUpdate={onUpdatePreset}
          onDelete={onDeletePreset}
        />

        <FilterBar
          form={form}
          setForm={setForm}
          setCommittedForm={setCommittedForm}
          onSubmit={onSubmit}
          onReset={onReset}
          confirmLong={confirmLong}
          loading={loading}
        />

        {error && (
          <div role="alert" className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            {error}
            {/Date range spans .* days/.test(error) && (
              <button
                type="button"
                onClick={() => setConfirmLong(true)}
                className="ml-2 underline font-medium"
              >
                Run anyway
              </button>
            )}
          </div>
        )}

        {totals && <TotalsStrip totals={totals} scopeNote={scopeNote} />}

        <div className="mt-4 overflow-x-auto bg-white border border-gray-200 rounded-xl">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <SortableTh label="Date" field="work_date" current={sortField} dir={sortDir} onSort={onSort} />
                <SortableTh label="Staff" field="full_name" current={sortField} dir={sortDir} onSort={onSort} />
                <SortableTh label="Dept" field="department" current={sortField} dir={sortDir} onSort={onSort} />
                <Th>Site</Th>
                <Th>Clock-in</Th>
                <Th>Clock-out</Th>
                <SortableTh label="Hours" field="hours" current={sortField} dir={sortDir} onSort={onSort} numeric />
                <SortableTh label="OT" field="overtime" current={sortField} dir={sortDir} onSort={onSort} numeric />
                <Th numeric>Wage</Th>
                <Th>Exceptions</Th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-sm text-gray-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && emptyMessage && (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-sm text-gray-500">
                    {emptyMessage}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <ResultRow key={`${r.staff_id}|${r.work_date}`} row={r} />
              ))}
            </tbody>
          </table>
        </div>

        {totalRows > 0 && (
          <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
            <span>
              Showing {(page - 1) * pageSize + 1}
              –{Math.min(page * pageSize, totalRows)} of {totalRows.toLocaleString('en-ZA')} rows
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1 rounded border border-gray-300 disabled:opacity-50"
              >
                Previous
              </button>
              <span className="px-2">
                Page {page} of {lastPage}
              </span>
              <button
                type="button"
                disabled={page >= lastPage || loading}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 rounded border border-gray-300 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function PresetsBar({
  presets, loading, actionMsg, onSave, onApply, onUpdate, onDelete,
}: {
  presets: PresetDto[];
  loading: boolean;
  actionMsg: string | null;
  onSave: (name: string, setAsDefault: boolean) => void;
  onApply: (p: PresetDto) => void;
  onUpdate: (id: string, patch: Partial<{ name: string; is_default: boolean }>) => void;
  onDelete: (p: PresetDto) => void;
}) {
  const [showSave, setShowSave] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDefault, setDraftDefault] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const submitSave = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draftName.trim();
    if (trimmed.length < 1 || trimmed.length > 60) return;
    onSave(trimmed, draftDefault);
    setShowSave(false);
    setDraftName('');
    setDraftDefault(false);
  };

  return (
    <div className="mb-3 rounded-xl bg-white border border-gray-200 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-gray-500">Presets</span>

        {presets.length === 0 && !loading && (
          <span className="text-xs text-gray-500 italic">
            No saved presets yet — capture the current filter as a preset.
          </span>
        )}

        {presets.map((p) => (
          <div key={p.id} className="relative">
            <button
              type="button"
              onClick={() => onApply(p)}
              className={`px-3 py-1 rounded-full text-xs border ${
                p.is_default
                  ? 'bg-amber-50 border-amber-300 text-amber-800'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
              title={p.is_default ? 'Default preset — auto-loads on cold open' : 'Click to apply'}
            >
              {p.is_default ? '★ ' : ''}{p.name}
            </button>
            <button
              type="button"
              aria-label={`Preset menu for ${p.name}`}
              onClick={() => setOpenMenuId(openMenuId === p.id ? null : p.id)}
              className="ml-0.5 px-1 py-1 text-xs text-gray-400 hover:text-gray-700"
            >
              ⋯
            </button>
            {openMenuId === p.id && (
              <div className="absolute z-10 mt-1 right-0 min-w-[180px] rounded-lg border border-gray-200 bg-white shadow-md py-1 text-sm">
                <PresetMenuItem
                  label={p.is_default ? 'Clear default' : 'Set as default'}
                  onClick={() => {
                    onUpdate(p.id, { is_default: !p.is_default });
                    setOpenMenuId(null);
                  }}
                />
                <PresetMenuItem
                  label="Rename…"
                  onClick={() => {
                    const next = typeof window !== 'undefined' ? window.prompt('Preset name', p.name) : null;
                    if (next !== null && next.trim().length > 0 && next !== p.name) {
                      onUpdate(p.id, { name: next.trim() });
                    }
                    setOpenMenuId(null);
                  }}
                />
                <PresetMenuItem
                  label="Delete"
                  destructive
                  onClick={() => {
                    onDelete(p);
                    setOpenMenuId(null);
                  }}
                />
              </div>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={() => setShowSave((s) => !s)}
          className="ml-auto px-3 py-1 rounded-lg border border-emerald-600 text-emerald-700 text-xs hover:bg-emerald-50"
        >
          {showSave ? 'Cancel' : 'Save current as preset'}
        </button>
      </div>

      {showSave && (
        <form onSubmit={submitSave} className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="text"
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Preset name (≤ 60 chars)"
            maxLength={60}
            className="px-3 py-1 rounded border border-gray-300 text-sm flex-1 min-w-[200px]"
          />
          <label className="inline-flex items-center gap-1 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={draftDefault}
              onChange={(e) => setDraftDefault(e.target.checked)}
            />
            <span>Set as default</span>
          </label>
          <button
            type="submit"
            disabled={draftName.trim().length === 0}
            className="px-3 py-1 rounded bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            Save
          </button>
        </form>
      )}

      {actionMsg && (
        <div className="mt-2 text-xs text-gray-600">{actionMsg}</div>
      )}
    </div>
  );
}

function PresetMenuItem({
  label, onClick, destructive,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 hover:bg-gray-50 ${destructive ? 'text-red-700' : 'text-gray-700'}`}
    >
      {label}
    </button>
  );
}

function FilterBar({
  form, setForm, setCommittedForm, onSubmit, onReset, confirmLong, loading,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  setCommittedForm: React.Dispatch<React.SetStateAction<FormState>>;
  onSubmit: (e: React.FormEvent) => void;
  onReset: () => void;
  confirmLong: boolean;
  loading: boolean;
}) {
  // `setField` mutates the local draft only — used by free-text inputs so a
  // keystroke doesn't trigger a fetch. `commitField` mutates BOTH the draft
  // and the committed form — used by chips, checkboxes, and date pickers
  // where each click is a deliberate filter change.
  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((s) => ({ ...s, [k]: v }));
  const commitField = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((s) => ({ ...s, [k]: v }));
    setCommittedForm((s) => ({ ...s, [k]: v }));
  };

  const toggleDay = (d: number) =>
    commitField(
      'daysOfWeek',
      form.daysOfWeek.includes(d) ? form.daysOfWeek.filter((x) => x !== d) : [...form.daysOfWeek, d].sort()
    );

  const toggleException = (k: string) =>
    commitField(
      'exceptionKinds',
      form.exceptionKinds.includes(k) ? form.exceptionKinds.filter((x) => x !== k) : [...form.exceptionKinds, k]
    );

  return (
    <form onSubmit={onSubmit} className="rounded-xl bg-white border border-gray-200 p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {DATE_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            aria-pressed={form.dateRange === p.value}
            onClick={() => commitField('dateRange', p.value)}
            className={`px-3 py-1 rounded-full text-xs border ${
              form.dateRange === p.value
                ? 'bg-emerald-600 border-emerald-600 text-white'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {p.label}
          </button>
        ))}
        {form.dateRange === 'custom' && (
          <span className="flex items-center gap-2 ml-2">
            <input
              type="date"
              value={form.dateFrom}
              onChange={(e) => commitField('dateFrom', e.target.value)}
              className="px-2 py-1 rounded border border-gray-300 text-sm"
            />
            <span className="text-gray-500 text-sm">to</span>
            <input
              type="date"
              value={form.dateTo}
              onChange={(e) => commitField('dateTo', e.target.value)}
              className="px-2 py-1 rounded border border-gray-300 text-sm"
            />
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600">Departments (comma-separated)</span>
          <input
            type="text"
            value={form.departments}
            onChange={(e) => setField('departments', e.target.value)}
            placeholder="Civil, Optical"
            className="px-3 py-2 rounded border border-gray-300"
          />
        </label>

        <div className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600">Days of week</span>
          <div className="flex flex-wrap gap-1">
            {DAYS_OF_WEEK.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => toggleDay(d.value)}
                className={`px-2 py-1 rounded text-xs border ${
                  form.daysOfWeek.includes(d.value)
                    ? 'bg-emerald-100 border-emerald-400 text-emerald-800'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600">Quick toggles</span>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={form.onlyWithOt}
                onChange={(e) => commitField('onlyWithOt', e.target.checked)}
              />
              <span>Only with OT</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={form.onlySundayHoliday}
                onChange={(e) => commitField('onlySundayHoliday', e.target.checked)}
              />
              <span>Only Sun/holiday</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={form.onlyActive}
                onChange={(e) => commitField('onlyActive', e.target.checked)}
              />
              <span>Only active staff</span>
            </label>
          </div>
        </div>
      </div>

      <details className="mb-3">
        <summary className="cursor-pointer text-sm font-medium text-gray-700">
          Exception filters · advanced ID filters
        </summary>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <span className="text-sm text-gray-600">Exception kinds</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {EXCEPTION_KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => toggleException(k.value)}
                  className={`px-2 py-1 rounded text-xs border ${
                    form.exceptionKinds.includes(k.value)
                      ? 'bg-amber-100 border-amber-400 text-amber-800'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">Staff IDs (UUIDs, comma-separated)</span>
              <input
                type="text"
                value={form.staffIds}
                onChange={(e) => setField('staffIds', e.target.value)}
                placeholder="Optional — pickers ship in Phase B"
                className="px-3 py-2 rounded border border-gray-300 text-xs font-mono"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">Site IDs (UUIDs, comma-separated)</span>
              <input
                type="text"
                value={form.siteIds}
                onChange={(e) => setField('siteIds', e.target.value)}
                placeholder="Optional — pickers ship in Phase B"
                className="px-3 py-2 rounded border border-gray-300 text-xs font-mono"
              />
            </label>
          </div>
        </div>
      </details>

      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-gray-500">
          {confirmLong && 'Long-range queries are enabled. '}
          Times shown in SAST.
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            className="px-3 py-2 rounded border border-gray-300 text-sm hover:bg-gray-50"
          >
            Reset
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 rounded bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </div>
    </form>
  );
}

function TotalsStrip({ totals, scopeNote }: { totals: SearchTotals; scopeNote?: ScopeNote }) {
  return (
    <div className="mt-4 grid grid-cols-2 md:grid-cols-6 gap-3">
      <Stat label="Rows" value={totals.rowCount.toLocaleString('en-ZA')} />
      <Stat label="Staff" value={totals.distinctStaffCount.toLocaleString('en-ZA')} />
      <Stat label="Hours" value={fmtHrs(totals.totalRegularHrs + totals.totalOvertimeHrs)} />
      <Stat label="OT" value={fmtHrs(totals.totalOvertimeHrs)} accent="amber" />
      <Stat
        label="Wage"
        value={totals.totalWageCents > 0 ? fmtRand(totals.totalWageCents) : '—'}
      />
      <Stat
        label="Exceptions"
        value={totals.totalExceptionsCount.toLocaleString('en-ZA')}
        accent={totals.totalExceptionsCount > 0 ? 'amber' : undefined}
      />
      {scopeNote && (
        <div className="md:col-span-6 text-xs text-gray-500">
          {scopeNote.kind === 'orgwide' && 'Scope: org-wide.'}
          {scopeNote.kind === 'scoped' && `Scope: ${scopeNote.staffCount.toLocaleString('en-ZA')} staff in your supervisor chain.`}
          {scopeNote.kind === 'no_scope' && scopeNote.reason}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'amber' }) {
  const tone =
    accent === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white';
  return (
    <div className={`rounded-xl border ${tone} px-3 py-2`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-base font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function ResultRow({ row }: { row: SearchRow }) {
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-gray-700">
        {row.work_date}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <Link
          href={`/staff/${row.staff_id}?tab=attendance`}
          className="text-blue-600 hover:underline"
        >
          {row.full_name}
        </Link>
        {row.employee_id && <span className="ml-1 text-xs text-gray-400">({row.employee_id})</span>}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-700">{row.department ?? '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-700">{row.primary_site_name ?? '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{fmtTime(row.first_clock_in_at)}</td>
      <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{fmtTime(row.last_clock_out_at)}</td>
      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">
        {fmtHrs(row.regular_hrs + row.overtime_hrs)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">
        {row.overtime_hrs > 0 ? <span className="text-amber-700">{fmtHrs(row.overtime_hrs)}</span> : '—'}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">
        {fmtWageCents(row.wage_amount_cents)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-xs">
        {row.exceptions_count > 0 ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-800">
            {row.exceptions_count} · {row.exception_kinds.slice(0, 2).join(', ')}
            {row.exception_kinds.length > 2 && ` +${row.exception_kinds.length - 2}`}
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
    </tr>
  );
}

function Th({ children, numeric }: { children?: React.ReactNode; numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide ${
        numeric ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

function SortableTh({
  label, field, current, dir, onSort, numeric,
}: {
  label: string;
  field: SortField;
  current: SortField;
  dir: SortDir;
  onSort: (f: SortField) => void;
  numeric?: boolean;
}) {
  const active = current === field;
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide ${
        numeric ? 'text-right' : 'text-left'
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 hover:text-gray-700 ${
          active ? 'text-gray-700' : ''
        }`}
      >
        <span>{label}</span>
        {active && <span className="text-[10px]">{dir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );
}
