/**
 * Browser client for the operations analytics read path (stage 8, task 9).
 *
 * One serializer, three consumers: the analytics fetch, the drill-down fetch,
 * and the export link. That is the browser half of the rule the server-side
 * `operationsFilters` parser states — an export whose filters are built a
 * second way is an export that eventually disagrees with the screen it was
 * taken from, and a reader holding the file cannot tell which of the two is
 * wrong. The export is therefore a plain link built from the same string the
 * fetch used, never a second assembly of the same values.
 *
 * The `op_` prefix is not decoration. The incident queue puts `projectId` and
 * `staffId` on the query string of its own screen, and these filters are
 * independent of both those and of the vehicle scorecard's own controls, which
 * are component state and never reach the URL at all.
 *
 * Envelope handling is `incidentApi`'s — one `{success,data}` decoder and one
 * `IncidentApiError` classification across the whole incident domain.
 */
import { IncidentApiError, incidentRequest } from './incidentApi';
import type {
  OperationsAnalyticsResponse, OperationsDrillDownResponse, OperationsFilters,
} from '../analytics/types';

const ANALYTICS_PATH = '/api/fleet/analytics/operations';
const DRILL_DOWN_PATH = '/api/fleet/analytics/operations/drill-down';
const EXPORT_PATH = '/api/fleet/analytics/operations/export';

/**
 * Every filter under the `op_` name the server parser knows it by, paired with
 * the field it occupies on `OperationsFilters`.
 *
 * All eleven, not the seven the filter bar renders controls for: `op_manager`,
 * `op_site` and `op_vehicle` are reachable by deep link, and a serializer that
 * silently dropped one would widen the answer without saying so — the exact
 * failure the server parser refuses unknown keys to prevent.
 */
const FILTER_PARAMS = [
  ['op_start', 'start'],
  ['op_end', 'end'],
  ['op_project', 'projectId'],
  ['op_manager', 'managerUserId'],
  ['op_site', 'operationalSiteId'],
  ['op_driver', 'staffId'],
  ['op_vehicle', 'vehicleId'],
  ['op_type', 'incidentType'],
  ['op_severity', 'severity'],
  ['op_outcome', 'outcome'],
] as const satisfies readonly (readonly [string, keyof OperationsFilters])[];

/** The `op_` names this client shapes into typed filter fields. */
const SHAPED_OP_KEYS: ReadonlySet<string> = new Set([
  ...FILTER_PARAMS.map(([name]) => name), 'op_evidence',
]);

/**
 * `op_` parameters this client does not shape, carried verbatim.
 *
 * A typo — `op_sevrity=high` — is a reader asking a question this endpoint does
 * not answer, and the server says so in words. Dropping the key here would
 * substitute a silently WIDER answer for that sentence: the screen would render
 * every severity and never mention that the filter the URL asked for was
 * discarded. So unknown keys are passed through and the server's 400 is what
 * the reader sees.
 */
export type OperationsQueryExtras = Readonly<Record<string, string>>;

export function parseOperationsUrlExtras(source: string | URLSearchParams): Record<string, string> {
  const params = typeof source === 'string'
    ? new URLSearchParams(source.startsWith('?') ? source.slice(1) : source)
    : source;
  const extras: Record<string, string> = {};
  for (const [name, value] of params) {
    if (name.startsWith('op_') && !SHAPED_OP_KEYS.has(name)) extras[name] = value;
  }
  return extras;
}

/** `?op_start=…&…`, with unset filters absent rather than sent empty. */
export function operationsQueryString(
  filters: OperationsFilters, extras: OperationsQueryExtras = {},
): string {
  const params = new URLSearchParams();
  for (const [name, field] of FILTER_PARAMS) {
    const value = filters[field];
    if (typeof value === 'string' && value !== '') params.set(name, value);
  }
  // Boolean rather than string, so it cannot be folded into the loop above.
  if (filters.evidenceAvailable !== undefined) {
    params.set('op_evidence', String(filters.evidenceAvailable));
  }
  // Appended last, and never allowed to overwrite a shaped name: an extra is by
  // definition a key this client does not know, and one that collided with a
  // known one would be a filter quietly replaced rather than reported.
  for (const [name, value] of Object.entries(extras)) {
    if (!SHAPED_OP_KEYS.has(name)) params.append(name, value);
  }
  return `?${params.toString()}`;
}

