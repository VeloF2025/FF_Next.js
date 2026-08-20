import { parseStrictIsoInstant } from '../instantValidation';
import type { OperationalStatusGroup } from '../presentationTypes';
import type { OperationalStatus } from '../types';

export type OperationEvidenceFilter = 'attendance_only' | 'vehicle_only' | 'dual' | 'missing' | 'stale';
export type OperationVisibilityFilter = 'all' | 'vehicles' | 'drivers';

export interface OperationFilters {
  projectId?: string;
  staffId?: string;
  siteId?: string;
  workDate?: string;
  asOf?: string;
  status?: OperationalStatus;
  group?: OperationalStatusGroup;
  evidence?: OperationEvidenceFilter;
  visibility?: OperationVisibilityFilter;
}

export type OperationFilterErrorCode =
  | 'unknown_filter'
  | 'repeated_filter'
  | 'invalid_filter'
  | 'conflicting_filter';

export class OperationFilterError extends Error {
  constructor(public code: OperationFilterErrorCode, message: string) {
    super(message);
    this.name = 'OperationFilterError';
  }
}

const FILTER_KEYS = [
  'projectId', 'staffId', 'siteId', 'workDate', 'asOf', 'status', 'group', 'evidence', 'visibility',
] as const;
type OperationFilterKey = typeof FILTER_KEYS[number];

const UUID_KEYS = new Set<OperationFilterKey>(['projectId', 'staffId', 'siteId']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set<OperationalStatus>([
  'off_duty', 'scheduled_not_due', 'unassigned', 'unverifiable', 'late', 'approaching',
  'attendance_confirmed', 'vehicle_on_site_driver_unconfirmed', 'on_site_dual', 'wrong_site',
  'evidence_mismatch', 'left_early', 'shift_complete',
]);
const GROUPS = new Set<OperationalStatusGroup>([
  'on_site', 'approaching', 'late', 'wrong_site', 'mismatch', 'left_early',
  'unassigned', 'unverifiable', 'normal',
]);
const EVIDENCE = new Set<OperationEvidenceFilter>([
  'attendance_only', 'vehicle_only', 'dual', 'missing', 'stale',
]);
const VISIBILITY = new Set<OperationVisibilityFilter>(['all', 'vehicles', 'drivers']);

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validate(key: OperationFilterKey, value: string): void {
  const valid = UUID_KEYS.has(key) ? UUID.test(value)
    : key === 'workDate' ? isValidDate(value)
      : key === 'asOf' ? parseStrictIsoInstant(value) !== null
        : key === 'status' ? STATUSES.has(value as OperationalStatus)
          : key === 'group' ? GROUPS.has(value as OperationalStatusGroup)
            : key === 'evidence' ? EVIDENCE.has(value as OperationEvidenceFilter)
              : key === 'visibility' ? VISIBILITY.has(value as OperationVisibilityFilter)
              : true;
  if (!valid) throw new OperationFilterError('invalid_filter', `Invalid operation filter: ${key}`);
}

function searchParams(source: string | URLSearchParams): URLSearchParams {
  return typeof source === 'string'
    ? new URLSearchParams(source.startsWith('?') ? source.slice(1) : source)
    : new URLSearchParams(source);
}

export function parseOperationFilters(source: string | URLSearchParams): OperationFilters {
  const params = searchParams(source);
  for (const key of params.keys()) {
    if (!FILTER_KEYS.includes(key as OperationFilterKey)) {
      throw new OperationFilterError('unknown_filter', `Unknown operation filter: ${key}`);
    }
    if (params.getAll(key).length > 1) {
      throw new OperationFilterError('repeated_filter', `Repeated operation filter: ${key}`);
    }
  }

  const parsed: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value === null || value === '') continue;
    validate(key, value);
    parsed[key] = value;
  }
  if (parsed.status && parsed.group) {
    throw new OperationFilterError('conflicting_filter', 'Status and group filters are mutually exclusive');
  }
  return parsed as OperationFilters;
}

export function serializeOperationFilters(filters: OperationFilters): string {
  if (filters.status && filters.group) {
    throw new OperationFilterError('conflicting_filter', 'Status and group filters are mutually exclusive');
  }
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (!value) continue;
    validate(key, value);
    params.set(key, value);
  }
  return params.toString();
}
