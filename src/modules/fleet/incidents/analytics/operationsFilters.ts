/**
 * The `op_*` query parameters, parsed once.
 *
 * There is one parser because there will be three callers: the analytics
 * endpoint, the drill-down endpoint, and (stage 8 task 8) the Excel export. An
 * export whose filters are parsed by a second implementation is an export that
 * eventually disagrees with the screen it was taken from, and a reader has no
 * way to tell which of the two is wrong.
 *
 * The `op_` prefix is deliberate and is not decoration: the incident queue
 * already puts `projectId`, `staffId` and friends on the query string, and the
 * two filter sets are independent. Sharing bare names would make a deep link
 * from the queue silently pre-filter the analytics screen, or the reverse.
 *
 * Every value is validated against a closed set or a format, never passed
 * through. A bad value is refused rather than ignored: dropping an
 * unrecognised filter silently WIDENS the result, and a manager reading a
 * number that answers a different question than the one they asked has no way
 * to notice.
 */
import { OUTCOMES, INCIDENT_TYPES, SEVERITIES } from '../reviewValidation';
import { datesInMonth } from './sastDates';
import type { OperationsFilters } from './types';

export class OperationsFilterError extends Error {
  constructor(message: string) { super(message); this.name = 'OperationsFilterError'; }
}

/**
 * The widest range a single request may ask for. The retained half of a
 * response derives its metrics from live facts month by month, so an unbounded
 * range is an unbounded amount of work on an interactive request.
 */
export const MAX_RANGE_MONTHS = 12;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RawOperationsQuery = Record<string, string | string[] | undefined>;

/** A repeated parameter is refused, never silently reduced to its first value. */
function single(query: RawOperationsQuery, name: string): string | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) throw new OperationsFilterError(`${name} must be given at most once`);
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function requiredDate(query: RawOperationsQuery, name: string): string {
  const value = single(query, name);
  if (value === undefined) throw new OperationsFilterError(`${name} is required`);
  if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new OperationsFilterError(`${name} must be a calendar date as YYYY-MM-DD`);
  }
  return value;
}

function optionalUuid(query: RawOperationsQuery, name: string): string | undefined {
  const value = single(query, name);
  if (value === undefined) return undefined;
  if (!UUID_PATTERN.test(value)) throw new OperationsFilterError(`${name} must be a UUID`);
  return value;
}

function optionalEnum<T extends string>(
  query: RawOperationsQuery, name: string, permitted: readonly T[],
): T | undefined {
  const value = single(query, name);
  if (value === undefined) return undefined;
  if (!permitted.includes(value as T)) {
    throw new OperationsFilterError(`${name} must be one of: ${permitted.join(', ')}`);
  }
  return value as T;
}

function optionalBoolean(query: RawOperationsQuery, name: string): boolean | undefined {
  const value = single(query, name);
  if (value === undefined) return undefined;
  if (value !== 'true' && value !== 'false') throw new OperationsFilterError(`${name} must be true or false`);
  return value === 'true';
}

/** Whole months between two calendar dates, counting the month each falls in. */
function monthSpan(start: string, end: string): number {
  const [startYear, startMonth] = start.split('-').map(Number) as [number, number];
  const [endYear, endMonth] = end.split('-').map(Number) as [number, number];
  return (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
}

/**
 * The range widened to the whole months it touches.
 *
 * Every figure this module can produce is monthly — a released aggregate is one
 * row per month, and the retained half derives a month at a time from facts. A
 * mid-month bound is therefore not honoured, and echoing it back unchanged
 * would tell a reader the first half of the month was excluded when it was
 * counted in full. `MAX_RANGE_MONTHS` is already counted on the month span, so
 * widening here cannot let a wider range through than the check above allowed.
 */
function wholeMonths(start: string, end: string): { start: string; end: string } {
  const endMonth = `${end.slice(0, 7)}-01`;
  const lastDay = datesInMonth(endMonth).at(-1);
  if (lastDay === undefined) throw new OperationsFilterError(`op_end is not a usable month: ${end}`);
  return { start: `${start.slice(0, 7)}-01`, end: lastDay };
}

export function parseOperationsFilters(query: RawOperationsQuery): OperationsFilters {
  const rawStart = requiredDate(query, 'op_start');
  const rawEnd = requiredDate(query, 'op_end');
  if (rawEnd < rawStart) throw new OperationsFilterError('op_end cannot be before op_start');
  const span = monthSpan(rawStart, rawEnd);
  if (span > MAX_RANGE_MONTHS) {
    throw new OperationsFilterError(`the range may cover at most ${MAX_RANGE_MONTHS} months, and this one covers ${span}`);
  }
  const { start, end } = wholeMonths(rawStart, rawEnd);

  const filters: OperationsFilters = { start, end };
  const projectId = optionalUuid(query, 'op_project');
  const managerUserId = optionalUuid(query, 'op_manager');
  const operationalSiteId = optionalUuid(query, 'op_site');
  const staffId = optionalUuid(query, 'op_driver');
  const vehicleId = optionalUuid(query, 'op_vehicle');
  const incidentType = optionalEnum(query, 'op_type', INCIDENT_TYPES);
  const severity = optionalEnum(query, 'op_severity', SEVERITIES);
  const outcome = optionalEnum(query, 'op_outcome', OUTCOMES);
  const evidenceAvailable = optionalBoolean(query, 'op_evidence');

  // op_manager narrows to the projects one person manages; a site sits inside
  // exactly one project. The pair is therefore either redundant or
  // contradictory, and honouring it would mean guessing which of the two the
  // caller meant — which is the silent widening this parser exists to refuse.
  if (managerUserId !== undefined && operationalSiteId !== undefined) {
    throw new OperationsFilterError('op_manager cannot be combined with op_site; a site already names one project');
  }

  // Assigned rather than spread so an absent filter is absent, not present-and-
  // undefined: the filters travel back out on the response, and `"op_site": null`
  // reads as "all sites were considered" when it means "no site filter was given".
  if (projectId !== undefined) filters.projectId = projectId;
  if (managerUserId !== undefined) filters.managerUserId = managerUserId;
  if (operationalSiteId !== undefined) filters.operationalSiteId = operationalSiteId;
  if (staffId !== undefined) filters.staffId = staffId;
  if (vehicleId !== undefined) filters.vehicleId = vehicleId;
  if (incidentType !== undefined) filters.incidentType = incidentType;
  if (severity !== undefined) filters.severity = severity;
  if (outcome !== undefined) filters.outcome = outcome;
  if (evidenceAvailable !== undefined) filters.evidenceAvailable = evidenceAvailable;
  return filters;
}

/**
 * `staffId` and `vehicleId` name one person and one vehicle. An aggregate is
 * published precisely because it describes at least `k` of them, so applying
 * either to an aggregate query would ask it a question it must not answer —
 * and would answer it, by returning the rows that survive the filter.
 */
export function hasRetainedOnlyFilter(filters: OperationsFilters): boolean {
  return filters.staffId !== undefined || filters.vehicleId !== undefined;
}