/**
 * The `op_` filters on a URL, with the caller's default range where the URL
 * carries none.
 *
 * Everything outside `op_` is ignored rather than read. The vehicle scorecard's
 * period and type controls live in component state, and a parser that reached
 * for a bare `projectId` would be the first thing to couple the two filter sets.
 */
export function parseOperationsUrlFilters(
  source: string | URLSearchParams, fallback: { start: string; end: string },
): OperationsFilters {
  const params = typeof source === 'string'
    ? new URLSearchParams(source.startsWith('?') ? source.slice(1) : source)
    : source;
  const filters: OperationsFilters = {
    start: params.get('op_start') || fallback.start,
    end: params.get('op_end') || fallback.end,
  };
  for (const [name, field] of FILTER_PARAMS) {
    if (field === 'start' || field === 'end') continue;
    const value = params.get(name);
    if (value) filters[field] = value;
  }
  const evidence = params.get('op_evidence');
  if (evidence === 'true' || evidence === 'false') filters.evidenceAvailable = evidence === 'true';
  return filters;
}

/**
 * The export as a plain link. It carries the filter string the screen was built
 * from, so the two cannot describe different populations, and it stays a link
 * rather than a fetch because the browser's own download handling is what turns
 * the response into a file.
 */
export function operationsExportUrl(
  filters: OperationsFilters, extras: OperationsQueryExtras = {},
): string {
  return `${EXPORT_PATH}${operationsQueryString(filters, extras)}`;
}

/**
 * The export as bytes, or the server's own sentence.
 *
 * A plain link was the wrong shape. The endpoint answers a rejected filter with
 * a JSON envelope, and a browser following a link to that renders the raw
 * envelope in a tab — the reader leaves the screen and lands on
 * `{"success":false,...}`. Fetching it instead keeps the 400 on the page, in
 * the same error box the report's own failures use, with the same words.
 */
export async function fetchOperationsExport(
  filters: OperationsFilters, extras: OperationsQueryExtras = {},
): Promise<Blob> {
  const url = operationsExportUrl(filters, extras);
  // Rethrown as a typed error rather than swallowed: the caller renders it and
  // logs it, so a network failure is reported once, in the words the screen
  // shows, instead of twice or not at all.
  const response = await fetch(url, { credentials: 'same-origin' }).catch(() => {
    throw new IncidentApiError('Fleet operations export request failed', 0, 'NETWORK_ERROR');
  });
  if (response.ok) return response.blob();
  // Same envelope decoder shape as `incidentRequest`: the message is the
  // server's, never a generic "export failed" that hides which filter it was.
  // A body that is not an envelope still fails below, with the status.
  const body: unknown = await response.json().catch(() => null);
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
    const code = typeof body.error.code === 'string' ? body.error.code : 'EXPORT_FAILED';
    throw new IncidentApiError(body.error.message, response.status, code);
  }
  throw new IncidentApiError('The operations export could not be produced', response.status, 'EXPORT_FAILED');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export const operationsAnalyticsApi = {
  report(
    filters: OperationsFilters, signal?: AbortSignal, extras: OperationsQueryExtras = {},
  ): Promise<OperationsAnalyticsResponse> {
    return incidentRequest<OperationsAnalyticsResponse>(
      `${ANALYTICS_PATH}${operationsQueryString(filters, extras)}`, { signal },
    );
  },

  /**
   * The incidents behind a figure. `cursor` is appended after the filters so
   * the filter half of the string is byte-identical to the report's — paging is
   * a property of the request, never of the question being asked.
   */
  drillDown(
    filters: OperationsFilters, cursor?: string | null, signal?: AbortSignal,
    extras: OperationsQueryExtras = {},
  ): Promise<OperationsDrillDownResponse> {
    const query = operationsQueryString(filters, extras);
    const paged = cursor ? `${query}&cursor=${encodeURIComponent(cursor)}` : query;
    return incidentRequest<OperationsDrillDownResponse>(`${DRILL_DOWN_PATH}${paged}`, { signal });
  },
};
