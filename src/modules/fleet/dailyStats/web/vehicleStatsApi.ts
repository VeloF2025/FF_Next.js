/**
 * Typed browser client for the three vehicle-day stats reads.
 *
 * Envelope handling mirrors `../../operations/web/operationsPresentationApi.ts`: the API returns
 * `{success, data}` or `{success:false, error:{code,message}}`, and `error` is an OBJECT — reading
 * it as a string renders "[object Object]" to the user.
 */
import { log } from '@/lib/logger';
import type { VehicleDayStatsRow } from '../statsQueries';

export interface VehicleIdentity {
  vehicleId: string;
  registration: string | null;
  make: string | null;
  model: string | null;
  status: string | null;
}

export interface VehicleStatsCoverage {
  firstPositionWorkDate: string | null;
  daysWithData: number;
  daysExpected: number;
  daysPartial: number;
}

/** The day still in progress, never folded into the window's rows or coverage numbers. */
export interface VehicleStatsToday {
  workDate: string;
  stats: VehicleDayStatsRow | null;
}

export interface VehicleDailyStatsResult {
  vehicle: VehicleIdentity;
  window: { startWorkDate: string; endWorkDate: string; days: number };
  days: VehicleDayStatsRow[];
  today: VehicleStatsToday | null;
  coverage: VehicleStatsCoverage;
}

export interface DayRouteTrip {
  id: string;
  ignitionOnAt: string | null;
  ignitionOffAt: string | null;
  closeReason: string;
  countsTowardMetrics: boolean;
  start: { lat: number | null; lon: number | null; place: string | null };
  end: { lat: number | null; lon: number | null; place: string | null };
  durationSeconds: number | null;
  distanceKm: number | null;
  maxSpeedKph: number | null;
}

export interface DayRoutePosition {
  recordedAt: string | null;
  lat: number | null;
  lon: number | null;
  speedKph: number | null;
  ignition: boolean | null;
}

export interface DayRouteResult {
  vehicle: VehicleIdentity;
  workDate: string;
  trips: DayRouteTrip[];
  allTripsTimedOut: boolean;
  timedOutTrips: number;
  positions: DayRoutePosition[] | null;
  positionsTruncated: boolean;
}

export interface FleetOverviewVehicle extends VehicleIdentity {
  stats: VehicleDayStatsRow | null;
}

export interface FleetOverviewResult {
  workDate: string;
  vehicles: FleetOverviewVehicle[];
  coverage: { trackedVehicles: number; vehiclesWithData: number; vehiclesPartial: number };
}

export class VehicleStatsApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'VehicleStatsApiError';
  }
}

interface ErrorEnvelope { success: false; error: { code?: string; message?: string } }

function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  return typeof body === 'object' && body !== null
    && (body as { success?: unknown }).success === false
    && typeof (body as { error?: unknown }).error === 'object'
    && (body as { error?: unknown }).error !== null;
}

function isSuccessEnvelope<T>(body: unknown): body is { success: true; data: T } {
  return typeof body === 'object' && body !== null
    && (body as { success?: unknown }).success === true
    && 'data' in (body as Record<string, unknown>);
}

async function request<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', signal });
  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch (cause) {
    // A non-JSON body is usually an HTML error page from an upstream proxy, and the thrown
    // message alone would not say which URL produced it.
    log.warn('Vehicle stats response was not JSON', { url, status: response.status, cause });
    throw new VehicleStatsApiError('The stats response was not readable', response.status, 'INVALID_RESPONSE');
  }
  if (isErrorEnvelope(body)) {
    throw new VehicleStatsApiError(
      body.error.message ?? 'The stats request failed',
      response.status,
      body.error.code ?? 'UNKNOWN',
    );
  }
  if (!response.ok || !isSuccessEnvelope<T>(body)) {
    throw new VehicleStatsApiError('The stats response was not readable', response.status, 'INVALID_RESPONSE');
  }
  return body.data;
}

export function fetchVehicleDailyStats(
  vehicleId: string, options: { days?: number; endDate?: string; signal?: AbortSignal } = {},
): Promise<VehicleDailyStatsResult> {
  const params = new URLSearchParams();
  if (options.days !== undefined) params.set('days', String(options.days));
  if (options.endDate !== undefined) params.set('endDate', options.endDate);
  const qs = params.toString();
  return request<VehicleDailyStatsResult>(
    `/api/fleet/vehicles/${vehicleId}/daily-stats${qs ? `?${qs}` : ''}`, options.signal,
  );
}

export function fetchVehicleDayRoute(
  vehicleId: string, date: string,
  options: { includePositions?: boolean; signal?: AbortSignal } = {},
): Promise<DayRouteResult> {
  const params = new URLSearchParams({ date });
  if (options.includePositions) params.set('includePositions', '1');
  return request<DayRouteResult>(
    `/api/fleet/vehicles/${vehicleId}/day-route?${params.toString()}`, options.signal,
  );
}

export function fetchFleetDayOverview(
  options: { date?: string; signal?: AbortSignal } = {},
): Promise<FleetOverviewResult> {
  const params = new URLSearchParams();
  if (options.date !== undefined) params.set('date', options.date);
  const qs = params.toString();
  return request<FleetOverviewResult>(
    `/api/fleet/daily-stats/overview${qs ? `?${qs}` : ''}`, options.signal,
  );
}
